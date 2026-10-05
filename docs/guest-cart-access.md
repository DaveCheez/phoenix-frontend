# Guest cart access

This frontend keeps the Django guest credential in an HttpOnly cookie. Browser
JavaScript never receives it, and a cart UUID is not an access credential.

## Runtime configuration

These values are private. They are not part of `runtimeConfig.public`.

- `NUXT_CART_CSRF_SECRET`: 64 hexadecimal characters (32 random bytes). Empty,
  malformed and repeated-character values are rejected. The process does not
  invent a replacement secret.
- `NUXT_CART_ORIGIN`: one explicit origin for this deployment, such as
  `http://localhost:3000` in Nuxt development. Production must be HTTPS.

Do not reuse the contact-proxy secret or a Django secret. Do not infer the
origin from `Host`, `X-Forwarded-Host`, `www`, a sibling subdomain or a preview
host. Confirm the canonical production hostname before deployment.

## Cookies and CSRF

Production guest cookie: `__Host-phoenix_guest`. Nuxt development uses
`phoenix_guest_dev` and does not accept that name in production. A separate
short-lived bootstrap cookie authorises the first `start` only.

`GET /api/cart/csrf` returns a CSRF token bound to the current guest cookie, or
to the bootstrap cookie when no guest cookie is present. The token is kept in
memory. Ordinary cart reads and mutations do not rewrite the guest cookie.

## Browser routes

- `GET /api/cart` reads an existing session. It does not start or replace one.
- `POST /api/cart/create` accepts `{"action":"start"}` or
  `{"action":"replace_missing"}`.
- `POST /api/cart/add`, `POST /api/cart/update`, `POST /api/cart/remove` and
  `DELETE /api/cart/clear` forward allowlisted fields only.
- `POST /api/cart/reset` with `{"confirm":true}` is a local browser reset. It
  does not delete a Django cart. A still-valid session is reloaded. A missing
  cart keeps the credential so the shopper can open an empty basket. Only a
  definitive unavailable credential, or a malformed local cookie, is forgotten.
  Network failures, rate limits and server errors keep the cookie.

A refresh shows the basket returned by that read. It does not prove that a
timed-out request was cancelled, and it does not repeat the failed change.
This frontend does not add server-side mutation idempotency or exactly-once
execution.

While a change is unconfirmed, the last validated rows can stay on screen with
the label "Last confirmed basket — the latest change is not confirmed."
Another write is blocked until Refresh basket returns a valid current cart.

Plus and minus send a relative intent. After `phoenix-guest-cart` is acquired,
the client reads the latest cart, finds the line by item id, and posts
`latest quantity + delta`. That coordinates cooperating tabs that use the same
lock. It does not replace server-side concurrency control for other clients.

Clear sends `DELETE /api/cart/clear` with a JSON object body `{}`,
`Content-Type: application/json`, the in-memory CSRF header, and `retry: 0`.
It does not send a cart id or a price. A timeout does not send a second clear.

## Response cache policy

Every response whose pathname is `/api/cart` or starts with `/api/cart/` is
`Cache-Control: private, no-store, no-cache, must-revalidate`. The match uses
the pathname, so a query string does not change it, and `/api/cartoon` is not
included.

The policy is applied again at the response boundary. Nitro's built-in error
handler writes `Cache-Control: no-cache` and finishes framework 404 responses
before `beforeResponse`, so cart paths send that same framework body from a
small error handler that sets the final headers. Handled cart responses also
pass through a `beforeResponse` hook. Neither step reads the cart secret or
origin. `Vary: Cookie` is added without removing other Vary tokens. An existing
`Vary: *` is left unchanged.

## Cross-tab behaviour

Cooperating tabs on the same origin share one Web Lock named
`phoenix-guest-cart` for session checks, CSRF preparation, start, reset,
replacement and basket changes. Web Locks do not authenticate the shopper and
do not stop a separate client from creating its own session. If the browser has
no Web Locks support, reads still work and basket changes are blocked.

## Release prerequisites

Do not deploy this cutover until all of the following are true:

- This patch has had a source review.
- A real browser has been exercised against the local protected Django cart API.
- The backend issuance-reliability follow-up already identified in the Django
  review has been accepted.
- Abuse controls cover direct Django calls and Nuxt calls.
- The supported Nuxt, Nitro and Node versions for this repository are unchanged.
- Production cutover includes an approved explicit basket reset. There is no
  rollback that silently restores UUID-only cart access.

`npm run test:cart-access` uses a local stub. It does not call Django or the
live website.

## Browser verification record

Recorded on 4 October 2026 with Microsoft Edge 154.0.4258.53, headless, in
fresh temporary profiles. This used Edge's real Web Locks implementation.
Playwright was not installed. The checks spoke only to `http://localhost:3000`.
Django at `127.0.0.1:8000` answered the local catalogue. No cookie values,
CSRF tokens, or guest credentials were recorded.

The local product was "Guest cart integration test", base price £100.00, with
required Specification options Standard (£0.00) and Enhanced (£25.00).

| Check | Result | What was observed |
| --- | --- | --- |
| Successful guest basket | PASS | The first cart read was GET 401. No create ran before Start. Start was POST `/api/cart/create` 201. Enhanced was added with POST `/api/cart/add` 201. After reload the cart showed Enhanced, base £100.00, option £25.00, and configured/line total £125.00. The guest cookie was HttpOnly and absent from `document.cookie`. The cart JSON had no `guest_access`. |
| Two tabs starting together | PASS | One browser context, two pages. Create responses were 201 and 200. One response was a new issuance. Both pages ended on the same empty basket. Neither hung. |
| Quantity across tabs | PASS | Both pages started at quantity 1. The update bodies were quantity 2, then 3. After both pages were reloaded, both showed quantity 3, unit £125.00, and line total £375.00. |
| Response lost after a successful write | PASS | One update was forwarded once to Nuxt, returned Django-backed 200 with quantity 2 and total £250.00, and was not delivered to the page. The page showed the uncertainty message and the last-confirmed label, with no success toast and no second update. Refresh was one GET and then showed quantity 2. This was post-commit response loss, not a timed-out wait. A separate aborted Add kept the Standard radio selected. |
| Injected 429 | PASS | One add was answered locally with HTTP 429 and was not forwarded. The uncertainty message appeared, Enhanced stayed selected, and there was no success toast or create. Refresh was a GET only. This does not show that production rate limiting exists. |
| Web Locks unavailable | PASS | A basket was created with locks available. The next page load had `navigator.locks` removed. The cart still rendered. Increase did not send a write. The locks message and Contact link were shown. |
| Server-expired guest session | PASS | The cart ID came from that context's start response. Enhanced (option 5) and None (option 6) were added, and Django returned one line at £125.00. Only that session's `expires_at` was set shortly before backend time. The browser cookie and its future expiry stayed in place. The cart read reached Django and returned 401 `CART_ACCESS_UNAVAILABLE`. The recovery notice appeared, and no create, reset or add ran before Start a new basket. That control reset the browser session and started a different empty basket. The old cart and its line remained, the old session stayed expired, and a reload opened the new empty basket. |
| Revoked guest session | PASS | Browser access after a targeted local database revocation fixture. The same browser flow as expiry applied: 401 `CART_ACCESS_UNAVAILABLE`, no recovery until Start a new basket, the old cart and line kept, and the old session left revoked. This does not exercise a public revocation endpoint. |
| Missing cart, valid session | PASS | Only that run's cart was deleted. The guest session and browser cookie stayed in place (`unchanged=true`). Refresh returned 409 `GUEST_CART_MISSING` and the missing-basket notice. No start, reset or replacement ran until Open an empty basket. That control sent `replace_missing` and received 201. One new empty cart is on the original session, with the same expiry and revocation state and no new guest session. Reload stayed empty. A separate Add then stored Enhanced and None at £125.00. |

The lifecycle checks were recorded on 5 October 2026 with Microsoft Edge 154.0.4258.53 against `http://localhost:3000`, and Django at `127.0.0.1:8000`. Frontend `a7b1b263e1d6f04263c8ec7b7e1249668b18a4d2` and backend `cb3e04f5dbaaf3277e05448a130fa3cdbd19d5fc` were the commits under test. The catalogue response confirmed base £100.00, Enhanced option 5 at £25.00, and default None option 6 at £0.00 before those IDs were used. No 401 or 409 response was injected. The browser cookie was not deleted as a substitute for the database change. This development run still does not verify the production HTTPS `__Host-phoenix_guest` cookie. The injected 429 check and the post-commit response-loss check above are unchanged and are not these lifecycle results.
