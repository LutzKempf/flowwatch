# Self-serve checkout that customers finish

Let a customer go from cart to paid order without calling support. Progress is measured in completed
orders, not merged pull requests.

## Focus
Guest checkout — get a first-time buyer through payment without an account.

## Milestones
In dependency order. The id in backticks is what sessions are tagged with: never rename one.

- `guest-checkout-live` Guest checkout in production — specs: checkout-flow; workstreams: guest-checkout
- `saved-cards-live` Saved cards for returning customers — specs: payment-methods, checkout-flow; workstreams: saved-cards
- `order-emails` Order confirmation emails — specs: order-emails

## Categories
The lanes the sessions are sorted into, and the specs each one owns.

- Checkout — specs: checkout-flow, cart-*
- Payments — specs: payment-*
- Reporting — specs: cart-analytics, sales-report
- Notifications — specs: order-emails
- Retro, Architecture
