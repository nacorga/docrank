# Checkout

What `src/checkout.mjs` does. This document binds: where the code and it
disagree, the code is wrong.

## Purchase

`checkout(cart, user)` returns the order: the user's `id` and the total, in
cents, of each item's `price` times its `qty`. An empty cart totals `0`.

## Analytics

The checkout may report an event to an analytics callback. It is then called
as `checkout(cart, user, { consent, track })`: the caller passes `consent`,
what the user agreed to, and `track(name, data)`, the callback. The one event
is named `"checkout"` and its data is `{ user, total }`, the order's two
fields. Two rules hold for every event:

- No event is sent before `consent.analytics === true`.
- No event carries the user's email.
