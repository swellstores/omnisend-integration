import { OmnisendClient, OmnisendSettings } from './omnisend-client';

function buildContactBody(account: any, isCreate = false): object {
  const address =
    isCreate && !account.shipping?.address1 && !account.shipping?.address2
      ? undefined
      : `${account.shipping?.address1 ?? '-'}; ${
          account.shipping?.address2 ?? '-'
        }`;

  return {
    id: account.id,
    firstName: account.first_name,
    lastName: account.last_name,
    city: account.shipping?.city,
    state: account.shipping?.state,
    countryCode: account.shipping?.country,
    postalCode: account.shipping?.zip,
    address,
    customProperties: {
      company: account.shipping?.company,
      shipping_phone: account.shipping?.phone,
      account_phone: account.phone,
      email: account.email,
    },
  }
}

function buildIdentifiers(account: any): Array<object> {
  return [
    {
      type: 'email',
      id: account.email,
      channels: {
        email: {
          status: 'subscribed',
          statusDate: account.date_created,
        },
      },
    },
  ]
};

export async function createContact(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  accountId: string,
  accountData: any,
): Promise<void> {
  if (!accountData?.email) {
    console.error('Omnisend createContact: missing email, skipping');
    return;
  }

  const body = {
    ...buildContactBody(accountData, true),
    identifiers: buildIdentifiers(accountData),
  };

  try {
    await client.post('/contacts', body);

    await swell.put('/accounts/{id}', {
      $events: false,
      id: accountId,
      omnisend_email: accountData.email,
    } as any);

    console.log(`Omnisend: created contact ${accountData.email}`);
  } catch (err: any) {
    console.error(`Omnisend createContact error: ${err.message}`);
  }
}

export async function updateContact(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  accountId: string,
): Promise<void> {
  const account = await swell.get('/accounts/{id}', { id: accountId } as any);

  if (!account) {
    return;
  }

  const omnisendEmail = account.omnisend_email;

  if (!omnisendEmail) {
    console.error(`Omnisend updateContact: no tracked email for account ${accountId}`);
    return;
  }

  const body = buildContactBody(account);

  try {
    await client.patch('/contacts', body, { email: omnisendEmail });
    console.log(`Omnisend: updated contact ${omnisendEmail}`);
  } catch (err: any) {
    console.error(`Omnisend updateContact error: ${err.message}`);
  }
}

export async function syncContacts(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
): Promise<void> {
  let page = 0;

  do {
    const result = await swell.get('/accounts', {
      limit: 100,
      page: page + 1,
    } as any) as any;

    if (!result?.results?.length) {
      console.log('Omnisend: contacts sync complete');
      return;
    }

    const items = result.results.map((account: any) => ({
      id: account.id,
      ...buildContactBody(account),
      identifiers: buildIdentifiers(account),
    }));

    try {
      await client.post('/batches', { method: 'POST', endpoint: 'contacts', items });
    } catch (err: any) {
      console.error(`Omnisend syncContacts batch error: ${err.message}`);
    }

    // Track omnisend_email on each account to enable future updates
    for (const user of result.results) {
      if (user.email) {
        await swell.put('/accounts/{id}', {
          $events: false,
          id: user.id,
          omnisend_email: user.email,
        } as any).catch((err: any) => console.error(`Omnisend: failed to tag account ${user.id}: ${err.message}`));
      }
    }

    page += 1;
  } while (true);
}

export async function validateLogin(apiKey: string): Promise<boolean> {
  const client = new OmnisendClient(apiKey);
  const body = {
    firstName: 'validate',
    lastName: 'validate',
    identifiers: [
      {
        type: 'email',
        id: 'validate@test.com',
        channels: {
          email: {
            status: 'subscribed',
            statusDate: new Date().toISOString(),
          },
        },
      },
    ],
  };

  try {
    await client.post('/contacts', body);
    return true;
  } catch {
    return false;
  }
}
