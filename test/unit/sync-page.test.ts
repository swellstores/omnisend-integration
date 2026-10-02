import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  SyncError,
  parseCreatedAfter,
  parseEntity,
  parsePageSize,
  syncEntityPage,
} from "../../functions/lib/sync";
import { OmnisendError } from "../../functions/lib/omnisend-client";
import {
  calls,
  makeAccount,
  makeOrder,
  makeProduct,
  mockOmnisend,
  mockSwell,
  settings,
} from "../helpers/omnisend-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const page = (results: any[], count = results.length) => () => ({ count, results });

describe("parsers", () => {
  it.each(["contacts", "products", "orders"])("accepts entity %s", (entity) => {
    expect(parseEntity(entity)).toBe(entity);
  });

  it.each(["carts", "", undefined, 1])("rejects entity %j", (entity) => {
    expect(() => parseEntity(entity)).toThrow("Invalid entity, use one of contacts, products, orders");
  });

  it("defaults the page size and accepts allowed sizes", () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(1000)).toBe(1000);
    expect(parsePageSize("10")).toBe(10);
  });

  it.each([50, 1001, "all"])("rejects page size %j", (size) => {
    expect(() => parsePageSize(size)).toThrow("Invalid page size, use one of 10, 100, 200, 500, 1000");
  });

  it("normalizes dates to ISO and rejects invalid ones", () => {
    expect(parseCreatedAfter(undefined)).toBeUndefined();
    expect(parseCreatedAfter("")).toBeUndefined();
    expect(parseCreatedAfter("2026-09-01T00:00:00+02:00")).toBe("2026-08-31T22:00:00.000Z");
    expect(() => parseCreatedAfter("yesterday")).toThrow("Invalid created_after date");
    expect(() => parseCreatedAfter(123)).toThrow(SyncError);
  });
});

describe("syncEntityPage checks", () => {
  it.each([0, 1.5, -1])("rejects page %j", async (p) => {
    await expect(syncEntityPage(mockSwell(), "contacts", p)).rejects.toMatchObject({ message: "Invalid page", status: 400 });
  });

  it("requires an API key", async () => {
    const swell = mockSwell();
    swell.settings.mockResolvedValue({ omnisend: { ...settings, api_key: "" } });
    await expect(syncEntityPage(swell, "contacts", 1)).rejects.toMatchObject({
      message: "Omnisend API key is not set in app settings",
      status: 400,
    });
  });

  it("requires the integration to be enabled", async () => {
    const swell = mockSwell();
    swell.settings.mockResolvedValue({ omnisend: { ...settings, enabled: false } });
    await expect(syncEntityPage(swell, "orders", 1)).rejects.toMatchObject({
      message: "Omnisend integration is disabled in app settings",
      status: 400,
    });
  });
});

describe("syncEntityPage contacts", () => {
  it("sends one page of accounts as a batch and tags them in one request", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({
      "/accounts": page([makeAccount({ email_optin: true }), makeAccount({ id: "acc_2", email: undefined })], 250),
    });

    const result = await syncEntityPage(swell, "contacts", 2, { limit: 10 });

    expect(result).toEqual({ entity: "contacts", page: 2, limit: 10, count: 250, synced: 2, done: true });
    expect(swell.get).toHaveBeenCalledWith("/accounts", { sort: "date_created asc", limit: 10, page: 2 });
    const [batch] = calls(fetchMock);
    expect(batch).toMatchObject({ method: "POST", path: "/batches", body: { method: "POST", endpoint: "contacts" } });
    expect(batch.body.items.map((i: any) => i.id)).toEqual(["acc_1", "acc_2"]);
    expect(batch.body.items[0].identifiers[0].channels.email.status).toBe("subscribed");
    expect(swell.post).toHaveBeenCalledWith("/:batch", [
      { url: "/accounts/acc_1", method: "put", data: { $events: false, omnisend_email: "jane@example.com" } },
    ]);
  });

  it("is done only when the page is not full", async () => {
    mockOmnisend();
    const swell = mockSwell({ "/accounts": page([makeAccount()], 30) });
    expect((await syncEntityPage(swell, "contacts", 1, { limit: 10 })).done).toBe(true);

    const full = mockSwell({ "/accounts": page(Array.from({ length: 10 }, (_, i) => makeAccount({ id: `a${i}` })), 30) });
    expect((await syncEntityPage(full, "contacts", 1, { limit: 10 })).done).toBe(false);
  });

  it("filters by creation date", async () => {
    mockOmnisend();
    const swell = mockSwell({ "/accounts": page([]) });

    await syncEntityPage(swell, "contacts", 1, { createdAfter: "2026-08-31T22:00:00.000Z" });

    expect(swell.get).toHaveBeenCalledWith("/accounts", {
      date_created: { $gte: "2026-08-31T22:00:00.000Z" },
      sort: "date_created asc",
      limit: DEFAULT_PAGE_SIZE,
      page: 1,
    });
  });

  it("makes no Omnisend or tag requests for an empty page", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/accounts": page([]) });

    const result = await syncEntityPage(swell, "contacts", 1);

    expect(result).toEqual({ entity: "contacts", page: 1, limit: DEFAULT_PAGE_SIZE, count: 0, synced: 0, done: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(swell.post).not.toHaveBeenCalled();
  });

  it("fails with the Omnisend error and does not tag accounts", async () => {
    mockOmnisend({ "POST /batches": { status: 400, body: { error: "bad batch" } } });
    const swell = mockSwell({ "/accounts": page([makeAccount()]) });

    const error = await syncEntityPage(swell, "contacts", 1).catch((err) => err);

    expect(error).toBeInstanceOf(OmnisendError);
    expect(error.status).toBe(400);
    expect(swell.post).not.toHaveBeenCalled();
  });
});

describe("syncEntityPage products", () => {
  it("sends one page of products with variants as a batch", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/products": page([makeProduct(), makeProduct({ id: "prod_2" })]) });

    const result = await syncEntityPage(swell, "products", 1, { limit: 100 });

    expect(result).toMatchObject({ entity: "products", synced: 2, count: 2, done: true });
    expect(swell.get.mock.calls[0][1]).toMatchObject({
      sort: "date_created asc",
      limit: 100,
      page: 1,
      include: { variants: { url: "/products:variants", params: { parent_id: "id", limit: 1000 } } },
    });
    const [batch] = calls(fetchMock);
    expect(batch.body.endpoint).toBe("products");
    expect(batch.body.items.map((p: any) => [p.productID, p.productUrl])).toEqual([
      ["prod_1", "https://shop.test/SHIRT"],
      ["prod_2", "https://shop.test/SHIRT"],
    ]);
    expect(swell.post).not.toHaveBeenCalled();
  });
});

describe("syncEntityPage orders", () => {
  it("sends one page of orders with cancel dates as a batch", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({
      "/orders": page([makeOrder(), makeOrder({ id: "ord_2", canceled: true, date_canceled: "2026-03-01" })]),
    });

    const result = await syncEntityPage(swell, "orders", 1);

    expect(result).toMatchObject({ entity: "orders", synced: 2, done: true });
    expect(swell.get).toHaveBeenCalledWith("/orders", {
      sort: "date_created asc",
      limit: DEFAULT_PAGE_SIZE,
      expand: ["items.product", "account"],
      page: 1,
    });
    const [batch] = calls(fetchMock);
    expect(batch.body.endpoint).toBe("orders");
    expect(batch.body.items.map((o: any) => [o.orderID, o.canceledDate])).toEqual([
      ["ord_1", null],
      ["ord_2", "2026-03-01"],
    ]);
  });

  it("refetches orders in their display locale when enabled", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({
      "/settings/store": { locale: "en" },
      "/orders": (q: any) =>
        q.$locale
          ? { results: [makeOrder({ id: "ord_fr", display_locale: "fr", items: [] })] }
          : { count: 1, results: [makeOrder({ id: "ord_fr", display_locale: "fr" })] },
    });
    swell.settings.mockResolvedValue({ omnisend: { ...settings, use_display_locale: true } });

    await syncEntityPage(swell, "orders", 1);

    expect(swell.get).toHaveBeenCalledWith("/orders", expect.objectContaining({ id: { $in: ["ord_fr"] }, $locale: "fr" }));
    expect(calls(fetchMock)[0].body.items[0].products).toEqual([]);
  });
});
