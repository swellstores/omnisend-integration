import currency from 'currency.js';
import { OmnisendClient, OmnisendSettings } from './omnisend-client';
import { getLocalizedRecord, getLocalizedResults, getDefaultLocale } from './localization';

function fulfillmentStatus(order: any): string | undefined {
  if (order.item_quantity_returned <= 0 && order.delivered) {
    return 'fulfilled';
  }
  if (order.item_quantity_deliverable > 0) {
    return 'unfulfilled';
  }

  return undefined;
}

function paymentDue(order: any): number | undefined {
  if (!order.canceled && order.payment_balance < 0) {
    return -order.payment_balance;
  }

  return undefined;
}

function paymentStatus(order: any): string | undefined {
  if (
    order.payment_total > 0 &&
    order.payment_total > order.refund_total &&
    order.payment_total < order.grand_total &&
    paymentDue(order)
  ) {
    return 'partiallyPaid';
  }
  if (order.refund_total > 0 && order.refund_total < order.payment_total) {
    return 'partiallyRefunded';
  }
  if (order.refund_total > 0 && order.refund_total === order.payment_total) {
    return 'refunded';
  }
  if (order.payment_total > 0 && order.payment_balance === 0) {
    return 'paid';
  }
  if (order.grand_total > 0) {
    return 'awaitingPayment';
  }

  return undefined;
}

function buildOrderBody(order: any, storeUrl: string): object {
  return {
    currency: order.currency,
    cartID: order.cart_id,
    createdAt: order.date_created,
    languageCode: order.display_locale,
    email: order.account?.email,
    // orderNumber should be integer, extract all digits from the order number
    orderNumber: Number((order.number ?? '').replace(/\D/g, '')) || null,
    paymentStatus: paymentStatus(order),
    fulfillmentStatus: fulfillmentStatus(order),
    shippingMethod: order.delivery,
    orderSum: currency(order.grand_total).intValue,
    subTotalSum: currency(order.sub_total).intValue,
    discountSum: currency(order.discount_total).intValue,
    taxSum: currency(order.tax_included_total).intValue,
    shippingSum: currency(order.shipment_total).intValue,
    courierTitle: order.shipping?.service_name,
    shippingAddress: order.shipping
      ? {
          firstName: order.shipping.first_name,
          last_name: order.shipping.last_name,
          company: order.shipping.company,
          address: order.shipping.address1,
          address2: order.shipping.address2,
          city: order.shipping.city,
          phone: order.shipping.phone,
          state: order.shipping.state,
          postalCode: order.shipping.zip,
          countryCode: order.shipping.country,
        }
      : undefined,
    billingAddress: order.billing
      ? {
          firstName: order.billing.first_name,
          last_name: order.billing.last_name,
          company: order.billing.company,
          address: order.billing.address1,
          address2: order.billing.address2,
          city: order.billing.city,
          phone: order.billing.phone,
          state: order.billing.state,
          postalCode: order.billing.zip,
          countryCode: order.billing.country,
        }
      : undefined,
    products: (order.items ?? []).map((item: any) => ({
      currency: order.currency,
      title: item.product?.name ?? item.product_id,
      cartProductID: item.id,
      productID: item.product_id,
      variantID: item.variant_id || item.product_id,
      quantity: item.quantity,
      price: currency(item.price).intValue,
      productUrl: `${storeUrl}/${item.product?.sku ?? item.product?.slug ?? item.product_id}`,
      imageUrl: item.product?.images?.[0]?.file?.url,
    })),
  };
}

export async function createOrder(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  orderId: string,
): Promise<void> {
  const order = await getLocalizedRecord(swell, settings, '/orders/{id}', {
    id: orderId,
    expand: ['items.product', 'account'],
  }) as any;
  if (!order) return;

  const body = { orderID: order.id, ...buildOrderBody(order, settings.store_url!) };
  try {
    await client.post('/orders', body);
    console.log(`Omnisend: created order ${orderId}`);
  } catch (err: any) {
    console.error(`Omnisend createOrder error: ${err.message}`);
  }
}

export async function updateOrder(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
  orderId: string,
): Promise<void> {
  const order = await getLocalizedRecord(swell, settings, '/orders/{id}', {
    id: orderId,
    expand: ['items.product', 'account'],
  }) as any;
  if (!order) return;

  let canceledDate: string | null = null;
  if (order.canceled) {
    canceledDate = order.date_canceled;
    if (!canceledDate) {
      try {
        const existing = await client.get(`/orders/${orderId}`) as any;
        canceledDate = existing?.canceledDate || new Date().toISOString();
      } catch {
        canceledDate = new Date().toISOString();
      }
    }
  }

  const body = { ...buildOrderBody(order, settings.store_url!), canceledDate };
  try {
    await client.put(`/orders/${orderId}`, body);
    console.log(`Omnisend: updated order ${orderId}`);
  } catch (err: any) {
    console.error(`Omnisend updateOrder error: ${err.message}`);
  }
}

export async function syncOrders(
  swell: SwellRequest['swell'],
  client: OmnisendClient,
  settings: OmnisendSettings,
): Promise<void> {
  const defaultLocale = settings.use_display_locale ? await getDefaultLocale(swell) : undefined;
  const ordersQuery = { limit: 1000, expand: ['items.product', 'account'] };
  let page = 0;

  do {
    const result = await swell.get('/orders', {
      ...ordersQuery,
      page: page + 1,
    } as any) as any;

    if (!result?.results?.length) {
      console.log('Omnisend: orders sync complete');
      return;
    }

    const localized = await getLocalizedResults(
      swell,
      settings,
      defaultLocale,
      '/orders',
      ordersQuery,
      result.results,
    );

    const items = localized.map((order: any) => ({
      orderID: order.id,
      ...buildOrderBody(order, settings.store_url!),
      canceledDate: order.canceled
        ? order.date_canceled || new Date().toISOString()
        : null,
    }));

    try {
      await client.post('/batches', { method: 'POST', endpoint: 'orders', items });
    } catch (err: any) {
      console.error(`Omnisend syncOrders batch error: ${err.message}`);
    }

    page += 1;
  } while (true);
}
