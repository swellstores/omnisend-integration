import { OmnisendClient, getSettings } from './lib/omnisend-client';
import { createOrder, updateOrder } from './lib/order';

export const config: SwellConfig = {
  description: 'Sync order lifecycle events to Omnisend',
  model: {
    events: ['order.submitted', 'order.updated'],
  },
};

export default async function (req: SwellRequest) {
  const { swell, data } = req;

  const rawSettings = await swell.settings();
  const settings = getSettings(rawSettings);

  if (!settings.enabled || !settings.api_key) {
    return;
  }

  const client = new OmnisendClient(settings.api_key);
  const event = (data as any).$event?.type;

  switch (event) {
    case 'order.submitted':
      await createOrder(swell, client, settings, data.id);
      break;
    case 'order.updated':
      await updateOrder(swell, client, settings, data.id);
      break;
    default:
  }
}
