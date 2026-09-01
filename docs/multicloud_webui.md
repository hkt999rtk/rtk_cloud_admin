# My Clouds and Product-scoped console design

Status: design-first target. Canonical [multicloud_ownership.md](https://github.com/hkt999rtk/rtk_cloud_contracts_doc/blob/codex/multicloud-owner-design/multicloud_ownership.md) governs ownership,
sharing, deletion and Billing handoff. This document does not claim implementation.

## Navigation and session

One global account session serves developer and Platform views. Honor a safe,
authorized login next first; otherwise memberships lead to /console/clouds,
platform-only capability to Platform View, and neither to a clear no-access page.
No additional login or per-cloud identity is introduced.
For an eligible developer with no memberships, the no-access state explains the
absence of cloud access and links to My Clouds/create; it is not an account lockout.
My Clouds may show an empty list and quota without requiring existing ownership.
Viewer-only developers and owners deleting their last cloud can create a new
owned cloud. The backend rechecks account eligibility and quota on submission.

| Page | Content and authority |
| --- | --- |
| /console/clouds | All / Owned / Shared tabs, cloud name, owner, my role, status, owned quota, pagination; Create for eligible accounts |
| /console/clouds/{cloudId} | Cloud overview, Products, members/access, owner-only Billing, settings and audit |
| /console/clouds/{cloudId}/products/{productId} | Product overview, Devices, Firmware, OTA and service settings under the same cloud |

Cloud lifecycle is not hidden inside the Platform Admin console. The My Clouds
page owns create/edit/share/transfer/delete entry points for ordinary developers.
Backend capabilities control buttons; UI role labels are not authorization.
Show filtered total separately from owned quota (shared clouds do not count).

Every cloud-scoped BFF request binds explicit cloud ID from route/request and verifies it
against current Account Manager membership, lifecycle and capabilities. Product
ID must belong to that cloud. Do not let a session-global active cloud override
a tab's request. Two tabs may operate two clouds. Cancel outstanding requests on
navigation, reject stale responses and partition caches by cloud/authorization
version. Server-held jobs and downloads keep immutable scope and revalidate
authority. Old routes redirect only when scope is unambiguous and authorized;
never replay a mutation against a newly selected cloud.
Global login, account/session, My Clouds list/create and platform APIs do not
require a selected cloud. They validate their global account/platform authority;
creating a cloud assigns the caller its initial ownership atomically.

## CRUD and collaboration

Create: name and optional description; show owned count/limit; generate one
idempotency key per deliberate submission and reuse it on retry. The creator
becomes sole owner. Edit changes name/description, not cloud UUID/tenant slug.

Share: target verified developer email, role and scope. Default viewer with
selected Products; require at least one accessible same-cloud Product. An empty
cloud can be shared by explicitly selecting whole-cloud viewer. Whole-cloud text
states that future Products are included. Viewer does not include Billing,
secrets, payment methods or playback. Existing admin/member grants remain visible
without being mislabeled read-only. Show pending invites with resend/cancel and
30-minute expiry; recipient must explicitly accept in the matching global session.
Replay requires the same target, role and complete normalized scope. If an existing
pending invite has a different Product set or scope kind, show a conflict with its
unchanged scope and offer cancel then create; never report the requested narrowing
as applied. Resend preserves scope. Test reordered equivalent IDs, changed-scope
conflicts and cancel/recreate with old-token rejection and new-scope-only access.

Members: owner alone manages cloud admission and approved Product scope. Product
membership readback uses `GET /api/developer/brand-clouds/{cloudId}/members`,
proxying the owner-authorized member collection and its current persisted scopes.
Reload after PATCH and acceptance; do not reconstruct grants from old invitations.
Product
collaboration cannot auto-enroll external users or re-enable disabled membership.
Removing access invalidates downstream grants; rejoin requires new grants. Show
an explanatory access-revoked state if the current tab loses authorization.

Delete: fetch deletion-preflight; render resource, running-work, balance,
unsettled-usage/payment/refund/dispute and unavailable-service blockers separately.
Only an empty, zero-balance settled cloud is eligible. Explicit confirmation
submits DELETE with an idempotency key; server rechecks and returns 202/operation.
Show durable progress, retryable failure and completion, never optimistic success.
Historical records are retained; no nonempty-cloud cascade-delete option exists.

## Ownership and Billing

Only the cloud owner sees tenant Billing. Platform access remains a separate
audited view and cannot use arbitrary actor/permission headers from the browser.
An owner of another cloud receives no Billing visibility here.
The scoped Billing page is `/console/clouds/{cloudId}/billing`, with usage,
invoices, activity, settings and profile subpages. Its existing resource BFFs move
from `/api/billing/*` to `/api/developer/brand-clouds/{cloudId}/billing/*`;
unscoped API paths return 404, never infer a target from the active session.
Each request rechecks owner ID, owner role, operation capability and ownership
version against Account Manager. The BFF constructs trusted Billing identity
headers; incoming browser Billing headers are ignored. Writes also supply
`X-Cloud-Ownership-Version` from the displayed snapshot as a precondition, not
as authority. The BFF compares it with current evidence and rejects mismatch.
Responses are no-store and carry that version; mixed-version page reads are
discarded. Legacy UI links without proven scope lead to My Clouds selection.
Historical invoices, activity, exports and downloads show only the current
owner's responsibility periods plus the confirmed opening balance. Do not show
predecessor payer identity, invoices or line-item history; mixed-period data is
withheld unless the server provides a safe projection. Old owners have no cloud
history access; separately audited platform history is not a customer-view route.

Transfer UI identifies source and target, eligible/quota state, ownership version,
balance/currency/snapshot version, debt/payment/work blockers and durable progress.
Before request/acceptance, show that the current owner must settle Billing and
leave nonnegative available credit: zero is eligible, negative balance cannot
transfer. Render `balance_negative` with the observed balance, separately
from unsettled invoices/usage and pending financial work; a positive number alone
does not enable transfer. Server eligibility and fenced rechecks remain authoritative.
Both parties explicitly confirm the same amount; changes clear old confirmations.
Email acceptance preserves the token through login and removes it from visible
URL/history after capture. Token possession alone is not acceptance or consent.

Explain before acceptance: positive balance stays with the cloud; old payment
methods/auto-charge consent do not; cost-producing operations may pause during
settlement; old owner loses all cloud/Product/Billing access; Product-owner roles
held by that person move to the new owner. Existing other collaborators remain.

After owner commit, failed finalization shows recovery-in-progress, not a button
to switch ownership back. Precommit cancellation waits for confirmed hold release.
The new owner sets up their payment instrument/consent independently. Old owner's
tab is removed from the cloud only after committed authority changes; other clouds
and the shared global session remain usable.
If final settlement leaves negative credit, explain that transfer is blocked
and the original owner remains responsible. Offer precommit cancellation; only
after confirmed hold release may the original owner settle/top up normally and
start a fresh transfer. Do not offer payment inside a fenced handoff. Test negative,
zero/positive-but-unsettled, eligible-zero/positive and nonnegative-to-negative
race states. Positive-to-zero requires fresh confirmation of the new snapshot.
The delete dialog continues to require zero balance; its rule is intentionally
different from transfer's nonnegative-balance requirement.

## BFF and verification

Extend /api/developer/brand-clouds with POST, PATCH/detail, deletion-preflight,
DELETE, operation status and versioned transfer preview/confirmation. Preserve
existing invitation/acceptance paths and extend viewer access_scope. Whitelist
mutable fields, enforce CSRF/idempotency and never proxy caller-supplied trusted
Billing actor headers. All cloud-scoped existing BFF endpoints gain explicit,
validated scope; ownership management never trusts cached role snapshots alone.

Desktop/mobile E2E covers empty and multi-page cloud lists, owned/shared totals,
creation quota, edit, invited viewer scopes/current/future Products, revoked access,
two-tab concurrent clouds, stale requests, safe next/old URLs, deletion blockers,
balanced transfer confirmation and persistent failure/retry states. Use mocked
provider service only for CI; real staging activation, sharing, device association,
certificate and MQTT evidence remains a separate release gate. No snapshots or
passing tests are claimed by this design-only change.
