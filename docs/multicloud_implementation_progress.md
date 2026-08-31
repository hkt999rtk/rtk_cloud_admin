# Multi-cloud implementation checkpoint — 2026-08-31

This is an implementation checkpoint, **not release acceptance**. The reviewed
`multicloud_webui.md` remains the target. No runtime PR, deployment, shared database
write, migration, production deletion, or payment-provider action was performed
for this Cloud Admin checkpoint.

## Implemented in this batch

- Global-session BFF list/create/detail/edit/deletion-preflight/delete/operation
  routes. Cloud UUID comes from each request, never `ActiveOrgID`; these routes
  neither switch the session's view nor mutate its active organization.
- Filtered list totals are separate from owned/reserved quota; shared clouds do
  not consume ownership quota. Missing upstream quota is an error, not zero.
- Owner writes preserve idempotency keys, restrict input fields, reject duplicate
  JSON keys and cross-origin writes, and rely on live Account Manager authority.
  Client-supplied Billing actor headers are never forwarded.
- Public response projections omit arbitrary metadata/payment secrets. Detail,
  Product and operation responses must match the requested scope. Malformed
  operation identifiers and contradictory deletion eligibility fail closed.
- `/console/clouds` has All/Owned/Shared views, create/edit, quota, pagination,
  empty/loading/error states. Cloud pages show scoped Product summaries; Product
  URLs nest beneath their cloud. Read requests are canceled on scope changes.
- Deletion has a preflight, explicit confirmation, server operation polling, and
  a reloadable operation URL. Acceptance is not optimistic success. Deletion
  requires zero balance; transfer's nonnegative-balance rule remains distinct.
- Authenticated global accounts with no membership can reach empty My Clouds;
  upstream eligibility still controls whether they can create a cloud.
- Permission errors clear sensitive page/form state; upstream 401 clears the
  local session cookie. Login links preserve operation queries. Logout is
  reachable from the new header; Platform view uses the existing view endpoint.

## Automated evidence

Executed in an isolated worktree using SQLite/httptest fixtures, not staging:

```sh
go test ./... -count=1 -coverprofile=/tmp/rtk-multicloud-admin-coverage-20260831.out
go test -race ./internal/accountclient ./internal/app -run '^TestManagedCloud' -count=3
go vet ./...
go build -o /tmp/rtk-multicloud-admin-20260831 ./cmd/server
cd web && npm test && npm run build
```

All passed. Go total statement coverage: **80.3%**. Frontend: **112 tests**.
New regression cases cover explicit two-cloud scope, viewer mutation rejection,
create/edit/delete/poll response statuses, invalid queries and unauthenticated
access, duplicate/unknown/null JSON, Origin/key validation, sanitized errors,
expired-session invalidation, malformed operation results, and stable retry keys.
Fixture creation/deletion responses do not prove real Account Manager/Billing
transactions; those require the separate backend and cross-service suites.

OpenAPI validation passed with the approved canonical contracts from the design
integration checkout, including duplicate-key detection. The temporary worktree's
relative canonical symlink has no sibling checkout, so the validator resolves that
one reference to the approved canonical file in memory (no source rewrite).

Workspace inventory was inspected through a read-only overlay with this checkout
substituted for Cloud Admin. It reports **zero blocking inventory findings** after
mapping the new operations. The overall `test-spec-inventory check` is **not green**:
the committed workspace `docs/spec-test-traceability.md` is stale. Its generated
candidate is `/tmp/rtk-multicloud-admin-inventory.wFyuo3/artifacts/SPEC_TRACEABILITY.md`.
Update the workspace traceability artifact with the integration changes; do not
treat this diagnostic as a passing workspace CI or contract-consistency check.

## Browser evidence and limits

Used the in-app Browser with the disposable, opt-in
`TestManagedCloudBrowserFixture` on `127.0.0.1:18192`. It runs the actual BFF and
built frontend against synthetic Account Manager responses and a temporary SQLite
session. The fixture helper/session cookie override exists only in `_test.go`.

Observed on desktop (1280 px):

1. Owner and viewer clouds render distinct controls; viewer has no edit button.
2. Creating a cloud updates owned count from 1/8 to 2/8; editing preserves its ID.
3. Shared filter shows one matching cloud while owned quota remains separate.
4. Two tabs retain distinct cloud scopes; Product link includes its cloud UUID.
   Fixture call log shows explicit upstream cloud paths and unchanged active org.
5. Delete confirmation reaches server-reported completion. Reloading the operation
   URL still shows its status without needing the deleted cloud detail.
6. After fixture authorization is revoked, reloading the Product tab displays an
   access-revoked error and no previous cloud/Product contents.

The Browser skill guided these visible-page checks; they are fixture evidence,
not evidence of actual production deletion, billing settlement, or release readiness.
Mobile validation is **pending**: the requested 390×844 viewport override left the
actual viewport at 1280 px, including a new tab and reload. No mobile pass claimed.
The final header/logout and post-write permission-error refinements were built and
unit-tested but not separately browser-qualified in this checkpoint.

## Required follow-up before release

- Complete sharing/invitation/member-scope, transfer/amount confirmation/recovery,
  owner-only Billing, audit, and Product resource (Devices/Firmware/OTA) UI flows.
- Replace remaining legacy session-kind/active-org guards and old resource routes;
  new scoped CRUD must not be mistaken for complete account/session cutover.
  Verify dual-capability view switching and expired-operation login next end to end.
- Complete Product-scope authorization, downloads/statistics/background work and
  pagination qualification against real services, not only synthetic summaries.
- Integrate workspace traceability, run contract consistency and full CI, and
  requalify all changed routes after integration with Account Manager/Billing.
- Resolve the existing npm audit findings (three high-severity locked dependency
  findings reported at install: nanoid, postcss, vite). No automatic dependency
  upgrades were applied in this feature batch. Re-audit the actual release lockfile.
- Obtain real mobile evidence, slow/racing request and permission-revocation
  interaction tests, then staging activation/sharing/association/certificate/MQTT
  evidence. Preserve the original unreleased identity-migration corrections.

Neither one passing package test nor this new UI is the completion criterion.

## Follow-up checkpoint: sharing and member scopes

The next local implementation adds owner-only sharing controls beneath each cloud:
invite a verified developer, view pending invitations, resend unchanged scope,
cancel, read current members, edit role/viewer scope, enable/disable and remove
access. Viewer plus selected Products is the default. Empty selection is rejected;
whole-cloud viewer requires explicit acknowledgement of future Products.
Existing admin/member permissions are shown as non-read-only, not relabeled viewer.

All corresponding sharing BFF routes now accept the global account session without
depending on its active organization or current platform/customer view. They bind
explicit cloud/user/invitation IDs, recheck live owner authority, preserve the
Idempotency-Key through the upstream request and return current persisted scopes.
General member/invitation APIs reject owner assignment. Unknown fields, nested
duplicate keys, null scopes, duplicate Product IDs, cross-origin writes and ambiguous
scope combinations are rejected. Upstream results with a different cloud, target,
role or requested scope fail closed instead of reporting a broader grant as success.
Acceptance also requires returned membership to match the authenticated account.
Empty 204 removal responses are handled without attempting JSON decoding.

The nine replaced/unregistered legacy cloud/sharing handler functions were removed;
legacy Product/resource endpoints and session-kind cutover remain separate work.
The existing acceptance page now catches connection failures and links accepted
cloud invitations to `/console/clouds/{cloudId}`. Its real email/login/acceptance
journey is **not** browser-qualified by the owner-only fixture below.

Additional automated checks:

```sh
go test ./... -count=1 -coverprofile=/tmp/rtk-cloud-sharing-coverage.out
go test -race ./internal/app ./internal/accountclient -run '(CloudSharing|ManagedCloud)' -count=3
go vet ./...
go build -o /tmp/rtk-cloud-sharing-admin ./cmd/server
cd web && npm test && npm run build
```

Go suite, repeated race tests, vet, server build and frontend build passed.
Frontend now has **116 passing tests**. These include normalized Product ordering
and retry keys, explicit whole-cloud consent, invalid ownership assignment,
cross-cloud readback rejection, altered grant responses and invitation acceptance
readback for the wrong global account. These are BFF/client/fixture tests, not a
substitute for real downstream ACL and email-outbox qualification.

The Browser skill was used on the opt-in disposable fixture (actual BFF and built
frontend, synthetic Account Manager only). Desktop observations:

- Default viewer and selected-Product form; no Product selected cannot submit.
- Selected-Product invitation appears pending without creating a member.
- Whole-cloud sharing requires acknowledgement; trying to widen an existing
  pending invitation shows 409 and leaves its original scope visible.
- Cancel requires confirmation; readback shows canceled. Member scope edit
  reloads the actual member and shows current/future-Product access.
- Removal requires confirmation explaining grant invalidation; the member count
  drops from two to one after the 204 response and server readback.
- Owner authority revoked between form entry and submit produces an access-revoked
  state with old cloud, Product and sharing contents cleared.

No real email, provider payment, shared database or staging action occurred.
Mobile, recipient email/login acceptance, real scope revocation/rejoin, slow-request
and multi-page Product selection qualification remain release requirements.
OpenAPI validation passed; inventory still has zero blocking mappings but the
workspace traceability artifact remains stale, so the overall inventory gate is
still not green. Ownership-transfer/Billing UI and cross-service release evidence
remain incomplete. The previous release checklist remains applicable except that
sharing controls now need integration qualification rather than initial UI creation.

## Follow-up checkpoint: ownership and Billing handoff UI

Implemented the cloud-scoped ownership request, global invitation acceptance,
participant status, settled preview, exact-balance confirmation and precommit
cancellation BFF. All writes preserve a random per-intent Idempotency-Key. Strict
request parsing rejects duplicate/unknown fields, missing or negative amounts,
wrong currency and invalid scope before delivery. A zero amount is not treated
as missing. Requests use the global account token; neither an active organization
nor current cloud membership is a prerequisite for participant endpoints. This
allows the invited target before joining, and the source after losing membership,
to inspect their operation without granting access to arbitrary cloud resources.
The upstream Account Manager still authorizes each action and owns serialization.

The projected response binds cloud, operation and participant identities and
requires consistent snapshot/confirmation evidence. An accepted invitation or a
finalizing operation is never reported as completed. The browser binds consent
to cloud, transfer, amount, currency and both versions, requires a fresh preview,
invalidates old consent when the snapshot changes, and refuses unsafe JavaScript
integer amounts. Retrying an ambiguous confirmation retains its original key,
including after reading the same preview again. No payment method or provider
secret is exposed by this projection.

The standalone handoff page does not fetch cloud contents to establish access.
It shows settlement blockers, both confirmation flags, forward-only finalization,
and cancellation awaiting hold release. Initial service failures have a read-only
retry action. Legacy settings now link to cloud management instead of presenting
token-paste acceptance as completed ownership transfer. Public SPA shells were
missing for the owner, cloud-member and Product-collaborator email URLs; these
routes now serve the frontend, while their acceptance APIs remain authenticated.

Validation performed against this local worktree:

```sh
go test ./... -count=1 -coverprofile=/tmp/rtk-owner-handoff-coverage.out
go test -race ./internal/app ./internal/accountclient -run 'OwnerHandoff|GlobalInvitation' -count=3
go vet ./...
go build -o /tmp/rtk-owner-handoff-admin ./cmd/server
npm --prefix web test
npm --prefix web run build
```

All commands passed; Go statement coverage is **80.8%**, and frontend has **120
passing tests**. Dedicated lifecycle tests check request/accept/cancel delivery,
global actor binding, stable retry keys, and retention of `canceling` rather than
optimistic cancellation. OpenAPI validation with the approved canonical contract
passed. Inventory has **zero blocking mappings**, but still exits nonzero for the
stale workspace traceability artifact; the full inventory/CI gate is not green.

The Browser skill was used on two independently authenticated local fixture
origins, with actual BFF and built frontend and synthetic Account Manager states:

- Invitation acceptance requires explicit acknowledgement, then enters the
  scoped handoff page rather than announcing completed ownership.
- Positive and zero snapshots can be confirmed. Changing the amount/version
  invalidates the prior checkbox; a negative-balance blocker removes confirmation.
- Both zero-balance confirmations lead first to finalizing with no cancellation
  action. Only the succeeded receipt shows completion: target gets the cloud
  link, source sees that cloud/Product access has ended.
- A separate precommit cancellation case shows waiting for hold release before
  the fixture's release receipt produces canceled. A transient dependency failure
  clears the screen; the status retry restores the authoritative fixture result.
- The desktop canceled-state layout was visually inspected. Mobile remains
  unverified, as in the earlier checkpoint.

Fixture resets are independent state cases, **not** permitted real transitions
from finalized back to preparing, nor proof of debt repayment inside a fenced
handoff. No actual owner/membership, payment authority, Billing ledger, email,
shared database or staging resources changed. Creating the invitation through
the cloud form, real email/login, financial settlement and recovery, Product
ownership/ACL removal, mobile and cross-service staging qualification remain
required. This checkpoint implements the transfer UI; it does not complete the
larger multi-cloud release or replace the remaining checklist above.

## Follow-up checkpoint: explicitly scoped owner Billing

Moved the 22 Billing BFF methods to
`/api/developer/brand-clouds/{brandCloudID}/billing/*`. Unscoped `/api/billing/*`
no longer routes. Every operation, including PDF/CSV downloads, authenticates
the global session and reads live cloud detail. It requires matching owner ID,
owner role, requested capability and positive ownership version; an admin or
viewer with a Billing capability still cannot access it. A platform-view session
may use the customer Billing boundary only when its user actually owns that cloud.
No session active-cloud/view mutation is performed.

The service client now requires a request-local cloud/user/version binding and
constructs `X-Billing-Ownership-Version` alongside the dedicated service credential
and exact permission. It rejects missing/mismatched context before delivery,
including exports; browser-supplied trusted Billing headers are never forwarded.
Writes additionally compare the displayed `X-Cloud-Ownership-Version` with live
Account Manager evidence. Ownership errors from Billing preserve sanitized
403/409/503 semantics rather than becoming an optimistic successful response.
The account readback must match the cloud. Oversized downloads fail instead of
silently returning a truncated document. Financial input now uses the shared
strict JSON parser, including duplicate/null/unknown-field rejection.

The existing Billing views are mounted at `/console/clouds/{cloudId}/billing`
under a request-local React scope. All data reads, financial writes, invoice PDFs
and statement links use that cloud. Ten initial reads must return one consistent
ownership version and the correct account; inconsistent responses are discarded.
Navigation/load cleanup aborts old reads; there is no shared current-cloud cache.
Old ambiguous Billing UI paths direct users to My Clouds without reading Billing.
Payment retries reuse a per-intent key, and 202 is described as processing, not a
successful charge. Profile writes whitelist editable fields. Denied writes clear
the current Billing view without signing out other cloud tabs.

Checks passed:

```sh
go test ./... -count=1 -coverprofile=/tmp/rtk-cloud-billing-coverage.out
go test -race ./internal/app ./internal/billingclient -run 'Billing|Payment' -count=3
go vet ./...
go build -o /tmp/rtk-cloud-billing-admin ./cmd/server
npm --prefix web test
npm --prefix web run build
```

Go statement coverage: **80.9%**. Frontend: **122 passing tests**. OpenAPI validation
passed. Inventory mappings have zero blockers, but the workspace traceability
artifact is still stale; inventory overall and full CI are **not** qualified.

Browser skill observations on the opt-in local fixture: two tabs of the same
account show Cloud A balance/profile and Cloud B balance/profile independently;
a viewer tab shows denied access and no financial contents. Revoking Cloud A
ownership between form load and submit rejects the profile write and clears its
contents; Cloud B retains its own profile. The profile desktop layout was visually
inspected and the active-tab contrast corrected. The fixture simulates service
records only; no provider action, real payer change or shared database was used.

Remaining Billing qualification includes real cross-service owner/version and
responsibility-period filtering, historical invoices/exports/payment-method
visibility, handoff fences/response races, provider setup/charge/consent and retry
journeys, pagination and detail URLs beyond the first page, passive revocation
updates, and mobile. Existing `web/e2e/billing*.spec.mjs` fixtures still use the
old route contract and must be migrated before running the full browser CI suite.
Other global-session/Product-resource cutover work, dependency audit findings,
workspace integration and real staging activation/MQTT gates remain outstanding.

## Follow-up checkpoint: Billing browser regression migration

The existing Billing browser specifications now target the scoped cloud URL and
use dedicated UUID-backed global owner/viewer fixture identities. Other legacy
fleet fixtures were not relabeled or silently granted Billing authority. Mock
Billing verifies the forwarded owner/version and persists profile/policy readback
so tests assert server state rather than transient optimistic success messages.

The Billing page additionally revalidates cloud owner/version on window focus and
every ten seconds while mounted. Failure clears its payer data and controls;
cleanup aborts pending authority requests and removes the timer/listener. Monetary
requests continue to perform their own live server-side checks independently.

Local repository browser regression run:

```sh
E2E_FIXTURE_DIR=/tmp/rtk-billing-browser-ci.ahEqfx/fixtures \
E2E_TEST_RUN_DIR=/tmp/rtk-billing-browser-ci.ahEqfx/final-results \
./node_modules/.bin/playwright test e2e/billing.spec.mjs \
  --project=chromium --project=mobile --workers=2
```

**18 passed**: nine cases each on desktop Chromium and emulated Pixel 7. Coverage
includes overview, simulated hosted setup/checkout, policy/profile persisted
readback, scoped invoice download links/activity, viewer denial, retired unscoped
API, two-cloud tabs, stale-version writes and passive authority revocation. The
revocation case intercepts the authority response, while Go tests independently
cover real BFF role/version enforcement. It verifies a sub-600px mobile viewport;
the mobile profile screenshot was inspected. This is automated mobile-emulation
evidence for Billing, not real hardware or proof of the earlier My Clouds/sharing/
handoff mobile flows. Provider pages are local simulators, not actual payments.
The final per-target reruns use separate `desktop` and `mobile` result directories
under the same `/tmp/rtk-billing-browser-ci.ahEqfx` root and set `E2E_TEST_TARGET`
accordingly. This avoids the existing reporter merging both projects by Test ID.
They additionally fetch the invoice PDF, check its no-store response and verify
that a viewer cannot download it. The byte-prefix assertion exposed and corrected
the old mock's JSON-quoting of PDF/CSV bodies; a link-only assertion missed this.
Reports honestly identify a local dirty-tree
test snapshot, not a published CI revision.

The staging Billing specifications were updated to scoped paths, require a
positive ownership-version response and check denial for a configured unowned
cloud. They were syntax-checked, **not run against staging**. The deployment skill
was applied to keep this work local: no live reset, rollout, provider action or
credential access occurred. Full browser CI outside these Billing cases, actual
cross-service financial/history qualification and the remaining release gates
are still outstanding. The prior note about obsolete Billing browser fixtures
is superseded by this checkpoint.

## Follow-up checkpoint: cloud-scoped Product management

The scoped Product summary is now a paginated management surface at
`/console/clouds/{cloudId}` and `/console/clouds/{cloudId}/products/{productId}`.
It supports name/key/model/category/service-option creation, metadata editing and
explicit Product **disable**, not resource deletion. UUID, cloud and Product key
are immutable in this BFF. Service values match Account Manager's existing
`mqtt`, `video_streaming`, `video_storage` contract.

The matching scoped GET/POST/PATCH/disable BFF routes use the URL cloud, never the
session's active organization. Each request checks current cloud authority;
Product writes also require live Product access. A viewer ceiling applies even
if the Product response claims a stronger role. Product editors can edit but
cannot use this BFF's disable action. Unknown/duplicate/null input, foreign
Origin, absent/invalid retry keys and cross-cloud readback fail closed. Safe
projections omit arbitrary metadata, private keys and fabricated resource counts.
Pagination validates cloud IDs, unique Product IDs, filtered totals and page
shape. Write keys are forwarded; upstream conflict is not presented as a
successful idempotent replay.

The UI isolates requests per cloud/Product, aborts obsolete reads, polls current
authority and removes stale data/forms after denied access. Invitation success
links now use validated nested cloud/Product URLs. Distinct component keys also
fix the duplicate ownership-transfer form discovered during browser verification.

Local validation (synthetic upstream + temporary SQLite; **not staging**):

- Full Go suite: passed, total statement coverage **81.1%**.
- Scoped Product Account Manager-client/BFF race tests: passed twice.
- `go vet ./...`, server build, frontend build: passed.
- Frontend unit tests: **127 passed**.
- Repository Playwright `UI-CA-PRODUCTS-101`: passed separately on desktop
  Chromium and emulated Pixel 7. Covers 27-item pagination, filtered empty state,
  create/edit/disable with persisted fixture readback, immutable key, viewer
  ceiling, wrong-cloud denial, two simultaneous cloud tabs, passive revocation
  of only one cloud, and mobile overflow checks. Form and viewer screenshots
  are attached; viewer desktop/mobile renderings were visually inspected.
- OpenAPI validation passed using the reviewed canonical reference resolved in
  memory. Inventory has **zero blocking findings**, but the overall workspace
  check still fails because committed `docs/spec-test-traceability.md` is stale.

Browser reproduction: start the opt-in `TestScopedProductBrowserFixture` with
`SCOPED_PRODUCT_UI_FIXTURE=1` after building `web`; it serves only loopback port
18197. Run `web/e2e/scoped-products.spec.mjs` with the same flag and
`E2E_BASE_URL=http://127.0.0.1:18197`, using separate result directories and target
metadata for desktop/mobile. Its reset/revoke controls exist only in `_test.go`
and affect synthetic fixture state. Reports for this dirty-tree snapshot are in
`/tmp/rtk-scoped-product-browser.H5X4jf/{desktop,mobile}`. Go/unit/race logs and
coverage are under `/tmp/rtk-scoped-products-*`; they are not published CI proof.

### Remaining Product/release work

This checkpoint does **not** complete the hierarchy or release gates. Legacy
`/api/products/*` and Device/Firmware/OTA surfaces still need scoped integration
and qualification. The sharing selector currently uses the initial Product page;
it needs paginated selection rather than treating that page as the complete set.
Real Account Manager producer/lifecycle authorization, optional-field clearing and
write replay semantics require cross-service tests; fixture readback does not
prove those behaviors. The new opt-in browser case still needs integration into
the canonical CI runner/test inventory. Workspace traceability, contract
consistency, full cross-service CI and staging activation/device/certificate/MQTT
acceptance remain outstanding. No deployment, shared DB mutation, real email,
payment action or legacy-table cleanup occurred in this batch.

## Follow-up checkpoint: Product device scope and safe display editing

Product pages now include real server-filtered device search/pagination; device
details use `/console/clouds/{cloudId}/products/{productId}/devices/{deviceId}`.
GET/list/PATCH BFF requests bind all three identities, validate the live cloud and
Product, and never change the account session's active cloud. List totals come
from the same upstream Product filter. Cross-cloud/Product, duplicate device IDs,
missing/impossible pagination and malformed queries are withheld, not repaired
by filtering a broad response in the browser.

Device display editing uses a new AM display-only endpoint, not the legacy
full-record PATCH which replaces omitted hardware/metadata columns. The BFF
accepts only name/model, requires same-origin/idempotency headers and current
device write permission, and retains a viewer ceiling. AM rechecks exact binding
and authority under transaction locks and audits before commit. Name/model
changes preserve serial/MAC/manufacturer, Product, status and activation metadata.
The BFF projection exposes neither raw metadata nor credentials/playback data.
Assignment retries are safe but are not claimed to be historical-response replay.

The UI supports scoped list/detail navigation, filtered empty state, readback
after editing, explicit model clearing, canceled stale reads and passive authority
rechecks. Losing device access clears the page rather than showing old data.
Backend tests separately exercise real PostgreSQL persistence and HTTP contracts;
the browser upstream remains a synthetic fixture, not a real deployed AM.

Local evidence:

- Full Admin Go suite PASS; total statement coverage **81.0%**.
- Targeted device/Product BFF/client race tests PASS twice; vet PASS.
- Frontend unit tests **131 PASS**; frontend production build PASS.
- Product and device repository browser cases PASS on desktop Chromium and
  emulated Pixel 7: **4 passes**, run sequentially against the same disposable
  loopback fixture, with separate per-target reports. Device tests cover 26-item
  pagination, search/empty state, edit/reload with serial preserved, viewer denial,
  wrong-cloud denial, two-cloud tabs, passive revocation and mobile overflow.
  Mobile device detail and Product/device list screenshots were inspected.
- AM and Admin OpenAPI validation PASS. The reviewed canonical Billing reference
  is resolved in memory for Admin, with no source symlink rewrite.

Reproduction uses the existing opt-in `TestScopedProductBrowserFixture`, followed
by `web/e2e/product-devices.spec.mjs` and `web/e2e/scoped-products.spec.mjs`, one
worker and one target at a time. Reports are in
`/tmp/rtk-product-devices-browser.jIS5OE/{desktop,mobile}`; they identify a dirty
local snapshot based on 91f4ff5, not a published CI SHA. Go/unit/race/build logs are
`/tmp/rtk-product-devices-*`. Fixture reset/revoke changes only in-memory test data.

**Integration correction:** substituting all current AM/Billing/Admin worktrees
into a new read-only spec overlay found **21 blocking operation mappings**, plus
stale workspace traceability. The previous zero-blocker result applied only to
Admin against reviewed baseline dependencies. Full diagnostic:
`/tmp/rtk-device-scope-inventory.4o3gdW/local-inventory/spec-inventory.json`.
No new device operation is unmapped; the existing cross-service mappings still
require correction, not omission from the inventory denominator.

Remaining: claim/provision/deactivation with real activation inputs, firmware/
OTA/telemetry and downloads, legacy unscoped endpoint retirement,
complete producer/Billing adapters and transactional fencing, combined
cross-service CI/coverage/traceability, and staging activation/device/certificate/
MQTT qualification. No live deployment or shared database update occurred.

### Refreshed cross-service inventory

The previous 21-blocker diagnostic is superseded after the AM mapping corrections
and workspace YAML/registered Path Item parser fix. With all three implementation
branches refreshed against documentation-governance mainlines, the read-only
candidate at `/tmp/rtk-multicloud-refreshed-inventory.ypQM3C/local-inventory/`
passes required inventory: 391 requirements, 655 operations, zero blocking
findings. No requirements were removed. This is candidate traceability, not
merged gitlinks, complete runtime acceptance or staging evidence. The reviewed
contracts snapshot is `d261dd0`; supporting notes use the new lowercase filenames.

## Product sharing pagination — 2026-08-31

The owner sharing form now loads its own explicit-cloud Product pages instead of
reusing the overview's first page. Each page is validated by the existing scoped
Product client. Selection stays in the form across pages; selected IDs can be
reviewed and removed even when absent from the current page. The request body
still contains only the exact sorted selected IDs, not all Products in a page.
Whole-cloud sharing remains a separate explicit confirmation.

Unmount/focus/page changes abort stale requests; fresh reads recheck scope.
Foreign-scope/malformed responses clear choices, keep the user's unsaved selection
for retry, and never broaden it. Authorization denial removes the cloud page.
Every save is still independently authorized by the backend. Removed the unused
overview Product state and its duplicate unpaginated request. The page initially
issues one Product-list read; the picker loads separately only when opened.

Validation: all Admin Go packages and vet PASS; 131 frontend unit tests and build
PASS. Product/device browser regressions pass on desktop and emulated Pixel 7
(six cases). The final sharing case `UI-CA-SHARING-102` additionally passes on both
targets after strengthening exact-ID, cross-page removal and duplicate-read
assertions. Final artifact directory: `/tmp/rtk-sharing-pagination-final/`.
Earlier Product/device reports: `/tmp/rtk-sharing-pagination-desktop-final/` and
`/tmp/rtk-sharing-pagination-mobile/`. These are dirty local-source evidence after
`2c10714`, not accepted CI SHA reports. The final two-target report's target label
defaults to desktop; the raw Playwright project records identify mobile correctly.
Do not use that metadata as hosted per-target qualification.

Reproduce with `SCOPED_PRODUCT_UI_FIXTURE=1 go test ./internal/app -run
'^TestScopedProductBrowserFixture$' -count=1 -v -timeout 30m`, then run the scoped
Product/device/sharing specs with `E2E_BASE_URL=http://127.0.0.1:18197`, one worker
and each browser target in sequence. The fixture uses temporary SQLite and fake
upstreams; reset/revoke/invalid-products affect only in-memory test data. No real
invitation email, shared database, deployed service or payment was changed.

The in-app browser also confirmed page-two selection retention; final desktop
and mobile picker screenshots were inspected. Producer/Billing integration,
remaining scoped resource flows, CI wiring/acceptance and staging remain open.

### Committed-source browser revalidation — 2026-09-01

Re-ran all three scoped Product/device/sharing cases sequentially for each target
against clean service commit `a0d7a2e`: desktop **3 PASS**, Pixel 7 **3 PASS**.
Reports at `/tmp/rtk-sharing-pagination-a0d7a2e-desktop/` and
`/tmp/rtk-sharing-pagination-a0d7a2e-mobile/` now have distinct run IDs, correct
target labels and the tested service commit. These supersede the mixed-target
metadata limitation above. `workspace_commit` explicitly says
`not-applicable-service-checkout`: no merged workspace gitlink is asserted.
The disposable fixture and the in-app inspection tab were stopped/closed.

### Automatically isolated Product UI fixture — 2026-09-01

Product, device and sharing Playwright cases now start their own worker-scoped
Go BFF fixture instead of skipping when a manual opt-in flag is absent. Each
worker compiles the test harness into an owned temporary directory, uses an
OS-assigned loopback port and temporary SQLite store, then terminates the direct
test process gracefully so Go cleanup runs. The ordinary server and staging
sessions are not used for these cases; no production route was added.

A flag-free two-worker run executed all three cases on desktop and Pixel 7:
6 PASS in 50.6s. Raw per-project screenshots were inspected. This preliminary
combined report groups targets; use separate committed-source target reports
for subsequent qualification. Frontend unit tests: 131 PASS; scoped Go tests,
race (6.319s), vet and full Go/web builds pass. Full workspace UI qualification,
Linux CI and staging remain open, as do the previously listed service gaps.
