import { useRef, useState } from 'react';

type Entity = 'contacts' | 'products' | 'orders';
type SyncPage = { entity: Entity; page: number; limit: number; count: number; synced: number; done: boolean };
type Status = 'idle' | 'running' | 'stopped' | 'failed' | 'complete';

type Progress = { page: number; processed: number; synced: number; total: number };
type Scope = 'all' | 'since';
type SyncOptions = { createdAfter?: string; limit: number };

// must match PAGE_SIZES in functions/lib/sync.ts; the Worker rejects other values
const PAGE_SIZES = [10, 100, 200, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

// in the recommended order: orders reference contacts and products
const ENTITIES: { id: Entity; label: string; description: string }[] = [
  { id: 'contacts', label: 'Contacts', description: 'Customer accounts with their email marketing opt-in' },
  { id: 'products', label: 'Products', description: 'Products with variants, prices, stock status and images' },
  { id: 'orders', label: 'Orders', description: 'Orders with items, totals, addresses, payment and fulfillment status' },
];

const emptyProgress: Progress = { page: 0, processed: 0, synced: 0, total: 0 };

class SyncError extends Error {
  details: unknown;
  constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

// Start of the selected day in the merchant's local time zone, as ISO
function startOfDay(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

async function syncPage(entity: Entity, page: number, { createdAfter, limit }: SyncOptions): Promise<SyncPage> {
  const response = await fetch('/app-api/admin/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createdAfter ? { entity, page, limit, created_after: createdAfter } : { entity, page, limit }),
  });
  const text = await response.text();
  let result: Partial<SyncPage> & { error?: string; details?: unknown } = {};
  try { result = JSON.parse(text); } catch { /* not JSON */ }
  if (!response.ok) {
    throw new SyncError(
      result.error || `Sync failed with status ${response.status}`,
      result.details ?? { entity, page, status: response.status, response: text.slice(0, 2000) },
    );
  }
  return result as SyncPage;
}

export default function InitialSync() {
  const [scope, setScope] = useState<Scope>('all');
  const [sinceDate, setSinceDate] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [running, setRunning] = useState<Record<Entity, boolean>>({ contacts: false, products: false, orders: false });

  const anyRunning = Object.values(running).some(Boolean);
  const options = (): SyncOptions & { label: string } => (scope === 'since' && sinceDate
    ? { createdAfter: startOfDay(sinceDate), limit: pageSize, label: `created on or after ${sinceDate}` }
    : { limit: pageSize, label: 'all records' });

  return <section className="sync">
    <fieldset className="sync-scope" disabled={anyRunning}>
      <legend>Records to sync</legend>
      <label>
        <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />
        All records
      </label>
      <label>
        <input type="radio" name="scope" value="since" checked={scope === 'since'} onChange={() => setScope('since')} />
        Records created on or after
        <input
          type="date"
          value={sinceDate}
          max={new Date().toLocaleDateString('en-CA')}
          aria-label="Created on or after"
          onChange={(event) => { setSinceDate(event.target.value); setScope('since'); }}
        />
      </label>
      <label>
        Page size
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} records</option>)}
        </select>
      </label>
    </fieldset>

    <p className="sync-hint">Sync contacts and products before orders. These options apply to every sync and are locked while one is running.</p>

    <div className="sync-rows">
      {ENTITIES.map((entity) => <EntitySync
        key={entity.id}
        {...entity}
        canStart={scope === 'all' || Boolean(sinceDate)}
        options={options}
        onRunningChange={(value) => setRunning((current) => ({ ...current, [entity.id]: value }))}
      />)}
    </div>
  </section>;
}

function EntitySync({ id, label, description, canStart, options, onRunningChange }: {
  id: Entity;
  label: string;
  description: string;
  canStart: boolean;
  options: () => SyncOptions & { label: string };
  onRunningChange: (running: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [stopping, setStopping] = useState(false);
  // options of the current sync, kept for resume even if the form changes (page numbers depend on the size)
  const [activeSync, setActiveSync] = useState<SyncOptions & { label: string }>({ limit: DEFAULT_PAGE_SIZE, label: 'all records' });
  const stopRequested = useRef(false);

  // Sync pages one after another, starting from `fromPage`.
  async function run(fromPage: number, initial: Progress, syncOptions: SyncOptions) {
    stopRequested.current = false;
    setStopping(false);
    setStatus('running');
    onRunningChange(true);
    setError('');
    setErrorDetails(null);
    let current = initial;
    let page = fromPage;
    try {
      for (;;) {
        const result = await syncPage(id, page, syncOptions);
        current = {
          page: result.page,
          processed: Math.min(result.count, (result.page - 1) * result.limit + result.synced),
          synced: current.synced + result.synced,
          total: result.count,
        };
        setProgress(current);
        if (result.done) { setStatus('complete'); return; }
        if (stopRequested.current) { setStatus('stopped'); return; }
        page = result.page + 1;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to sync ${id}`);
      setErrorDetails(err instanceof SyncError ? err.details : String(err));
      setStatus('failed');
    } finally {
      onRunningChange(false);
    }
  }

  const start = () => {
    const syncOptions = options();
    setActiveSync(syncOptions);
    setProgress(emptyProgress);
    void run(1, emptyProgress, syncOptions);
  };
  const resume = () => void run(progress.page + 1, progress, activeSync);
  const stop = () => { stopRequested.current = true; setStopping(true); };

  const running = status === 'running';
  const canResume = (status === 'stopped' || status === 'failed') && progress.page > 0;
  const percent = status === 'complete' ? 100
    : progress.total ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0;
  const unit = label.toLowerCase();

  return <article className="sync-row" aria-label={`${label} sync`}>
    <div className="sync-row-head">
      <div>
        <h2>{label}</h2>
        <p className="sync-row-description">{description}</p>
      </div>
      <div className="sync-actions">
        <button type="button" className="primary" onClick={start} disabled={running || !canStart}>
          {status === 'idle' ? `Sync ${unit}` : 'Start new sync'}
        </button>
        {running && <button type="button" onClick={stop} disabled={stopping}>{stopping ? 'Stopping…' : 'Stop'}</button>}
        {canResume && <button type="button" onClick={resume}>Resume from page {progress.page + 1}</button>}
      </div>
    </div>

    {status !== 'idle' && <div className="sync-progress">
      <div
        className={`bar bar-${status}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label} sync progress`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p role="status">
        {statusLabel(status)} · {activeSync.label} · {progress.processed} of {progress.total} {unit} processed ({percent}%)
        {running && progress.page > 0 && <> · page {progress.page}</>}
        {' '}· {progress.synced} sent to Omnisend
      </p>
      {error && <div className="sync-error" role="alert">
        <p>{error}</p>
        {errorDetails != null && <details open>
          <summary>Error details</summary>
          <pre>{JSON.stringify(errorDetails, null, 2)}</pre>
        </details>}
      </div>}
    </div>}
  </article>;
}

function statusLabel(status: Status) {
  switch (status) {
    case 'running': return 'Syncing';
    case 'stopped': return 'Stopped';
    case 'failed': return 'Failed';
    case 'complete': return 'Complete';
    default: return '';
  }
}
