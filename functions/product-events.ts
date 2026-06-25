import { OmnisendClient, getSettings } from './lib/omnisend-client';
import { createProduct, updateProduct, deleteProduct } from './lib/product';

export const config: SwellConfig = {
  description: 'Sync product changes to Omnisend',
  model: {
    events: ['product.created', 'product.updated', 'product.deleted', 'product.variant.updated'],
  },
};

export default async function (req: SwellRequest) {
  const { swell, data, body } = req;

  const rawSettings = await swell.settings();
  const settings = getSettings(rawSettings);

  if (!settings.enabled || !settings.api_key) {
    return;
  }

  const client = new OmnisendClient(settings.api_key);
  const event = (data as any).$event?.type;

  switch (event) {
    case 'product.created':
      await createProduct(swell, client, settings, data.id);
      break;
    case 'product.updated':
      await updateProduct(swell, client, settings, data.id, false);
      break;
    case 'product.variant.updated':
      await updateProduct(swell, client, settings, data.id, true);
      break;
    case 'product.deleted': {
      const productId = (body as any)?.$event?.data?.id;
      if (!productId) {
        console.error(`Omnisend deleteProduct error: no product ID`);
      }
      await deleteProduct(client, productId);
      break;
    }
      
    default:
  }
}
