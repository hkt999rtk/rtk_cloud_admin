# Multi-cloud implementation checkpoint — 2026-08-31

This is an implementation checkpoint, **not release acceptance**. The reviewed
`MULTICLOUD_WEBUI.md` remains the target. No runtime PR, deployment, shared database
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
