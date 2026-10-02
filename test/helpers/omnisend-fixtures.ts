import { vi } from "vitest";

export const settings = {
  api_key: "omni_key",
  store_url: "https://shop.test",
  enabled: true,
  use_display_locale: false,
};

type Route = { status?: number; body?: unknown };
type Routes = Record<string, Route | Route[]>;

// Mocks global fetch for the Omnisend API. Keys are "METHOD /path" (query string ignored).
// An array of routes is consumed in order, repeating the last entry.
export function mockOmnisend(routes: Routes = {}) {
  const queues = new Map(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.pathname.replace(/^\/v3/, "")}`;
    const queue = queues.get(key);
    const route = queue ? (queue.length > 1 ? queue.shift()! : queue[0]) : { status: 200, body: {} };
    const status = route.status ?? 200;
    if (status === 204) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

export function calls(fetchMock: ReturnType<typeof mockOmnisend>) {
  return fetchMock.mock.calls.map(([input, init]: any[]) => {
    const url = new URL(String(input));
    return {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/v3/, ""),
      query: Object.fromEntries(url.searchParams),
      headers: init?.headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
  });
}

// Swell client mock: `get` resolves by path (first arg), other methods resolve to {}
export function mockSwell(getByPath: Record<string, any | ((query: any) => any)> = {}) {
  return {
    get: vi.fn(async (path: string, query?: any) => {
      const value = getByPath[path];
      return typeof value === "function" ? value(query) : value;
    }),
    put: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    settings: vi.fn(async () => ({ omnisend: settings })),
  } as any;
}

// Skips sleeps (waitForBatches polling)
export function skipDelays() {
  return vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    fn();
    return 0;
  }) as any);
}

export function makeAccount(overrides: Record<string, any> = {}) {
  return {
    id: "acc_1",
    email: "jane@example.com",
    first_name: "Jane",
    last_name: "Doe",
    phone: "+12015550123",
    date_created: "2026-01-01T00:00:00.000Z",
    shipping: {
      address1: "1 Main St",
      address2: "Apt 2",
      city: "NYC",
      state: "NY",
      country: "US",
      zip: "10001",
      company: "Acme",
      phone: "+12015550000",
    },
    ...overrides,
  };
}

export function makeItem(overrides: Record<string, any> = {}) {
  return {
    id: "item_1",
    product_id: "prod_1",
    variant_id: "var_1",
    quantity: 2,
    price: 10.5,
    product: {
      name: "Shirt",
      sku: "SHIRT",
      slug: "shirt",
      images: [{ file: { url: "https://cdn/shirt.jpg" } }],
    },
    ...overrides,
  };
}

export function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: "ord_1",
    number: "WO-1001",
    currency: "USD",
    cart_id: "cart_1",
    date_created: "2026-02-01T00:00:00.000Z",
    display_locale: "en",
    account: { email: "jane@example.com" },
    grand_total: 25,
    sub_total: 21,
    discount_total: 0,
    tax_included_total: 1,
    shipment_total: 4,
    payment_total: 25,
    payment_balance: 0,
    refund_total: 0,
    delivered: true,
    item_quantity_returned: 0,
    item_quantity_deliverable: 0,
    delivery: "shipment",
    shipping: { service_name: "UPS", first_name: "Jane", last_name: "Doe", city: "NYC", country: "US" },
    billing: { first_name: "Jane", last_name: "Doe", city: "NYC", country: "US" },
    items: [makeItem()],
    ...overrides,
  };
}

export function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: "prod_1",
    name: "Shirt",
    sku: "SHIRT",
    slug: "shirt",
    currency: "USD",
    description: "A shirt",
    tags: ["tops"],
    stock_status: "in_stock",
    price: 10,
    images: [{ id: "img_1", file: { url: "https://cdn/shirt.jpg" } }],
    options: [
      {
        id: "opt_size",
        values: [
          { id: "val_s", name: "S" },
          { id: "val_l", name: "L", price: 2 },
        ],
      },
    ],
    variants: {
      results: [
        { id: "var_s", name: "Shirt S", sku: "SHIRT-S", option_value_ids: ["val_s"] },
        { id: "var_l", name: "Shirt L", sku: "SHIRT-L", option_value_ids: ["val_l"] },
      ],
    },
    ...overrides,
  };
}
