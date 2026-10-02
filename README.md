# Omnisend integration

A Swell app that syncs customers, products, carts and orders to [Omnisend](https://www.omnisend.com/) for email and SMS marketing automation.
It replicates the native Swell Omnisend integration, so you can use it as is or adapt it to your needs.

## Features

All data is sent to the [Omnisend API v3](https://api-docs.omnisend.com/) (`https://api.omnisend.com/v3`). Amounts are sent in cents.

### Real-time sync

| Swell event                        | Omnisend action                                     | Function                      |
| ---------------------------------- | --------------------------------------------------- | ----------------------------- |
| `account.created`                  | Create contact                                      | `functions/account-events.ts` |
| `account.updated`                  | Update contact                                      | `functions/account-events.ts` |
| `cart.created`                     | Create cart                                         | `functions/cart-events.ts`    |
| `cart.updated`                     | Update cart (or create it if missing in Omnisend)   | `functions/cart-events.ts`    |
| `cart.deleted`                     | Delete cart                                         | `functions/cart-events.ts`    |
| `order.submitted`                  | Create order                                        | `functions/order-events.ts`   |
| `order.updated`                    | Replace order                                       | `functions/order-events.ts`   |
| `product.created`                  | Create product                                      | `functions/product-events.ts` |
| `product.updated`                  | Replace product                                     | `functions/product-events.ts` |
| `product.variant.updated`          | Replace the parent product                          | `functions/product-events.ts` |
| `product.deleted`                  | Delete product                                      | `functions/product-events.ts` |

Events are processed only when **Enable Integration** is on and an API key is set.

**Contacts** – name, shipping address, city, state, country and postal code, plus custom properties
`company`, `shipping_phone`, `account_phone` and `email`. The email channel status follows the account's marketing
opt-in: `subscribed` when `email_optin` is true, otherwise `nonSubscribed` (dated with the account creation date). After a contact is created, the app stores its email on the account
in `omnisend_email` and uses it to find the contact on later updates.

**Carts** – cart total, currency, checkout ID, recovery URL (`checkout_url`), language and items
(title, product/variant ID, quantity, price, product URL, image). Only carts linked to a customer account are sent,
because Omnisend requires an email.

**Orders** – order number (digits only), totals (order, subtotal, discount, tax, shipping), currency, language,
shipping method and carrier, shipping and billing addresses, items, and statuses:

| Payment status      | When                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `partiallyPaid`     | Partly paid with a balance due                                       |
| `partiallyRefunded` | Refund total is above 0 and below the payment total                  |
| `refunded`          | Refund total equals the payment total                                |
| `paid`              | Paid with no balance                                                 |
| `awaitingPayment`   | Unpaid order with a total above 0                                    |

Fulfillment status is `fulfilled` when the order is delivered with no returned items, `unfulfilled` while items are
deliverable. For canceled orders `canceledDate` is the Swell cancel date, the date already stored in Omnisend, or the
current time.

**Products** – name, description, tags, stock status (`inStock`, `outOfStock`, `notAvailable`), first image
(or an Omnisend placeholder), product URL and variants. Variant prices include sale prices and option prices.
Products without variants are sent with a single variant.

Product and item URLs are built as `<Store URL>/<sku or slug>`.

### Full initial sync

`POST /functions/omnisend/sync` (`functions/sync.ts`) sends all existing contacts, then products, then orders using
Omnisend batches, waiting for each batch type to finish before starting the next. Run it once after installing,
otherwise Omnisend rejects events for records it does not know yet.

### API key validation

`POST /functions/omnisend/validate-login` with `{ "api_key": "..." }` (`functions/validate-login.ts`) returns
`{ "success": true | false }`. It checks the key by creating a test contact `validate@test.com` in Omnisend.

### Display locale

When **Use Display Locale** is on, orders and carts with a `display_locale` different from the store default are
fetched in that locale before they are sent, so product names and other localized fields match the customer's language.

## Settings

Configured in the app settings (`settings/omnisend.json`). Credentials are never stored in code.

| Setting              | Type   | Required | Default | Description                                                                 |
| -------------------- | ------ | -------- | ------- | --------------------------------------------------------------------------- |
| `api_key`            | text   | yes      |         | Omnisend API key (Omnisend → Profile → Integrations & API → API Keys).      |
| `store_url`          | text   | yes      |         | Storefront URL starting with `https://`, used for product and item links.  |
| `enabled`            | toggle | no       | off     | Turns real-time sync on. The sync route also requires it.                   |
| `use_display_locale` | toggle | no       | off     | Fetch orders and carts in their display locale before sending.             |

## Setup

1. Install the Swell CLI and log in:

   ```bash
   npm install -g @swell/cli
   swell login
   ```

2. Install dependencies and push the app to your store's test environment:

   ```bash
   cd /path/to/omnisend-integration
   npm install
   swell app push
   ```

3. In the Swell dashboard open **Apps → Omnisend → Settings**, enter the API key and store URL, and turn on
   **Enable Integration**.
4. **Disable the native Omnisend integration** in Swell, otherwise every event is sent twice.
5. Sync existing data to Omnisend:

   ```bash
   swell api post /functions/omnisend/sync          # test environment
   swell api post /functions/omnisend/sync --live   # live environment
   ```

6. To install in the live environment, create a version and install it:

   ```bash
   swell app version minor
   swell app install
   ```

## Limits and known behavior

- **Duplicate events** if the native Swell Omnisend integration is enabled at the same time.
- **Initial sync runs in one request** – it pages through all accounts (100 per page), products and orders
  (1000 per page) and polls Omnisend every 2 seconds until batches finish. It is subject to the function timeout,
  so it can stop before finishing on large stores.
- **Email consent is set once** – the opt-in is sent when the contact is created (or synced). Later opt-in changes
  on the account are not sent to Omnisend, because contact updates do not include the email channel status.
- **Contact updates** need `omnisend_email` on the account. Accounts created before the app was installed are updated
  only after the initial sync.
- **Guest carts** are not sent.
- **No retries** – failed Omnisend calls are logged (`console.error`) and dropped.
- **validate-login** leaves a `validate@test.com` contact in the Omnisend account.

## Development

### Project layout

```
functions/
  account-events.ts   # account.created / account.updated → contacts
  cart-events.ts      # cart.created / updated / deleted → carts
  order-events.ts     # order.submitted / updated → orders
  product-events.ts   # product.created / updated / deleted, product.variant.updated → products
  sync.ts             # POST route: full initial sync
  validate-login.ts   # POST route: API key check
  lib/                # Omnisend client, payload builders, localization, batch polling
settings/omnisend.json
assets/icon.png       # app icon (Omnisend mark)
assets/screenshots/   # listing screenshots (referenced by `images` in swell.json)
test/unit/            # vitest unit tests (Omnisend API mocked)
test/integration/     # vitest tests against the store using CLI auth
```

### Commands

```bash
npm run typecheck   # TypeScript check for functions and tests
npm test            # run all vitest tests
swell app dev       # run functions locally, triggered by the test environment
swell app push      # deploy to the test environment
swell logs -f --app omnisend      # follow function logs
swell inspect functions --app=.   # check deployed functions and failures
```

Tests run in the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers` and use your `swell login` session
(or `SWELL_STORE_ID` / `SWELL_SESSION_ID` in CI). Unit tests mock `fetch`, so no real Omnisend calls are made.

Logs are also available in the dashboard under **Developer → Console → Logs**.

## Contributing

Contributions are welcome! Visit the [Swell Discord](https://discord.gg/VakSbyjDGZ) or [GitHub discussions](https://github.com/orgs/swellstores/discussions/) to get help and share ideas.

## License

This project is licensed under the MIT License - see [LICENSE.md](LICENSE.md) file for details.
