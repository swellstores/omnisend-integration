import { OmnisendClient, getSettings } from './lib/omnisend-client';
import { cartCreate, cartUpdate, cartDelete } from './lib/cart';

export const config: SwellConfig = {
  description: 'Sync cart events to Omnisend',
  model: {
    events: ['cart.created', 'cart.updated', 'cart.deleted'],
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
    case 'cart.created':
      await cartCreate(swell, client, settings, data.id);
      break;
    case 'cart.updated':
      await cartUpdate(swell, client, settings, data.id);
      break;
    case 'cart.deleted': {
      const cartId = (body as any)?.$event?.data?.id;
      if (!cartId) {
        console.error(`Omnisend cartDelete error: no cart ID`);
      }
      await cartDelete(client, cartId);
      break;
    }
    default:
  }
}
