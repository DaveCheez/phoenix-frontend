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
- `NUXT_CART_APP_CREDENTIAL`: exactly 64 lowercase hexadecimal characters.
  Generate it separately from the guest, CSRF, contact and Django secrets.
  Missing, uppercase, malformed and repeated-character values are rejected
  before any Django call. The process does not invent a replacement.
- `NUXT_CART_TRUSTED_INGRESS`: records an explicit trusted-ingress assumption.
  The committed default is empty. Empty and unsupported values fail closed
  outside Nuxt development. `digitalocean` is the only accepted value, and it
  is not enabled in the deployment configuration. Correct use requires
  verification that accepted ingress paths supply or overwrite
  `do-connecting-ip`. Parser tests do not prove provider header provenance.
  Trust is not inferred from `NODE_ENV`, a hostname suffix, or the presence of
  a well-formed header.

Do not reuse the contact-proxy secret or a Django secret. Do not infer the
origin from `Host`, `X-Forwarded-Host`, `www`, a sibling subdomain or a preview
host. Confirm the canonical production hostname before deployment.

## Application credential and shopper address

Nuxt constructs these headers on the cart Django call. Browser copies are not
forwarded.

- `X-Phoenix-App-Credential`: the private application credential.
- `X-Phoenix-Shopper-Address`: the address selected by the server.
- `Authorization`: the existing guest bearer, only when that cookie is present.

In Nuxt development, `import.meta.dev` selects the fixed address `127.0.0.1`.
Browser address headers, forwarding headers and socket addresses are ignored.
The application credential and the existing guest and CSRF checks still apply.

Outside development, the address is exactly one `do-connecting-ip` value, and
only when `NUXT_CART_TRUSTED_INGRESS` is `digitalocean`. Duplicates, joined
values, whitespace, malformed IP addresses, brackets, ports, CIDR prefixes and
IPv6 zone identifiers are rejected. There is no fallback to a socket,
`X-Forwarded-For`, or the development address.

Credential-bearing upstream calls use HTTPS. HTTP remains available only for
an explicit `localhost` or `127.0.0.1` base URL. Redirects are not followed
and are not retried. The application credential and shopper address are not
returned to the browser or written to cart logs.

Django `503 CART_APPLICATION_REJECTED` becomes the existing safe
`503 CART_SERVICE_UNAVAILABLE` response. It does not become
`CART_ACCESS_UNAVAILABLE`, clear the guest cookie, or start a replacement.
`401 CART_ACCESS_UNAVAILABLE` remains only the exact guest-access response
from the authenticated Django path. A genuine `429 CART_RATE_LIMITED` stays 429. Nuxt forwards `Retry-After` only
when that response carries one delay-seconds value from 1 to 86400. The upper
bound is the current supported counter window. It is not a new quota. Missing,
joined, signed, fractional, date, or out-of-range values are omitted, and the
429 denial remains. The value is read from the upstream response header. It is
not taken from the browser or from a JSON field. Nuxt does not enable a
counter, and this frontend does not add a countdown or an automatic retry.

## Shared CSRF and reset budget

`GET /api/cart/csrf` and `POST /api/cart/reset` each make one application-only
`POST cart/budget/` before they issue a token or change a cookie. The browser
cannot choose the operation. CSRF sends `{"operation":"csrf"}`. Reset sends
`{"operation":"reset"}`. There is no browser route at `/api/cart/budget`.

The budget request uses the existing private application credential and the
server-selected shopper address. It sends `Accept` and `Content-Type` of
`application/json`. It does not send `Authorization`, `Cookie`, a guest token,
a CSRF token, a cart id, or a limit. Nuxt calls the endpoint whether or not
backend enforcement is enabled. There is no frontend bypass, permission cache,
or success fallback.

Continuation requires HTTP 200 and an object whose fields are exactly
`success: true` and `code: "CART_BUDGET_ALLOWED"`. A cart payload is not an
allowance. Any other 2xx, redirect, timeout, network error, malformed body, or
unexpected status, including a budget-endpoint 401, is a safe service failure.
That 401 does not mean the guest session can be reset. A later guest-cart
probe can still return the exact `401 CART_ACCESS_UNAVAILABLE`, and that probe
keeps its existing recovery meaning.

CSRF order:

1. Trusted host and the existing Fetch Metadata or Origin-Referer checks.
2. Private application configuration and shopper-address selection.
3. One csrf budget call.
4. Bootstrap-cookie creation or reuse, then CSRF issuance, only after allowance.

The budget call cannot require the token it is about to issue. A denial writes
no cookie and does not probe or start a guest cart.

Reset keeps its origin, JSON, explicit-confirm and session-bound CSRF checks,
then makes one reset budget call. Only an allowance continues. A valid cart is
preserved. A valid session with a missing cart is preserved and can be
replaced later. A definitive guest `401 CART_ACCESS_UNAVAILABLE` is the
existing explicit local reset. A malformed local cookie is the existing
explicit reset. Those local cookie removals also wait for budget allowance,
including when no guest probe would run. A denied or unavailable budget stops
before the probe and does not create a session or cart.

A genuine `429 CART_RATE_LIMITED` from the budget call, from an ordinary cart
read or mutation, or from the later reset guest probe keeps the guest cookie
and can include the validated `Retry-After` header. `503` budget failures also
keep the cookie. Neither failure replays start, add, update, remove, clear,
reset or replacement.

The budget decision is used for that request only. It is not cached, prefetched
or shared across tabs. A failed CSRF preparation clears the in-memory token and
stops the basket change before it is sent. That is a preparation failure, not
an unconfirmed write.

Each CSRF request adds one Django `POST cart/budget/`. Each reset adds one
reset budget POST, plus the existing guest probe when a present valid cookie
still needs one. Ordinary cart reads and mutations do not add a second budget
precheck. Their Django routes already account for those requests.

This adds a Django availability and latency dependency to CSRF and reset. If
the budget POST fails, Nuxt does not issue a token or change cookies, even
when the guest session would otherwise have been usable. The counts below are
derived from this source. They are not measured production performance.

| Shopper action | Browser | Django |
| --- | --- | --- |
| Read without a guest cookie | 1 `GET /api/cart` | none |
| Refresh with a guest cookie | 1 `GET /api/cart` | 1 `GET cart/` |
| Start | 1 CSRF GET + 1 create POST | 1 csrf budget POST + 1 `POST cart/create/` |
| Add | 1 CSRF GET + 1 add POST | 1 csrf budget POST + 1 `POST cart/add/` |
| Plus or minus | 1 CSRF GET + 1 cart GET + 1 update POST | 1 csrf budget POST + 1 `GET cart/` + 1 `PATCH cart/update/` |
| Reset with a valid guest cookie | 1 CSRF GET + 1 reset POST | 1 csrf budget POST + 1 reset budget POST + 1 guest `GET cart/` |
| Reset with no cookie, or a malformed cookie | 1 CSRF GET + 1 reset POST | 1 csrf budget POST + 1 reset budget POST, and no guest probe |

The cart page also reads from the navbar, so opening `/cart` can be two browser
reads. Those reads do not add budget calls.

Production still needs the private application credential, an approved origin,
and a verified `do-connecting-ip` ingress before `digitalocean` is enabled.
This change does not enable checkout, production rate limits, or counter
enforcement. Backend enforcement remains a separate configuration. The local
test command uses stubs and does not call the public site.

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
- `POST /api/cart/reset` with `{"confirm":true}` is a local browser reset after
  its reset budget allowance. It does not delete a Django cart. A still-valid
  session is reloaded. A missing cart keeps the credential so the shopper can
  open an empty basket. Only a definitive unavailable credential, or a
  malformed local cookie, is forgotten, and both of those local removals wait
  for the same allowance. Network failures, rate limits and server errors keep
  the cookie.

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

## Application authentication verification

Recorded on 7 October 2026 with Microsoft Edge 154.0.4258.62, headless, against local Nuxt development at `http://localhost:3000` and Django at `http://127.0.0.1:8000`. Frontend HEAD was `774bee8b033011dbe7b1c52f7a8adfe93d075b62` and backend HEAD was `12c204beb9ccec3a3626901c7e92c894af258fa3`. Both application-authentication patches were uncommitted. The local catalogue response was product 2, base £100.00, Enhanced option 5 at £25.00, and default None option 6 at £0.00.

The normal Nuxt process kept `NUXT_CART_TRUSTED_INGRESS` empty. A separate Nuxt development process, on its own localhost port, used a different syntactically valid application credential and `NUXT_IGNORE_LOCK=1`. That process was stopped afterwards. No credential, cookie, CSRF token, or application header was recorded. `NUXT_CART_TRUSTED_INGRESS` was not set to `digitalocean`. This run does not prove live DigitalOcean header provenance.

| Check | Result | What was observed |
| --- | --- | --- |
| Visit without start | PASS | No create request. The read-only SQLite session and cart counts stayed the same. |
| Start, Enhanced plus None, add | PASS | Create was 201. Add was 201. Django returned configured unit £125.00, line £125.00, total £125.00, options 5 and 6. |
| Reload | PASS | The same basket returned total £125.00 with Enhanced and None. |
| Increase | PASS | One update returned quantity 2, configured unit £125.00, line £250.00, and total £250.00. |
| Direct Django rejection | PASS | Missing credential, forged forwarding and shopper headers, and a valid guest bearer alone were 503 `CART_APPLICATION_REJECTED`. A valid application credential with a missing or malformed shopper address was 503 `CART_APPLICATION_REJECTED`. A valid application credential and address with a missing or invalid guest bearer was 401 `CART_ACCESS_UNAVAILABLE`. The read-only SQLite row for that basket was unchanged. |
| Mismatched application credential | PASS | The cart page made two GET requests, both 503 `CART_SERVICE_UNAVAILABLE`, showed the uncertainty message and Refresh basket, and did not show guest recovery. No mutation was sent from that failed read. A separate ready page forwarded its cart reads to the matching server and sent one update to the mismatched server; that update was 503 `CART_SERVICE_UNAVAILABLE` and was not repeated. A real CSRF reset was one POST, 503 `CART_TEMPORARILY_UNAVAILABLE`, and the guest cookie compared equal. SQLite was unchanged. |
| Restored matching access | PASS | Refresh through the normal UI reopened the same basket at £250.00. There was no new start or reset. The guest cookie compared equal. |

## Enabled budget verification

Recorded on 8 October 2026. Frontend `f703a1b6d5c587069baf5a6859069d5d7372bf74` and backend `5046f1102f5b3b74bfa97c6359dc604e9ad12209` were committed and their working trees were clean before this run. Node was v22.14.0. Microsoft Edge was 154.0.4258.62, headless, in fresh temporary profiles. PostgreSQL was the official `postgres:16` image, server version 16.15, published only on `127.0.0.1`. The disposable database was `phoenix_vanz_budget`. Django used `base.settings_postgres_tests` with local cache, email and media storage. Cart migration `0006_frontend_budget_scopes` was applied there. The normal Nuxt process on port 3000 and Django process on port 8000 were left running. No normal `.env` or `db.sqlite3` was changed.

The policies below are TEST ONLY. They are not production quotas.

| Scope | Window | Limit |
| --- | --- | --- |
| csrf | 60 seconds | 8 |
| reset | 3600 seconds | 1 |
| issuance | 3600 seconds | 30 |
| failed_access | 3600 seconds | 30 |
| authenticated_cart | 3600 seconds | 8 |

The disposable catalogue had one product, base £100.00, with Enhanced at £25.00 and None at £0.00. A required Standard option at £0.00 was also present so Enhanced could be selected. Nothing was copied from the normal database.

| Check | Result | What was observed |
| --- | --- | --- |
| Unmodified test-entry startup | PASS | `npm run test:cart-access` passed 52 tests. The built-server tests launch `node .output/server/index.mjs` directly. |
| Enabled CSRF denial | PASS | One browser CSRF request and seven direct Nuxt CSRF requests returned 200. The next Start a new basket sent GET `/api/cart/csrf` 429 `CART_RATE_LIMITED`, browser Retry-After `35`, no CSRF token and no Set-Cookie. No start, add, update or reset followed. The csrf counter for that window ended at 9. No cart or session was created. |
| Enabled reset denial | PASS | A direct reset without CSRF was 403 `CART_REQUEST_REJECTED` and created no reset counter. One labeled Django budget request then returned 200 `CART_BUDGET_ALLOWED`. The browser reset, after its own CSRF request returned 200, was POST `/api/cart/reset` 429 `CART_RATE_LIMITED` with Retry-After `1315`. Django recorded a budget 200 and then a budget 429, and no following guest-cart GET. |
| Enabled authenticated-cart denial | PASS | A confirmed line was quantity 1, Enhanced £25.00 and None £0.00. Seven labeled Django reads for that guest returned 200. The next Add sent CSRF 200 and then POST `/api/cart/add` 429 `CART_RATE_LIMITED`, Retry-After `1300`. Django recorded the add itself as 429. The stored line stayed quantity 1 with those options. |
| Retry-After forwarding | PASS | The browser-visible values were `35`, `1315` and `1300`. Each was a single positive decimal integer within 1..86400. |
| Cookie and cart preservation | PASS | Denied responses had no Set-Cookie. The bootstrap cookie, guest cookie, quantity, selections and basket snapshot compared equal across each denial. |
| Real-window recovery | PASS | The csrf window end read from the counter was `2026-10-08T21:38:00+00:00`. `expires_at` was five minutes later and was not used. The browser sent no cart request while waiting. The next explicit Start received CSRF 200 and create 201. That new window's csrf count was 1, while the denied window stayed at 9. |

The product Start control did not display "The basket change was not sent. Try again." after the CSRF denial. The click still sent no mutation. The denied Add and the denied reset did show "We could not confirm the latest basket update. Check your basket before trying the change again." There was no success toast and no automatic repeat. This run does not approve production rate limits.

## Product Start feedback

The product page passed `recoverBasket` straight to the notice action. The notice emits that action and does not wait for the promise. CSRF preparation failure throws before a create request, and it does not change the basket access state, so the notice kept its start prompt and the rejection was uncaught.

The product page now awaits that existing operation in its own callback. A preparation failure, including CSRF 429 or 503 before create is dispatched, shows "The basket change was not sent. Try again." in the same notice. The message stays until the next explicit attempt or a confirmed start. A start that was dispatched and then returned an uncertain response still uses the existing uncertainty state and does not claim the request was never sent. Success does not add the product by itself.

Recorded on 8 October 2026 from `3d2810b19961d1ee594b3b5cd3beb98498797815`, still on `feature/guest-cart-access`. `npm run test:cart-access` passed 56 tests. `npm run build` completed after a controlled stop of the normal development server, which was then restored. The same isolated PostgreSQL harness reached a real CSRF denial on the product Start control. The page showed the preparation message, sent no create, add, update or reset, kept Enhanced selected, left Start enabled, and recorded no click rejection. After the recorded csrf window ended at `2026-10-08T22:05:00+00:00`, one explicit Start received CSRF 200 and create 201, cleared the preparation message, and did not add the product. The harness stopped its Django, Nuxt and Edge process trees, confirmed their ports were free, removed the disposable database and workspace, and exited 0. The normal servers on ports 3000 and 8000 stayed up.
