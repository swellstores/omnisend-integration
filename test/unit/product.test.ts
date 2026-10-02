import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OmnisendClient } from "../../functions/lib/omnisend-client";
import { createProduct, updateProduct, deleteProduct, syncProducts } from "../../functions/lib/product";
import { mockOmnisend, mockSwell, calls, makeProduct, settings } from "../helpers/omnisend-fixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const client = () => new OmnisendClient("k");

async function createdBody(product: any) {
  const fetchMock = mockOmnisend();
  await createProduct(mockSwell({ "/products/{id}": product }), client(), settings, product.id);
  const body = calls(fetchMock)[0].body;
  fetchMock.mockRestore();
  return body;
}

describe("createProduct", () => {
  it("does nothing when the product is missing", async () => {
    const fetchMock = mockOmnisend();
    await createProduct(mockSwell(), client(), settings, "prod_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the product with its variants and option prices", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({ "/products/{id}": makeProduct() });

    await createProduct(swell, client(), settings, "prod_1");

    expect(swell.get.mock.calls[0][1]).toMatchObject({
      id: "prod_1",
      include: { variants: { url: "/products:variants", params: { parent_id: "id", limit: 1000 } } },
    });
    const [call] = calls(fetchMock);
    expect(call).toMatchObject({ method: "POST", path: "/products/" });
    expect(call.body).toEqual({
      productID: "prod_1",
      title: "Shirt",
      status: "inStock",
      currency: "USD",
      description: "A shirt",
      tags: ["tops"],
      productUrl: "https://shop.test/SHIRT",
      images: [{ imageID: "img_1", url: "https://cdn/shirt.jpg", isDefault: true }],
      variants: [
        {
          variantId: "var_s",
          title: "Shirt S",
          status: "inStock",
          currency: "USD",
          productUrl: "https://shop.test/SHIRT-S",
          sku: "SHIRT-S",
          price: 1000,
        },
        {
          variantId: "var_l",
          title: "Shirt L",
          status: "inStock",
          currency: "USD",
          productUrl: "https://shop.test/SHIRT-L",
          sku: "SHIRT-L",
          price: 1200,
        },
      ],
    });
  });

  it("sends a single variant for products without variants", async () => {
    const body = await createdBody(makeProduct({ variants: { results: [] }, sale: true, sale_price: 8 }));
    expect(body.variants).toEqual([
      expect.objectContaining({ variantId: "prod_1", sku: "SHIRT", price: 800 }),
    ]);
  });

  it.each([
    [{ variants: { results: [{ id: "v", sale: true, sale_price: 7 }] } }, 700],
    [{ sale: true, sale_price: 9, variants: { results: [{ id: "v", option_value_ids: ["val_l"] }] } }, 1100],
    [{ variants: { results: [{ id: "v", price: 15 }] } }, 1500],
  ])("calculates variant price for %j as %i cents", async (overrides, cents) => {
    expect((await createdBody(makeProduct(overrides))).variants[0].price).toBe(cents);
  });

  it.each([
    ["out_of_stock", "outOfStock"],
    ["preorder", "notAvailable"],
    [null, null],
  ])("maps stock status %s to %s", async (stock, status) => {
    expect((await createdBody(makeProduct({ stock_status: stock }))).status).toBe(status);
  });

  it("uses a placeholder image when the product has none", async () => {
    const body = await createdBody(makeProduct({ images: [] }));
    expect(body.images).toEqual([
      { imageID: "placeholder", url: "https://cdn.omnisend.com/placeholder.png", isDefault: false },
    ]);
  });

  it("logs Omnisend errors", async () => {
    mockOmnisend({ "POST /products/": { status: 400 } });
    await createProduct(mockSwell({ "/products/{id}": makeProduct() }), client(), settings, "prod_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("updateProduct", () => {
  it("replaces the product", async () => {
    const fetchMock = mockOmnisend();
    await updateProduct(mockSwell({ "/products/{id}": makeProduct() }), client(), settings, "prod_1", false);
    expect(calls(fetchMock)[0]).toMatchObject({ method: "PUT", path: "/products/prod_1" });
  });

  it("resolves the parent product for variant updates", async () => {
    const fetchMock = mockOmnisend();
    const swell = mockSwell({
      "/products:variants/{id}": { id: "var_s", parent_id: "prod_1" },
      "/products/{id}": makeProduct(),
    });

    await updateProduct(swell, client(), settings, "var_s", true);

    expect(swell.get).toHaveBeenCalledWith("/products:variants/{id}", { id: "var_s" });
    expect(swell.get.mock.calls[1][1].id).toBe("prod_1");
    expect(calls(fetchMock)[0].path).toBe("/products/prod_1");
  });
});

describe("deleteProduct", () => {
  it("deletes the product", async () => {
    const fetchMock = mockOmnisend({ "DELETE /products/prod_1": { status: 204 } });
    await deleteProduct(client(), "prod_1");
    expect(calls(fetchMock)[0]).toMatchObject({ method: "DELETE", path: "/products/prod_1" });
  });

  it("logs errors", async () => {
    mockOmnisend({ "DELETE /products/prod_1": { status: 404 } });
    await deleteProduct(client(), "prod_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("syncProducts", () => {
  it("sends each page of products as a batch", async () => {
    const fetchMock = mockOmnisend();
    const pages: Record<number, any> = {
      1: { results: [makeProduct(), makeProduct({ id: "prod_2" })] },
      2: { results: [] },
    };
    const swell = mockSwell({ "/products": (q: any) => pages[q.page] });

    await syncProducts(swell, client(), settings);

    expect(calls(fetchMock)).toHaveLength(1);
    const [batch] = calls(fetchMock);
    expect(batch.body).toMatchObject({ method: "POST", endpoint: "products" });
    expect(batch.body.items.map((p: any) => p.productID)).toEqual(["prod_1", "prod_2"]);
  });
});
