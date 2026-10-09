# Cross-repository merge and release plan

Reviewed 9 October 2026 from the commits named below. This plan has not been
executed. Do not merge, push, deploy, or change platform settings from this
document.

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

Status: separate, not ready to merge. Enquiry delivery remains a current
priority. Real inbox delivery with Reply-To is not recorded. Do not drop the
branches, do not defer them by omission, and do not merge them into the
candidate until the migration graph below is resolved and the result is
re-tested.

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
base. Do not renumber the product-option migration if production has applied
it. Whether production has applied it is UNVERIFIED. The enquiry change needs
a new migration sequenced after the applied chain.

App rollback does not unapply these migrations.

## Release pair

| Item | Evidence on 9 October 2026 |
| --- | --- |
| Frontend candidate | `208572716fc17fc7bcd343193c89b772ad279368` |
| Backend candidate | `bb92c95c127a6dc5dfe1271b0686b73cc3c493b6`, which contains foundation `7bc85397c2f0287226cf1fb790b6270ab8951c34` |
| Tested environments | Local Nuxt `http://localhost:3000` and Django `http://127.0.0.1:8000`. Isolated `postgres:16` (server 16.15) for enabled budgets and for the Django 5.2 suite. Django 5.2 acceptance used Linux CPython 3.11.15 in a local image, not the DigitalOcean buildpack. No production-like staging app is recorded. |
| Current live revisions | UNVERIFIED |
| Production source branches | Checked-in frontend spec: `DaveCheez/phoenix-frontend`, branch `master`, `deploy_on_push: true`. Checked-in backend spec: repo text `DaveCheez/pheonix`, branch `main`, `deploy_on_push: true`, and the file still describes a first deployment with replacement values. Live platform settings are UNVERIFIED. GitHub workflows run tests on `master`, `main` and `develop`. They do not deploy. |
| Pending migrations | Cart `0004`–`0006` and orders `0001`–`0005`, relative to `main`. Contact's `0026_enquiry` collides in number with the product-option migration on `main`. Applied production set UNVERIFIED. |
| Configuration names | Frontend: `NUXT_DJANGO_API_BASE`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_CHECKOUT_ENABLED`, `NUXT_CART_CSRF_SECRET`, `NUXT_CART_ORIGIN`, `NUXT_CART_APP_CREDENTIAL`, `NUXT_CART_TRUSTED_INGRESS`. Backend: `CART_APP_CREDENTIAL`, `CART_RATE_LIMIT_HMAC_KEY`, `CART_RATE_LIMIT_ENABLED`, `CART_RATE_LIMIT_POLICIES`, `CART_FRONTEND_RATE_LIMIT_POLICIES`. Contact, only if that blocker is included: `NUXT_CONTACT_PROXY_SECRET`, `CONTACT_RECIPIENT_EMAIL`, `CONTACT_PROXY_SECRET`, and the `EMAIL_*` / `DEFAULT_FROM_EMAIL` names. No values belong in this plan. |
| Included | Guest basket access, both Start-feedback fixes, shared counters with enforcement left off, Retry-After forwarding, maintenance command with no schedule, order snapshots and deposit arithmetic, Django 5.2.18. |
| Excluded | Contact until PV-CONTACT is resolved. Stripe checkout and balance payment. First-party reviews. A further Nuxt upgrade. Production quotas. A scheduled cleanup job. Turning on `digitalocean` trusted ingress before header provenance is verified. |
| Approval and evidence still required | Live autodeploy confirmation and a recorded disable. Source review of the pair. Contact disposition. Migration and backup rehearsal. A tested basket-write freeze that covers direct Django paths. Staging of this pair. Approved quotas and monitor settings. HTTPS smoke. Recorded deployed revisions. |

`NUXT_PUBLIC_CHECKOUT_ENABLED` stays false. Checkout is not part of this pair.

## Deployment sequence

Do this in order. Stop if a step is not evidenced.

1. Read the live autodeploy control for both apps and both workflow files. Disable deploy-on-push before either production-branch merge. Record the live revision now, so the pair is not confused with what is already serving.
2. Decide PV-CONTACT. Integrate it only after the enquiry migration is sequenced past the applied store chain, then re-test save-before-email and real Reply-To delivery. Leaving it unmerged has to be an explicit decision, not an omission.
3. Rehearse backup and restore of the production database. Record the migration list that restore returns to. Do not assume an application rollback undoes `cart` `0004`–`0006` or `orders` `0001`–`0005`.
4. Put the exact candidate pair on a production-like staging environment. No staging app is recorded today. Confirm homepage slides, product-option lines, and Elfsight still behave. Exercise guest start, add, uncertain recovery, and a direct Django cart call.
5. Prove a basket-operation maintenance switch that rejects basket writes on both the Nuxt routes and the direct Django cart API. The counter cleanup command does not do this. Do not open the basket while migrations or the cutover are in progress.
6. Deploy the backend, run the reviewed migrations, and only then deploy the matching frontend. Enforcement stays off until `CART_RATE_LIMIT_*` values are approved. The maintenance command stays unscheduled until its three proposed checks exist and the cadence is approved.
7. HTTPS smoke: homepage, contact, health, basket start, add, and recovery. Record both deployed revisions.
8. Reopen basket writes only after that smoke. Paired rollback means the previous frontend with a backend that still understands guest ownership, or an explicit fix-forward. Do not return to UUID-only ownership.

## What this plan does not do

It does not provision staging, activate a job, choose quotas, change DNS, or
enable checkout. It does not claim that a basket maintenance switch, a
monitor, or a staging environment already exists.
