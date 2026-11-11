import { OmnisendClient, OmnisendError, getSettings } from './lib/omnisend-client';

export const config: SwellConfig = {
  description: 'Check the Omnisend API key',
  action: true,
};

// a thrown 400 shows in the admin as a red error popup, a returned message as a regular one
function fail(message: string): never {
  throw new SwellError(message, { status: 400 });
}

export default async function (req: SwellRequest) {
  const apiKey = String(getSettings(await req.swell.settings()).api_key || '').trim();
  if (!apiKey) {
    fail('Add the API key and save the settings first.');
  }

  try {
    // read-only: lists at most one contact and keeps nothing
    await new OmnisendClient(apiKey).get('/contacts', { limit: '1' });
  } catch (err) {
    if (err instanceof OmnisendError && (err.status === 401 || err.status === 403)) {
      fail(
        "Omnisend didn't accept the API key, or the key has no access to Contacts. In Omnisend, go to Store settings → API keys and create a key with access to Contacts, Products, Carts and Orders.",
      );
    }
    if (err instanceof OmnisendError) {
      fail(`Omnisend answered ${err.status} when checking the API key. Try again in a minute.`);
    }
    fail(`Omnisend couldn't be reached (${err instanceof Error ? err.message : String(err)}). Try again in a minute.`);
  }

  return { message: 'Connected to Omnisend: the API key can read your contacts.' };
}
