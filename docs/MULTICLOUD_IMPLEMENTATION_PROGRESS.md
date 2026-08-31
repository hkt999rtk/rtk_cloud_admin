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
