import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OmnisendClient } from "../../functions/lib/omnisend-client";
import { createOrder, updateOrder, syncOrders } from "../../functions/lib/order";
import { mockOmnisend, mockSwell, calls, makeOrder, settings } from "../helpers/omnisend-fixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const client = () => new OmnisendClient("k");

async function createdBody(order: any) {
  const fetchMock = mockOmnisend();
  await createOrder(mockSwell({ "/orders/{id}": order }), client(), settings, order.id);
  const body = calls(fetchMock)[0].body;
  fetchMock.mockRestore();
  return body;
}

describe("createOrder", () => {
  it("does nothing when the order is missing", async () => {
    const fetchMock = mockOmnisend();
    await createOrder(mockSwell(), client(), settings, "ord_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the order with totals in cents", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/orders/{id}": makeOrder() });

    await createOrder(swell, client(), settings, "ord_1");

    expect(swell.get).toHaveBeenCalledWith("/orders/{id}", { id: "ord_1", expand: ["items.product", "account"] });
    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "POST", path: "/orders" });
    expect(call.body).toMatchObject({
      orderID: "ord_1",
      currency: "USD",
      cartID: "cart_1",
      email: "jane@example.com",
      orderNumber: 1001,
      orderSum: 2500,
      subTotalSum: 2100,
      discountSum: 0,
      taxSum: 100,
      shippingSum: 400,
      shippingMethod: "shipment",
      courierTitle: "UPS",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      shippingAddress: { firstName: "Jane", lastName: "Doe", city: "NYC", countryCode: "US" },
      billingAddress: { firstName: "Jane", lastName: "Doe", city: "NYC", countryCode: "US" },
    });
    expect(call.body.products[0]).toMatchObject({ productID: "prod_1", price: 1050, quantity: 2 });
    expect(call.body.shippingAddress.last_name).toBeUndefined();
    expect(call.body.billingAddress.last_name).toBeUndefined();
  });

  it("uses null order number when it has no digits", async () => {
    expect((await createdBody(makeOrder({ number: "ABC" }))).orderNumber).toBeNull();
  });

  it.each([
    [{ payment_total: 10, grand_total: 25, payment_balance: -15 }, "partiallyPaid"],
    [{ refund_total: 5, payment_total: 25 }, "partiallyRefunded"],
    [{ refund_total: 25, payment_total: 25 }, "refunded"],
    [{ payment_total: 0, payment_balance: -25 }, "awaitingPayment"],
    [{ payment_total: 0, grand_total: 0, payment_balance: 0 }, undefined],
  ])("maps payment state %j to %s", async (overrides, expected) => {
    expect((await createdBody(makeOrder(overrides))).paymentStatus).toBe(expected);
  });

  it.each([
    [{ delivered: false, item_quantity_deliverable: 2 }, "unfulfilled"],
    [{ delivered: true, item_quantity_returned: 1 }, undefined],
  ])("maps fulfillment state %j to %s", async (overrides, expected) => {
    expect((await createdBody(makeOrder(overrides))).fulfillmentStatus).toBe(expected);
  });

  it("logs Omnisend errors", async () => {
    mockOmnisend({ "POST /orders": { status: 400 } });
    await createOrder(mockSwell({ "/orders/{id}": makeOrder() }), client(), settings, "ord_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("updateOrder", () => {
  it("replaces the order with a null canceled date when active", async () => {
    const fetchMock = mockOmnisend();
    await updateOrder(mockSwell({ "/orders/{id}": makeOrder() }), client(), settings, "ord_1");

    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "PUT", path: "/orders/ord_1" });
    expect(call.body.canceledDate).toBeNull();
    expect(call.body.orderID).toBeUndefined();
  });

  it("uses the Swell cancel date for canceled orders", async () => {
    const fetchMock = mockOmnisend();
    const order = makeOrder({ canceled: true, date_canceled: "2026-03-01T00:00:00.000Z" });
    await updateOrder(mockSwell({ "/orders/{id}": order }), client(), settings, "ord_1");
    expect(calls(fetchMock)[0].body.canceledDate).toBe("2026-03-01T00:00:00.000Z");
  });

  it("keeps the cancel date already stored in Omnisend", async () => {
    const fetchMock = mockOmnisend({
      "GET /orders/ord_1": { body: { canceledDate: "2026-02-15T00:00:00.000Z" } },
    });
    await updateOrder(mockSwell({ "/orders/{id}": makeOrder({ canceled: true }) }), client(), settings, "ord_1");
    const put = calls(fetchMock).find((c) => c.method === "PUT")!;
    expect(put.body.canceledDate).toBe("2026-02-15T00:00:00.000Z");
  });

  it("falls back to the current time when no cancel date is known", async () => {
    const fetchMock = mockOmnisend({ "GET /orders/ord_1": { status: 404 } });
    await updateOrder(mockSwell({ "/orders/{id}": makeOrder({ canceled: true }) }), client(), settings, "ord_1");
    const put = calls(fetchMock).find((c) => c.method === "PUT")!;
    expect(Number.isNaN(Date.parse(put.body.canceledDate))).toBe(false);
  });
});

describe("syncOrders", () => {
  it("sends each page of orders as a batch", async () => {
    const fetchMock = mockOmnisend();
    const pages: Record<number, any> = {
      1: { results: [makeOrder(), makeOrder({ id: "ord_2", canceled: true, date_canceled: "2026-03-01" })] },
      2: { results: [] },
    };
    const swell = mockSwell({ "/orders": (q: any) => pages[q.page] });

    await syncOrders(swell, client(), settings);

    const [batch] = calls(fetchMock);
    expect(calls(fetchMock)).toHaveLength(1);
    expect(batch.body).toMatchObject({ method: "POST", endpoint: "orders" });
    expect(batch.body.items.map((i: any) => [i.orderID, i.canceledDate])).toEqual([
      ["ord_1", null],
      ["ord_2", "2026-03-01"],
    ]);
  });
});
