import { OmnisendClient, OmnisendError, getSettings } from './lib/omnisend-client';
import { syncContacts } from './lib/contact';
import { syncProducts } from './lib/product';
import { syncOrders } from './lib/order';
import {
  SyncError,
  parseCreatedAfter,
  parseEntity,
  parsePageSize,
  syncEntityPage,
  waitForBatches,
} from './lib/sync';

export const config: SwellConfig = {
  description: 'Initial sync of contacts, products, and orders to Omnisend: one page of an entity, or everything',
  route: {
    methods: ['post'],
    public: false,
  },
};

export async function post(req: SwellRequest) {
  const { swell } = req;

  // With an entity, sync one page of it, like the app frontend does
  if (req.data?.entity !== undefined) {
    return syncPage(req);
  }

  const rawSettings = await swell.settings();
  const settings = getSettings(rawSettings);

  if (!settings.api_key) {
    throw new SwellError('Omnisend API key not configured', { status: 400 });
  }

  if (!settings.enabled) {
    throw new SwellError('Omnisend integration is disabled', { status: 400 });
  }

  const client = new OmnisendClient(settings.api_key);

  await syncContacts(swell, client);
  await waitForBatches(client, 'contacts');

  await syncProducts(swell, client, settings);
  await waitForBatches(client, 'products');

  await syncOrders(swell, client, settings);
  await waitForBatches(client, 'orders');

  console.log('Omnisend: full sync complete');
  return { success: true };
}

async function syncPage(req: SwellRequest) {
  const page = Number(req.data?.page) || 1;

  try {
    const entity = parseEntity(req.data?.entity);
    const createdAfter = parseCreatedAfter(req.data?.created_after);
    const limit = parsePageSize(req.data?.limit);
    return await syncEntityPage(req.swell, entity, page, { createdAfter, limit });
  } catch (err: any) {
    if (err instanceof SyncError) {
      throw new SwellError(err.message, { status: err.status });
    }
    console.error(`Omnisend: sync failed on page ${page}`, err);
    throw new SwellError(err?.message || String(err), {
      status: err instanceof OmnisendError && err.status < 500 ? 400 : 502,
    });
  }
}
