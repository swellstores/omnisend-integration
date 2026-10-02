import { OmnisendClient, type SwellClient, getSettings } from './omnisend-client';
import { buildContactBatchItem } from './contact';
import { VARIANTS_INCLUDE, buildProductBody } from './product';
import { ORDER_EXPAND, buildOrderBatchItem } from './order';
import { getDefaultLocale, getLocalizedResults } from './localization';

// Records the initial sync sends to Omnisend, in the recommended order
export const SYNC_ENTITIES = ['contacts', 'products', 'orders'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const PAGE_SIZES = [10, 100, 200, 500, 1000] as const;
export const DEFAULT_PAGE_SIZE = 100;

// Invalid sync request or app configuration, with the HTTP status to return
export class SyncError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface SyncPageResult {
  entity: SyncEntity;
  page: number;
  limit: number;
  count: number;
  synced: number;
  done: boolean;
}

export interface SyncOptions {
  // ISO date; only records with date_created >= this date are synced
  createdAfter?: string;
  // records per page, one of PAGE_SIZES
  limit?: number;
}

export function parseEntity(value: unknown): SyncEntity {
  if (!(SYNC_ENTITIES as readonly unknown[]).includes(value)) {
    throw new SyncError(`Invalid entity, use one of ${SYNC_ENTITIES.join(', ')}`, 400);
  }
  return value as SyncEntity;
}

// Validate an optional page size, defaulting to DEFAULT_PAGE_SIZE
export function parsePageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_PAGE_SIZE;
  }
  const size = Number(value);
  if (!(PAGE_SIZES as readonly number[]).includes(size)) {
    throw new SyncError(`Invalid page size, use one of ${PAGE_SIZES.join(', ')}`, 400);
  }
  return size;
}

// Normalize an optional date filter to ISO, rejecting anything Date can't parse
export function parseCreatedAfter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new SyncError('Invalid created_after date', 400);
  }
  return date.toISOString();
}

// Send one page of contacts, products or orders to Omnisend as a batch.
// Called page by page from the app frontend so each call stays short.
export async function syncEntityPage(
  swell: SwellClient,
  entity: SyncEntity,
  page: number,
  { createdAfter, limit = DEFAULT_PAGE_SIZE }: SyncOptions = {},
): Promise<SyncPageResult> {
  entity = parseEntity(entity);
  if (!Number.isInteger(page) || page < 1) {
    throw new SyncError('Invalid page', 400);
  }
  limit = parsePageSize(limit);

  const settings = getSettings(await swell.settings());
  if (!settings.api_key) {
    throw new SyncError('Omnisend API key is not set in app settings', 400);
  }
  if (!settings.enabled) {
    throw new SyncError('Omnisend integration is disabled in app settings', 400);
  }
  const client = new OmnisendClient(settings.api_key);

  const query = {
    ...(createdAfter ? { date_created: { $gte: createdAfter } } : {}),
    // stable order so pages don't shift while the sync walks them
    sort: 'date_created asc',
    limit,
  };

  let result: any;
  let items: object[];

  switch (entity) {
    case 'contacts': {
      result = await swell.get('/accounts', { ...query, page });
      items = (result?.results ?? []).map(buildContactBatchItem);
      break;
    }
    case 'products': {
      result = await swell.get('/products', { ...query, page, include: VARIANTS_INCLUDE });
      items = (result?.results ?? []).map((product: any) => buildProductBody(product, settings.store_url!));
      break;
    }
    case 'orders': {
      const ordersQuery = { ...query, expand: ORDER_EXPAND };
      result = await swell.get('/orders', { ...ordersQuery, page });
      const defaultLocale = settings.use_display_locale ? await getDefaultLocale(swell) : undefined;
      const localized = await getLocalizedResults(swell, settings, defaultLocale, '/orders', ordersQuery, result?.results ?? []);
      items = localized.map((order: any) => buildOrderBatchItem(order, settings.store_url!));
      break;
    }
  }

  if (items.length) {
    await client.post('/batches', { method: 'POST', endpoint: entity, items });
  }

  if (entity === 'contacts') {
    // Track omnisend_email on each account to enable future updates, in one request
    const tags = (result?.results ?? [])
      .filter((account: any) => account.email)
      .map((account: any) => ({
        url: `/accounts/${account.id}`,
        method: 'put',
        data: { $events: false, omnisend_email: account.email },
      }));
    if (tags.length) {
      await swell.post('/:batch', tags);
    }
  }

  const done = (result?.results?.length ?? 0) < limit;
  if (done) {
    console.log(`Omnisend: ${entity} sync finished on page ${page}`);
  }

  return {
    entity,
    page,
    limit,
    count: result?.count || 0,
    synced: items.length,
    done,
  };
}

interface BatchPage {
  batches?: Array<{ status: string }>;
  paging?: { next?: string };
}

/** Poll Omnisend batch endpoint until all batches for the given entity type are no longer pending/inProgress. */
export async function waitForBatches(client: OmnisendClient, endpoint: string): Promise<void> {
  const limit = 250;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await client.get('/batches', {
      endpoint,
      limit: String(limit),
      offset: String(page * limit),
    }) as any;

    const data: BatchPage = res?.data ?? res ?? {};
    const batches: Array<{ status: string }> = data.batches ?? [];

    const isRunning = batches.some((b) => b.status === 'pending' || b.status === 'inProgress');

    if (isRunning) {
      // Still processing — restart from page 0
      page = 0;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      if (!data.paging?.next) {
        hasMore = false;
      } else {
        page += 1;
      }
    }
  }
}
