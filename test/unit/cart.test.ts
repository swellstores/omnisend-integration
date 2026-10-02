import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OmnisendClient } from "../../functions/lib/omnisend-client";
import { cartCreate, cartUpdate, cartDelete } from "../../functions/lib/cart";
import { mockOmnisend, mockSwell, calls, makeItem, settings } from "../helpers/omnisend-fixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const client = () => new OmnisendClient("k");

function makeCart(overrides: Record<string, any> = {}) {
  return {
    id: "cart_1",
    currency: "USD",
    grand_total: 21,
    checkout_id: "chk_1",
    checkout_url: "https://shop.test/checkout/chk_1",
    display_locale: "en",
    account: { email: "jane@example.com" },
    items: [makeItem()],
    ...overrides,
  };
}

describe("cartCreate", () => {
  it("skips carts without an account", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/carts/{id}": makeCart({ account: undefined }) });
    await cartCreate(swell, client(), settings, "cart_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the cart with amounts in cents and product links", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/carts/{id}": makeCart() });

    await cartCreate(swell, client(), settings, "cart_1");

    expect(swell.get).toHaveBeenCalledWith("/carts/{id}", expect.objectContaining({
      id: "cart_1",
      expand: ["items.product", "items.variant"],
    }));
    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "POST", path: "/carts" });
    expect(call.body).toEqual({
      cartID: "cart_1",
      currency: "USD",
      cartSum: 2100,
      checkoutID: "chk_1",
      cartRecoveryUrl: "https://shop.test/checkout/chk_1",
      languageCode: "en",
      email: "jane@example.com",
      products: [
        {
          currency: "USD",
          title: "Shirt",
          cartProductID: "item_1",
          productID: "prod_1",
          variantID: "var_1",
          quantity: 2,
          price: 1050,
          productUrl: "https://shop.test/SHIRT",
          imageUrl: "https://cdn/shirt.jpg",
        },
      ],
    });
  });

  it("uses the product ID as variant ID for items without a variant", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/carts/{id}": makeCart({ items: [makeItem({ variant_id: undefined })] }) });
    await cartCreate(swell, client(), settings, "cart_1");
    expect(calls(fetchMock)[0].body.products[0].variantID).toBe("prod_1");
  });

  it("logs Omnisend errors", async () => {
    mockOmnisend({ "POST /carts": { status: 400 } });
    await cartCreate(mockSwell({ "/carts/{id}": makeCart() }), client(), settings, "cart_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("cartUpdate", () => {
  it("creates the cart when it does not exist in Omnisend", async () => {
    const fetchMock = mockOmnisend({ "GET /carts/cart_1": { status: 404 } });
    const swell = mockSwell({ "/carts/{id}": makeCart() });

    await cartUpdate(swell, client(), settings, "cart_1");

    expect(calls(fetchMock).map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /carts/cart_1",
      "POST /carts",
    ]);
  });

  it("replaces an existing cart", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/carts/{id}": makeCart() });

    await cartUpdate(swell, client(), settings, "cart_1");

    const [, put] = calls(fetchMock);
    expect(put).toMatchObject({ method: "PUT", path: "/carts/cart_1" });
    expect(put.body.cartSum).toBe(2100);
  });
});

describe("cartDelete", () => {
  it("deletes the cart", async () => {
    const fetchMock = mockOmnisend({ "DELETE /carts/cart_1": { status: 204 } });
    await cartDelete(client(), "cart_1");
    expect(calls(fetchMock)[0]).toMatchObject({ method: "DELETE", path: "/carts/cart_1" });
  });

  it("logs errors", async () => {
    mockOmnisend({ "DELETE /carts/cart_1": { status: 404 } });
    await cartDelete(client(), "cart_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});
