import { OmnisendClient, getSettings } from './lib/omnisend-client';
import { createContact, updateContact } from './lib/contact';

export const config: SwellConfig = {
  description: 'Sync customer account changes to Omnisend',
  model: {
    events: ['account.created', 'account.updated'],
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
    case 'account.created':
      await createContact(swell, client, data.id, data);
      break;
    case 'account.updated':
      await updateContact(swell, client, data.id);
      break;
    default:
  }
}
