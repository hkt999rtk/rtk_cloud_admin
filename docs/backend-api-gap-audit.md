# Backend API Gap Audit

Date: 2026-05-09

Source documents:

- `docs/SPEC.md`
- `docs/ROLES.md`
- `docs/admin-dashboard-redesign.md`

Scope: backend API contracts needed by customer dashboard, platform dashboard,
membership, quota, and device detail flows. WebUI-only entry points and visual
design are called out separately.

## Status Legend

- `implemented`: API exists and has the fields/guards required for v0.1.
- `partially implemented`: API exists but needs contract or authorization work.
- `missing`: backend API does not exist.
- `deferred / out of scope`: explicitly not part of this backend API batch.

## Route Inventory

| Area | Endpoint | Current status | Notes |
| --- | --- | --- | --- |
| Current user | `GET /api/me` | implemented | Stable response shape includes `user_id`, `email`, `name`, `kind`, `memberships`, `active_org_id`, `demo_mode`, and `authenticated`. Demo and platform sessions return `memberships` as an array. |
| Current user | `POST /api/me/active-org` | implemented | Customer sessions can only switch to organizations in their membership set. Demo mode now uses the same membership guard. |
| Quota | `POST /api/orgs/{orgId}/quota-raise-requests` | implemented | Requires customer session, targets only the active org, and maps upstream failures to stable gateway responses. |
| Customer dashboard | `GET /api/summary` | implemented | Demo/cache mode and Account Manager customer mode are supported. |
| Customer dashboard | `GET /api/customers` | implemented | Returns active customer organization summary for customer sessions; public demo fallback remains available without a customer session. |
| Customer dashboard | `GET /api/devices` | implemented | Returns device organization, readiness, firmware version, source facts, health, and signal quality fields. Customer sessions are org-scoped. |
| Device detail | `GET /api/devices/{id}` | implemented | Includes identity, readiness, firmware version, health, signal quality, timestamps, and readiness source facts. Customer sessions cannot read out-of-org devices. |
| Device telemetry | `GET /api/devices/{id}/telemetry` | implemented | Supports demo and Video Cloud proxy mode. |
| Fleet health | `GET /api/fleet/health-summary` | implemented | Covers dashboard health overview and trend needs from the redesign spec. |
| Fleet stream | `GET /api/fleet/stream-stats` | implemented | Covers stream health summary and worst-device read model. |
| Firmware | `GET /api/fleet/firmware-distribution` | implemented | Covers firmware distribution and rollout status summary. |
| Platform dashboard | `GET /api/admin/summary` | implemented | Platform-admin protected. Returns cross-tenant customer/device/operation summary. |
| Platform dashboard | `GET /api/admin/customers` | implemented | Platform-admin protected. Returns organization id/name, totals, readiness buckets, and last seen. |
| Platform dashboard | `GET /api/admin/devices` | implemented | Platform-admin protected. Returns all device read models with organization, readiness, firmware, health, signal quality, and source facts. |
| Platform operations | `GET /api/admin/operations` | implemented | Platform-admin protected. |
| Platform audit | `GET /api/admin/audit` | implemented | Platform-admin protected. |
| Service health | `GET /api/admin/service-health` | implemented | Platform-admin protected cross-service health. |

## v0.1 Backend API Items

### Membership and Quota Contract

Status: implemented.

The backend now stabilizes `/api/me` for unauthenticated demo users, customer
sessions, and platform-admin sessions. Membership objects contain:

- `organization_id`
- `organization`
- `role`
- `tier`
- `evaluation_device_quota`

`POST /api/me/active-org` rejects organizations outside the current membership
set in both Account Manager proxy mode and local demo mode.

Quota raise requests are scoped to the active organization and return stable
errors for non-active organizations and Account Manager failures.

### Platform Admin Read Models

Status: implemented.

The platform admin dashboard can read:

- `GET /api/admin/summary`
- `GET /api/admin/customers`
- `GET /api/admin/devices`

These endpoints are guarded by `platform_admin` sessions. Customer sessions are
rejected and unauthenticated requests return `401`.

The device read model is additive and includes customer organization, readiness,
firmware version, source facts, health, signal quality, last seen, and updated
timestamps.

### Device Detail Contract

Status: implemented.

`GET /api/devices/{id}` includes:

- device identity: `id`, `name`, `serial_number`, `model`, `organization_id`,
  `organization`
- readiness state
- firmware version
- health and signal quality
- `last_seen_at` and `updated_at`
- source facts with `layer`, `state`, `detail`, `retryable`, `error_code`,
  `operation_id`, and `updated_at` where available

The contract is additive and does not remove existing fields. Customer sessions
are scoped to the active organization.

## Frontend-Only Gaps

These items are not backend API gaps:

- Missing navigation or UI affordances for already implemented endpoints.
- WebUI redesign, Figma files, mockups, and visual layout work.
- Any table column that can be rendered from existing backend DTO fields.

## Deferred / Out of Scope

These are intentionally not part of the v0.1 backend API batch:

- Role assignment UI and write APIs.
- Read-only Observer role model.
- Tenant impersonation.
- Device groups API.
- WebUI redesign or design artifacts.
- Tenant write actions from platform admin endpoints.
