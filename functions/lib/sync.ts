import { OmnisendClient } from './omnisend-client';

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
