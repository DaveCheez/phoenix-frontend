# Cross-repository merge and release plan

Reviewed 9 October 2026 from the commits named below. GitHub has since
merged both candidates. That merge is not a deployment. Do not deploy or
change platform settings from this document.

`todos.txt` is the status source. Test transcripts stay in
`docs/guest-cart-access.md` and in the backend documents named below.

## Repositories

| Role | Local checkout | Remote name | Branch inspected | HEAD | Tracking |
| --- | --- | --- | --- | --- | --- |
| Frontend release checkout | `phoenix-vanz-frontend-digitalocean-ready/phoenix-frontend` | `origin` (`DaveCheez/phoenix-frontend`) | `feature/guest-cart-access` | `208572716fc17fc7bcd343193c89b772ad279368` | `origin/feature/guest-cart-access`, level |
| Backend primary checkout | `phoenix-vanz-backend-digitalocean-ready/backend` | `origin` (`DaveCheez/phoenix`) | `feature/order-foundation` | `7bc85397c2f0287226cf1fb790b6270ab8951c34` | `origin/feature/order-foundation`, level |
| Backend Django 5.2 worktree | `phoenix-vanz-backend-digitalocean-ready/backend-django-5-2` | same backend `origin` | `upgrade/django-5-2` | `bb92c95c127a6dc5dfe1271b0686b73cc3c493b6` | `origin/upgrade/django-5-2`, level |

Working trees for those three checkouts were clean at review. `origin` was
fetched with prune. No pull, switch, reset, rebase or merge was done.

A second frontend directory, `Dev/Phoenix Vanz/phoenix-frontend`, is a
separate checkout on local `main` `8c064fd` with a dirty tree and a deleted
upstream. It is not a worktree of the release checkout and is not a candidate.
`phoenix-vanz-nuxt-django52` was not established as a git worktree.

## Branch map

```text
frontend origin/HEAD -> origin/master
  master 2d5161989aa1f5426e391a1b9175b30be791d013
    ancestor of feature/guest-cart-access
    0 commits on master that are absent from the feature branch
    7 commits on the feature branch that are absent from master

backend origin/HEAD -> origin/main
  main 9c708a0809c1ebef15cec109a0f39c409f35aa4d
    ancestor of feature/order-foundation (12 commits ahead)
    ancestor of upgrade/django-5-2 (13 commits ahead)
  feature/order-foundation 7bc85397c2f0287226cf1fb790b6270ab8951c34
    ancestor of upgrade/django-5-2 (1 commit ahead)
```

Fast-forward is possible:

- frontend `master` can fast-forward to `208572716fc17fc7bcd343193c89b772ad279368`;
- backend `feature/order-foundation` can fast-forward to `bb92c95c127a6dc5dfe1271b0686b73cc3c493b6`;
- backend `main` can fast-forward to that same upgrade commit.

Proposed path, not executed:

1. Fast-forward `feature/order-foundation` to `upgrade/django-5-2`.
2. Fast-forward backend `main` to that result.
3. Fast-forward frontend `master` to `feature/guest-cart-access`.

The seven frontend commits and the thirteen backend commits are already
successive checkpoints on those branches. They do not need to be cherry-picked
again. Contact is not one of those checkpoints.

Frontend commits on the feature branch after `master`:

- `a7b1b263e1d6f04263c8ec7b7e1249668b18a4d2` Add protected guest cart access and recovery
- `774bee8b033011dbe7b1c52f7a8adfe93d075b62` Verify guest cart browser lifecycle recovery
- `dbe579b2670293167e59e80e37b927af359f9de0` Send authenticated cart proxy requests from Nuxt
- `f703a1b6d5c587069baf5a6859069d5d7372bf74` Connect Nuxt cart budgets and forward Retry-After
- `3d2810b19961d1ee594b3b5cd3beb98498797815` Verify enabled cart budgets through Nuxt
- `f66b42d752e640af476f370436b7c7b819770824` Show product basket-start preparation errors
- `208572716fc17fc7bcd343193c89b772ad279368` Show cart basket-start preparation errors

Backend commits on the upgrade branch after `main` are the twelve foundation
commits listed by `git log --oneline main..feature/order-foundation`, plus
`bb92c95c127a6dc5dfe1271b0686b73cc3c493b6` Upgrade backend to Django 5.2.18.

## Contact branches

| Checkout | Branch | HEAD | Included in the candidate? | Fast-forward? |
| --- | --- | --- | --- | --- |
| Frontend | `feature/contact-enquiries` | `63df13a` (29 September 2026, "contact form") | No. Branched from `f6ae1ab`, which is behind `master`. One unique commit; the feature branch has fourteen commits it lacks. | No |
| Backend | `feature/contact-enquiries` | `96e9eaf` (29 September 2026, "Add secure contact enquiry API") | No. Branched from `27b469d`, which is behind `main`. One unique commit; foundation has eighteen commits it lacks. | No |

Both remote-tracking branches still exist and match those local HEADs.

Frontend files in that unique commit: `.env.example`, `nuxt.config.ts`,
`pages/contact.vue`, `server/api/contact.post.ts`, `server/utils/clientIp.ts`.
The new name in `.env.example` is `NUXT_CONTACT_PROXY_SECRET`.

Backend files include enquiry model, admin, serializer, email helper,
throttles, tests, and `store/migrations/0026_enquiry.py`. Configuration names
on that branch include `CONTACT_RECIPIENT_EMAIL`, `CONTACT_PROXY_SECRET`,
`DEFAULT_FROM_EMAIL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`,
`EMAIL_USE_SSL`, `EMAIL_HOST_USER` and `EMAIL_HOST_PASSWORD`. The older
requirement mentioned a name such as `CONTACT_TO_EMAIL`. The branch's actual
recipient name is `CONTACT_RECIPIENT_EMAIL`.

Status: locally integrated on both `release/secure-storefront` branches.
Local integration and testing may proceed. Real inbox delivery with Reply-To
is still required before approving contact for production. That requirement
is not passed. A captured or locmem message is not inbox-delivery evidence.
The owner reports that exposed credentials were replaced. This plan does not
record any credential value. Post-rotation runtime verification remains a
release check.

## Migration graph

Django 5.2 changes no migration. `makemigrations --check` on that isolated
run reported no changes.

Foundation migrations that are not on backend `main`:

- `cart/migrations/0004_guest_session.py`
- `cart/migrations/0005_rate_limit_counter.py`
- `cart/migrations/0006_frontend_budget_scopes.py`
- `orders/migrations/0001_initial.py` through `0005_orderitem_money_constraints.py`

`store/migrations/0026_product_option_configuration.py` is already on `main`.
Contact's `store/migrations/0026_enquiry.py` reused number 0026 from an older
base. Both committed migrations are kept. Enquiry creates `Enquiry` and
depends on `0025_homeslide`. The product-option migration renames
`ProductOption.price` to `price_adjustment` from the same parent. Those
operations are independent, so the local candidate adds an empty dependency
merge, `store/migrations/0027_merge_enquiry_and_product_options.py`. On
2026-10-09 a disposable in-memory SQLite database applied
`0026_product_option_configuration`, `0026_enquiry`, then `0027`. Neither
0026 was renamed. Whether production has applied the product-option migration
is still UNVERIFIED. Do not treat this local graph test as a production
migration.

App rollback does not unapply these migrations.

## Release pair

| Item | Evidence on 9 October 2026 |
| --- | --- |
| Frontend candidate | MERGED, NOT DEPLOYED. `DaveCheez/phoenix-frontend` pull request 11 merged to `master` as `67677f5c71c984ac3ae20dbc9435208b7c528cea`. Storefront code is Nuxt 4.4.8 pin `b6af3a9b59a5004cd58a4eea4d592ce0b79ee410`, including contact `3c765d30ad4e8f59866af23c194c9ba1e4e11ad7`. `build-and-smoke-test` succeeded on `631c555f5e03e1b1b15af731409fe0cb0ac813dc`. |
| Backend candidate | MERGED, NOT DEPLOYED. `DaveCheez/phoenix` pull request 12 merged to `main` as `af42b896f7845b0e8c872ec7280137ea35cf7802`. Head `20a217adcceb94065d03e57f7f1e779ae0433f05` contains contact `6c474bfadcab3eb17ef5a095d002990608e638c9`, Django 5.2 `bb92c95c127a6dc5dfe1271b0686b73cc3c493b6` and foundation `7bc85397c2f0287226cf1fb790b6270ab8951c34`. The `test` check succeeded. Email setup remains pending. |
| Tested environments | Local Nuxt `http://localhost:3000` and Django `http://127.0.0.1:8000`. Isolated `postgres:16` (server 16.15) for enabled budgets and for the Django 5.2 suite. Django 5.2 acceptance used Linux CPython 3.11.15 in a local image, not the DigitalOcean buildpack. No production-like staging app is recorded. |
| Current live revisions | UNVERIFIED |
| Production source branches | Checked-in frontend spec: `DaveCheez/phoenix-frontend`, branch `master`, `deploy_on_push: true`. Checked-in backend spec: repo text `DaveCheez/pheonix`, branch `main`, `deploy_on_push: true`. Live platform settings were still unread on 2026-10-09T16:46:48Z. See "Autodeploy observation" below. |
| Pending migrations | Cart `0004`–`0006`, orders `0001`–`0005`, and store `0026_enquiry` plus `0027_merge_enquiry_and_product_options`, relative to `main`. Both store 0026 migrations remain. Applied production set UNVERIFIED. |
| Configuration names | Frontend: `NUXT_DJANGO_API_BASE`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_CHECKOUT_ENABLED`, `NUXT_CART_CSRF_SECRET`, `NUXT_CART_ORIGIN`, `NUXT_CART_APP_CREDENTIAL`, `NUXT_CART_TRUSTED_INGRESS`. Backend: `CART_APP_CREDENTIAL`, `CART_RATE_LIMIT_HMAC_KEY`, `CART_RATE_LIMIT_ENABLED`, `CART_RATE_LIMIT_POLICIES`, `CART_FRONTEND_RATE_LIMIT_POLICIES`. Contact, only if that blocker is included: `NUXT_CONTACT_PROXY_SECRET`, `CONTACT_RECIPIENT_EMAIL`, `CONTACT_PROXY_SECRET`, and the `EMAIL_*` / `DEFAULT_FROM_EMAIL` names. No values belong in this plan. |
| Included | Guest basket access, both Start-feedback fixes, shared counters with enforcement left off, Retry-After forwarding, maintenance command with no schedule, order snapshots and deposit arithmetic, Django 5.2.18, the contact enquiry feature for local integration only, and Nuxt 4.4.8 on the frontend candidate. |
| Excluded from production approval | Real contact inbox delivery is still outstanding. Stripe checkout and balance payment. First-party reviews. Production quotas. A scheduled cleanup job. Turning on `digitalocean` trusted ingress before header provenance is verified. |
| Approval and evidence still required | Live autodeploy control. Post-rotation runtime verification. Staging. Trusted ingress and HTTPS. Real contact delivery with Reply-To. Backup and migration rehearsal. A tested basket-write freeze. Approved quotas. Maintenance scheduling and monitoring. HTTPS smoke. Recorded deployed revisions. Neither candidate is production-ready while these remain open. |

`NUXT_PUBLIC_CHECKOUT_ENABLED` stays false. Checkout is not part of this pair.

## Autodeploy observation

Observed 2026-10-09T16:46:48Z. This pass did not change App Platform.

| | Frontend | Backend |
| --- | --- | --- |
| Live app name and ID | UNVERIFIED | UNVERIFIED |
| Components | UNVERIFIED | UNVERIFIED |
| Live source repository, branch, and directory | UNVERIFIED. Template says `DaveCheez/phoenix-frontend`, `master`. | UNVERIFIED. Template says `DaveCheez/pheonix`, `main`. Git remote is `DaveCheez/phoenix`. The live spelling was not read. |
| Autodeploy before and after | UNVERIFIED / not changed | UNVERIFIED / not changed |
| Active deployment ID, time, status, and source SHA | UNVERIFIED | UNVERIFIED |
| Queued or in-progress platform deployment | UNVERIFIED | UNVERIFIED |

Method: the browser had no DigitalOcean session. Opening the apps list returned the login page. `doctl` is not installed and no DigitalOcean token is set. No app spec was submitted, and no deploy, restart, or rebuild was requested.

GitHub Actions, from the public workflow API and Actions pages, are ordinary CI:

- `DaveCheez/phoenix-frontend`: one active workflow, `Frontend tests` (`.github/workflows/tests.yml`). Triggers are push and pull request to `master`, `main`, and `develop`. No queued or in-progress run. Latest completed run on the page is `master` `2d51619`.
- `DaveCheez/phoenix`: one active workflow, `Backend tests` (`.github/workflows/tests.yml`), with the same trigger limits. No queued or in-progress run. Latest completed run on the page is `main` `9c708a0`.

Neither workflow invokes App Platform, publishes an image, or uses schedule, `workflow_run`, or manual dispatch. Those CI checks stay enabled. They do not prove the live autodeploy checkbox is off. The GitHub SHAs above are CI revisions, not the commits serving traffic.

A push of local `e8370b14` on `feature/guest-cart-access` does not match the GitHub Actions branch filters. It is still not approved, because the App Platform source branch is unread.

Remaining approval: sign in at DigitalOcean, open the apps that serve the production domains, record each component's active deployment, and turn autodeploy off only through a control that does not deploy. If the control is an app-spec save that deploys, stop.

## Deployment sequence

Do this in order. Stop if a step is not evidenced.

1. Read the live autodeploy control for both apps and both workflow files. Disable deploy-on-push before either production-branch merge. Record the live revision now, so the pair is not confused with what is already serving.
2. PV-CONTACT is in the local candidates. Keep testing save-before-email locally. Real Reply-To delivery to an approved inbox is still required before production approval. Do not mark that check passed from captured mail.
3. Rehearse backup and restore of the production database. Record the migration list that restore returns to. Do not assume an application rollback undoes `cart` `0004`–`0006` or `orders` `0001`–`0005`.
4. Put the exact candidate pair on a production-like staging environment. No staging app is recorded today. Confirm homepage slides, product-option lines, and Elfsight still behave. Exercise guest start, add, uncertain recovery, and a direct Django cart call.
5. Prove a basket-operation maintenance switch that rejects basket writes on both the Nuxt routes and the direct Django cart API. The counter cleanup command does not do this. Do not open the basket while migrations or the cutover are in progress.
6. Deploy the backend, run the reviewed migrations, and only then deploy the matching frontend. Enforcement stays off until `CART_RATE_LIMIT_*` values are approved. The maintenance command stays unscheduled until its three proposed checks exist and the cadence is approved.
7. HTTPS smoke: homepage, contact, health, basket start, add, and recovery. Record both deployed revisions.
8. Reopen basket writes only after that smoke. Paired rollback means the previous frontend with a backend that still understands guest ownership, or an explicit fix-forward. Do not return to UUID-only ownership.

## Local contact integration

Recorded 2026-10-09. Worktrees:

- Backend `backend-release-secure-storefront`, branch `release/secure-storefront`, commit `6c474bfadcab3eb17ef5a095d002990608e638c9`.
- Frontend `phoenix-frontend-release`, branch `release/secure-storefront`, contact commit `3c765d30ad4e8f59866af23c194c9ba1e4e11ad7`.

Backend checks on the saved Linux virtualenv (`phoenix-vanz-django52-py311:local`, CPython 3.11, Django 5.2.18), settings `base.settings_sqlite_tests`, in-memory SQLite, locmem email:

- `manage.py test`: 332 tests OK, 15 skipped.
- `manage.py test base.test_storage_settings store.test_enquiries`: 33 tests OK.
- `migrate` then `showmigrations store`: both 0026 migrations and `0027_merge_enquiry_and_product_options` applied.

The production storage subprocess needed synthetic contact and email settings so Django 5.2 `STORAGES` could still be imported after the contact production checks. Those values are test placeholders. They are not production credentials and they are not inbox delivery.

Frontend checks in the release worktree only, Nuxt 3.21.11, after `npm ci` and `nuxt build`: `npm run test:cart-access` 59 passed, 0 failed. Ports 3000 and 8000 were not used.

## Local Nuxt upgrade

The frontend release candidate then pins `nuxt@4.4.8`. Current Nuxt 4.6.0 requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`. Nuxt 4.5.2 requires `^22.19.0 || ^24.11.0 || >=26.0.0`. This machine is Node v22.14.0, which satisfies Nuxt 4.4.8 (`^22.12.0 || ^24.11.0 || >=26.0.0`) and does not satisfy 4.5 or 4.6. Node was not changed, so 4.6 was not claimed as tested.

The official Nuxt 4 upgrade guide says moving into `app/` is optional when Nuxt detects the existing root layout. This candidate kept root `pages/`, `components/`, `server/` and the private runtime configuration. No visual redesign.

After the pin, in the release worktree only: `npm run build` completed on Nuxt 4.4.8, Nitro 2.13.4, Vite 7.3.7 and Vue 3.5.43. `npm run test:cart-access` passed 59 tests. `node .output/server/index.mjs` listened on `127.0.0.1:3011` and returned homepage 200 and `/api/health` 200. That process was then stopped. Ports 3000 and 8000 were left running.

## Local paired check

Recorded 2026-10-09 after the Nuxt pin. Disposable PostgreSQL 16.15, database `phoenix_vanz_budget`, published only on `127.0.0.1`. Django ran from the saved Linux virtualenv in `phoenix-vanz-django52-py311:local`, sharing that database container's network so the application still used host `127.0.0.1`. Email was file capture, not an inbox. The normal servers on ports 3000 and 8000 were left running.

`PHOENIX_ENABLED_BUDGET_VERIFICATION=1` and `PHOENIX_DJANGO_RUNTIME=linux-image`. Edge 155 headless. Result exit 0. All six checks passed:

- explicit guest start, Enhanced paid option, cart reload showing the option and 125, quantity update from 1 to 2;
- real CSRF denial, Retry-After 31, no mutation, cookie unchanged, then a later start returned 201;
- real reset denial, cookie and basket unchanged;
- real authenticated-cart denial, Retry-After present, basket unchanged;
- contact HTTP 201 `ENQUIRY_RECEIVED`, database status `sent`, captured file Reply-To matched `pair-check@example.invalid`;
- Django `/health/` 200, admin login 200, admin CSS 200 `text/css`, built Nuxt `/api/health` 200.

The captured message is not real inbox delivery. Contact is not approved for production.

## Cutover request

2026-10-09. Scope is frozen. The candidate build of Nuxt 4.4.8 completed, and the built entry on `127.0.0.1:3011` returned homepage 200 and `/api/health` 200. The earlier disposable PostgreSQL pair is still the basket and contact evidence; application source has not changed since that run. `https://cloud.digitalocean.com/apps` redirected to login. No token, `doctl`, or `gh` was available. Autodeploy was not read and not changed. Nothing was pushed. `master` and `main` were not updated. Production database version, applied migrations and a backup point remain UNVERIFIED.

## What this plan does not do

It does not provision staging, activate a job, choose quotas, change DNS, or
enable checkout. It does not claim that a basket maintenance switch, a
monitor, or a staging environment already exists.
