import currency from 'currency.js';
import { OmnisendClient, OmnisendSettings } from './omnisend-client';
import { getLocalizedRecord } from './localization';

function buildCartBody(cart: any, storeUrl: string): object {
  return {
    cartID: cart.id,
    currency: cart.currency,
    cartSum: currency(cart.grand_total).intValue,
    checkoutID: cart.checkout_id,
    cartRecoveryUrl: cart.checkout_url,
    languageCode: cart.display_locale,
    products: (cart.items ?? []).map((item: any) => ({
      currency: cart.currency,
      title: item.product?.name ?? null,
      cartProductID: item.id,
      productID: item.product_id,
      variantID: item.variant_id || item.product_id,
      quantity: item.quantity,
      price: currency(item.price).intValue,
      productUrl: `${storeUrl}/${item.product?.sku ?? item.product?.slug ?? null}`,
      imageUrl: item.product?.images?.[0]?.file?.url,
    })),
  };
}

export async function cartCreate(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  cartId: string,
): Promise<void> {
  const cart = await getLocalizedRecord(swell, settings, '/carts/{id}', {
    id: cartId,
    expand: ['items.product', 'items.variant'],
    include: {
      account: {
        url: '/accounts/{account_id}',
        data: { fields: 'email' },
      },
    },
  }) as any;

  if (!cart?.account) {
    // Skip carts with no linked account — Omnisend requires an email
    return;
  }

  const body = {
    ...buildCartBody(cart, settings.store_url!),
    email: cart.account.email,
  };

  try {
    await client.post('/carts', body);
    console.log(`Omnisend: created cart ${cartId}`);
  } catch (err: any) {
    console.error(`Omnisend cartCreate error: ${err.message}`);
  }
}

export async function cartDelete(
  client: OmnisendClient,
  cartId: string,
): Promise<void> {
  try {
    await client.delete(`/carts/${cartId}`);
    console.log(`Omnisend: deleted cart ${cartId}`);
  } catch (err: any) {
    console.error(`Omnisend cartDelete error: ${err.message}`);
  }
}

export async function cartUpdate(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  cartId: string,
): Promise<void> {
  // If the cart doesn't exist in Omnisend yet, create it instead
  try {
    await client.get(`/carts/${cartId}`);
  } catch {
    return cartCreate(swell, client, settings, cartId);
  }

  const cart = await getLocalizedRecord(swell, settings, '/carts/{id}', {
    id: cartId,
    expand: ['items.product', 'items.variant'],
  }) as any;

  if (!cart) return;

  const body = buildCartBody(cart, settings.store_url!);
  try {
    await client.put(`/carts/${cartId}`, body);
    console.log(`Omnisend: updated cart ${cartId}`);
  } catch (err: any) {
    console.error(`Omnisend cartUpdate error: ${err.message}`);
  }
}
