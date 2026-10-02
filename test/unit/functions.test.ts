import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockRequest } from "../helpers/mock-request";
import {
  mockOmnisend,
  mockSwell,
  calls,
  skipDelays,
  settings,
  makeAccount,
  makeOrder,
  makeProduct,
  makeItem,
} from "../helpers/omnisend-fixtures";
import accountEvents, { config as accountConfig } from "../../functions/account-events";
import cartEvents, { config as cartConfig } from "../../functions/cart-events";
import orderEvents, { config as orderConfig } from "../../functions/order-events";
import productEvents, { config as productConfig } from "../../functions/product-events";
import * as syncFn from "../../functions/sync";
import * as validateFn from "../../functions/validate-login";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function eventRequest(swell: any, type: string, data: Record<string, any> = {}) {
  return createMockRequest({ swell, data: { id: "rec_1", ...data, $event: { type, data: { id: "rec_1" } } } });
}

function routes(fetchMock: ReturnType<typeof mockOmnisend>) {
  return calls(fetchMock).map((c) => `${c.method} ${c.path}`);
}

describe("model event functions", () => {
  it("subscribe to the expected events", () => {
    expect(accountConfig.model?.events).toEqual(["account.created", "account.updated"]);
    expect(cartConfig.model?.events).toEqual(["cart.created", "cart.updated", "cart.deleted"]);
    expect(orderConfig.model?.events).toEqual(["order.submitted", "order.updated"]);
    expect(productConfig.model?.events).toEqual([
      "product.created",
      "product.updated",
      "product.deleted",
      "product.variant.updated",
    ]);
  });

  it.each([
    ["account-events", accountEvents, "account.created"],
    ["cart-events", cartEvents, "cart.created"],
    ["order-events", orderEvents, "order.submitted"],
    ["product-events", productEvents, "product.created"],
  ])("%s does nothing when the integration is disabled or has no API key", async (_name, handler, type) => {
    const fetchMock = mockOmnisend();
    for (const omnisend of [{ ...settings, enabled: false }, { ...settings, api_key: "" }, undefined]) {
      const swell = mockSwell();
      swell.settings.mockResolvedValue({ omnisend });
      await handler(eventRequest(swell, type));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("account-events", () => {
  it("creates a contact on account.created", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell();
    await accountEvents(eventRequest(swell, "account.created", makeAccount({ id: "rec_1" })));
    expect(routes(fetchMock)).toEqual(["POST /contacts"]);
    expect(swell.put).toHaveBeenCalled();
  });

  it("updates a contact on account.updated", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/accounts/{id}": makeAccount({ omnisend_email: "jane@example.com" }) });
    await accountEvents(eventRequest(swell, "account.updated"));
    expect(routes(fetchMock)).toEqual(["PATCH /contacts"]);
  });
});

describe("cart-events", () => {
  const cart = { id: "rec_1", currency: "USD", grand_total: 1, account: { email: "a@b.c" }, items: [makeItem()] };

  it("creates the cart on cart.created", async () => {
    const fetchMock = mockOmnisend();
    await cartEvents(eventRequest(mockSwell({ "/carts/{id}": cart }), "cart.created"));
    expect(routes(fetchMock)).toEqual(["POST /carts"]);
  });

  it("updates the cart on cart.updated", async () => {
    const fetchMock = mockOmnisend();
    await cartEvents(eventRequest(mockSwell({ "/carts/{id}": cart }), "cart.updated"));
    expect(routes(fetchMock)).toEqual(["GET /carts/rec_1", "PUT /carts/rec_1"]);
  });

  it("deletes the cart by the event record ID on cart.deleted", async () => {
    const fetchMock = mockOmnisend({ "DELETE /carts/rec_1": { status: 204 } });
    await cartEvents(eventRequest(mockSwell(), "cart.deleted"));
    expect(routes(fetchMock)).toEqual(["DELETE /carts/rec_1"]);
  });
});

describe("order-events", () => {
  it("creates the order on order.submitted", async () => {
    const fetchMock = mockOmnisend();
    await orderEvents(eventRequest(mockSwell({ "/orders/{id}": makeOrder({ id: "rec_1" }) }), "order.submitted"));
    expect(routes(fetchMock)).toEqual(["POST /orders"]);
  });

  it("updates the order on order.updated", async () => {
    const fetchMock = mockOmnisend();
    await orderEvents(eventRequest(mockSwell({ "/orders/{id}": makeOrder({ id: "rec_1" }) }), "order.updated"));
    expect(routes(fetchMock)).toEqual(["PUT /orders/rec_1"]);
  });
});

describe("product-events", () => {
  const swell = () =>
    mockSwell({
      "/products/{id}": makeProduct({ id: "rec_1" }),
      "/products:variants/{id}": { id: "var_1", parent_id: "rec_1" },
    });

  it("creates the product on product.created", async () => {
    const fetchMock = mockOmnisend();
    await productEvents(eventRequest(swell(), "product.created"));
    expect(routes(fetchMock)).toEqual(["POST /products/"]);
  });

  it("updates the product on product.updated and product.variant.updated", async () => {
    const fetchMock = mockOmnisend();
    await productEvents(eventRequest(swell(), "product.updated"));
    await productEvents(eventRequest(swell(), "product.variant.updated", { id: "var_1" }));
    expect(routes(fetchMock)).toEqual(["PUT /products/rec_1", "PUT /products/rec_1"]);
  });

  it("deletes the product on product.deleted", async () => {
    const fetchMock = mockOmnisend({ "DELETE /products/rec_1": { status: 204 } });
    await productEvents(eventRequest(mockSwell(), "product.deleted"));
    expect(routes(fetchMock)).toEqual(["DELETE /products/rec_1"]);
  });
});

describe("sync route", () => {
  it("is a private POST route", () => {
    expect(syncFn.config.route).toEqual({ methods: ["post"], public: false });
  });

  it("rejects when the API key is missing or the integration is disabled", async () => {
    for (const [omnisend, message] of [
      [{ ...settings, api_key: "" }, "Omnisend API key not configured"],
      [{ ...settings, enabled: false }, "Omnisend integration is disabled"],
    ] as const) {
      const swell = mockSwell();
      swell.settings.mockResolvedValue({ omnisend });
      await expect(syncFn.post(createMockRequest({ swell }))).rejects.toMatchObject({ message, status: 400 });
    }
  });

  it("syncs contacts, products and orders in order, waiting for each batch", async () => {
    skipDelays();
    const fetchMock = mockOmnisend({ "GET /batches": { body: { batches: [{ status: "finished" }] } } });
    const once = (item: any) => (q: any) => ({ results: q.page === 1 ? [item] : [] });
    const swell = mockSwell({
      "/accounts": once(makeAccount()),
      "/products": once(makeProduct()),
      "/orders": once(makeOrder()),
    });

    const res = await syncFn.post(createMockRequest({ swell }));

    expect(res).toEqual({ success: true });
    expect(calls(fetchMock).map((c) => c.body?.endpoint ?? `${c.method} ${c.query.endpoint}`)).toEqual([
      "contacts",
      "GET contacts",
      "products",
      "GET products",
      "orders",
      "GET orders",
    ]);
  });
});

describe("validate-login route", () => {
  it("is a private POST route", () => {
    expect(validateFn.config.route).toEqual({ methods: ["post"], public: false });
  });

  it("requires api_key", async () => {
    await expect(validateFn.post(createMockRequest({ data: {} }))).rejects.toMatchObject({ status: 400 });
  });

  it("returns whether Omnisend accepts the key", async () => {
    mockOmnisend({ "POST /contacts": [{ status: 200 }, { status: 403 }] });
    await expect(validateFn.post(createMockRequest({ data: { api_key: "good" } }))).resolves.toEqual({ success: true });
    await expect(validateFn.post(createMockRequest({ data: { api_key: "bad" } }))).resolves.toEqual({ success: false });
  });
});
