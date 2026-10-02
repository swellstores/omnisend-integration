# Omnisend

Sync customers, products, carts and orders with Omnisend for email and SMS marketing automation.

## How it works

1. **Syncs store changes in real time.** When the integration is enabled, store events are sent to Omnisend:

   | Store event                                                                         | Omnisend                    |
   | ----------------------------------------------------------------------------------- | --------------------------- |
   | `account.created`, `account.updated`                                                | Contact created / updated   |
   | `cart.created`, `cart.updated`, `cart.deleted`                                      | Cart created / updated / deleted |
   | `order.submitted`, `order.updated`                                                  | Order created / updated     |
   | `product.created`, `product.updated`, `product.variant.updated`, `product.deleted`  | Product created / updated / deleted |

2. **Sends complete records.**
   - **Contacts** – name, address and phone. Email status is subscribed when the customer opted in to email marketing, otherwise not subscribed.
   - **Carts** – items, total and checkout recovery link. Only carts linked to a customer account are sent.
   - **Orders** – items, totals, addresses, shipping, payment and fulfillment status, and cancel date.
   - **Products** – description, tags, stock status, image and variants with sale and option prices.

   Amounts are sent in cents, and product links are built from your store URL. Orders and carts can optionally be sent in the customer's display language.

3. **Imports existing data.** The initial sync sends all existing contacts, products and orders to Omnisend in batches, so Omnisend knows about records created before the app was installed.

## Setup

Enter your Omnisend API key and store URL in the app settings and turn on Enable Integration. Run the initial sync once (`POST /functions/omnisend/sync`). Disable the native Omnisend integration to avoid sending events twice.
