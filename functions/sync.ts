import { OmnisendClient, getSettings } from './lib/omnisend-client';
import { syncContacts } from './lib/contact';
import { syncProducts } from './lib/product';
import { syncOrders } from './lib/order';
import { waitForBatches } from './lib/sync';

export const config: SwellConfig = {
  description: 'Full initial sync of contacts, products, and orders to Omnisend',
  route: {
    methods: ['post'],
    public: false,
  },
};

export async function post(req: SwellRequest) {
  const { swell } = req;

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
