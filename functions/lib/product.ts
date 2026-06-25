import currency from 'currency.js';
import { OmnisendClient, OmnisendSettings } from './omnisend-client';

function mapProductStatus(status: string | null): string | null {
  switch (status) {
    case 'in_stock':
      return 'inStock';
    case 'out_of_stock':
      return 'outOfStock';
    case null:
      return null;
    default:
      return 'notAvailable';
  }
}

const isNumber = (value: any) => typeof value === 'number' && !isNaN(value);

function calcVariantBasePrice(product: any, variant: any, basePrice: number | null | undefined) {
  let price = basePrice !== undefined ? basePrice : product?.price ?? 0;

  if (product && variant && Array.isArray(variant.option_value_ids) && Array.isArray(product.options)) {
    let subPrice = 0;
    let optionPrice = 0;

    const subOption = product.options.find((opt: any) => opt.subscription === true);

    for (const option of product.options || []) {
      for (const optionValue of option.values || []) {
        const currencyPrice = optionValue?.$currency?.[product.currency]?.price;

        const value = {
          ...optionValue,
          price: isNumber(currencyPrice) ? currencyPrice : optionValue.price,
        };

        if (
          variant.option_value_ids.includes(value.id) &&
          typeof value.price === 'number'
        ) {
          if (subOption === option) {
            subPrice = value.price || 0;
          } else {
            optionPrice += value.price || 0;
          }
        }
      }
    }

    if (subOption) {
      price = (subPrice || price || 0) + optionPrice;
    } else if (optionPrice !== 0) {
      price = (price || 0) + optionPrice;
    }
  }

  return typeof price === 'number' ? price : null;
}

function getCalculatedVariantPrice(product: any, variant: any) {
  if (!product || !variant) {
    return 0;
  }

  // Sale price
  const variantSalePrice = parseFloat(variant.sale_price);
  if (variant.sale && Number.isFinite(variantSalePrice)) {
    return variantSalePrice;
  }

  const productSalePriceVal = parseFloat(product?.sale_price);
  if ((product?.sale || variant.sale) && Number.isFinite(productSalePriceVal)) {
    return calcVariantBasePrice(product, variant, productSalePriceVal) ?? 0;
  }

  // Regular price
  const variantPrice = parseFloat(variant.price);
  if (Number.isFinite(variantPrice)) {
    return variantPrice;
  }

  if (product) {
    return calcVariantBasePrice(product, variant, undefined) ?? 0;
  }

  return 0;
}

function buildProductBody(product: any, storeUrl: string): object {
  const variants: any[] = product.variants?.results ?? [];

  return {
    productID: product.id,
    title: product.name,
    status: mapProductStatus(product.stock_status),
    currency: product.currency,
    description: product.description,
    tags: product.tags,
    productUrl: `${storeUrl}/${product.sku || product.slug}`,
    images: product.images?.[0]?.id
      ? [{ imageID: product.images[0].id, url: product.images[0].file?.url, isDefault: true }]
      : [{ imageID: 'placeholder', url: 'https://cdn.omnisend.com/placeholder.png', isDefault: false }],
    variants:
      variants.length > 0
        ? variants.map((variant) => ({
            variantId: variant.id || product.id,
            title: variant.name,
            status: mapProductStatus(product.stock_status),
            currency: product.currency,
            productUrl: `${storeUrl}/${variant.sku || product.sku || product.slug}`,
            sku: variant.sku || product.sku || product.slug,
            price: currency(getCalculatedVariantPrice(product, variant)).intValue,
          }))
        : [
            {
              variantId: product.id,
              title: product.name,
              status: mapProductStatus(product.stock_status),
              currency: product.currency,
              productUrl: `${storeUrl}/${product.sku || product.slug}`,
              sku: product.sku || product.slug,
              price: product.sale
                ? currency(product.sale_price).intValue
                : currency(product.price).intValue,
            },
          ],
  };
}

async function fetchProduct(swell: SwellRequest['swell'], productId: string): Promise<any> {
  return swell.get('/products/{id}', {
    id: productId,
    include: {
      variants: {
        url: '/products:variants',
        params: {
          parent_id: 'id',
          limit: 1000,
        },
      },
    },
  } as any);
}

export async function createProduct(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  productId: string,
): Promise<void> {
  const product = await fetchProduct(swell, productId);
  if (!product) return;

  const body = buildProductBody(product, settings.store_url!);
  try {
    await client.post('/products/', body);
    console.log(`Omnisend: created product ${productId}`);
  } catch (err: any) {
    console.error(`Omnisend createProduct error: ${err.message}`);
  }
}

export async function updateProduct(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  itemId: string,
  isVariant: boolean,
): Promise<void> {
  let productId = itemId;

  if (isVariant) {
    const variant = await swell.get('/products:variants/{id}', { id: itemId } as any) as any;
    productId = variant?.parent_id || itemId;
  }

  const product = await fetchProduct(swell, productId);
  if (!product) return;

  const body = buildProductBody(product, settings.store_url!);
  try {
    await client.put(`/products/${product.id}`, body);
    console.log(`Omnisend: updated product ${product.id}`);
  } catch (err: any) {
    console.error(`Omnisend updateProduct error: ${err.message}`);
  }
}

export async function deleteProduct(
  client: OmnisendClient,
  productId: string,
): Promise<void> {
  try {
    await client.delete(`/products/${productId}`);
    console.log(`Omnisend: deleted product ${productId}`);
  } catch (err: any) {
    console.error(`Omnisend deleteProduct error: ${err.message}`);
  }
}

export async function syncProducts(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
): Promise<void> {
  let page = 0;

  do {
    const result = await swell.get('/products', {
      limit: 1000,
      page: page + 1,
      include: {
        variants: {
          url: '/products:variants',
          params: {
            parent_id: 'id',
            limit: 1000,
          },
        },
      },
    } as any) as any;

    if (!result?.results?.length) {
      console.log('Omnisend: products sync complete');
      return;
    }

    const items = result.results.map((product: any) => buildProductBody(product, settings.store_url!));

    try {
      await client.post('/batches', { method: 'POST', endpoint: 'products', items });
    } catch (err: any) {
      console.error(`Omnisend syncProducts batch error: ${err.message}`);
    }

    page += 1;
  } while (true);
}
