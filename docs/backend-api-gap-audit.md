# Backend API Gap Audit

Date: 2026-05-09

Source documents:

- `docs/SPEC.md`
- `docs/ROLES.md`
- `docs/admin-dashboard-redesign.md`

Scope: backend API contracts needed by customer dashboard, platform dashboard,
membership, quota, and device detail flows. WebUI-only entry points and visual
design are called out separately.

This document distinguishes Admin Console work from upstream blockers. Items
listed as implemented in `rtk_cloud_admin` can still depend on production data
from Account Manager or Video Cloud before server validation is complete.

## Status Legend

- `implemented`: API exists and has the fields/guards required for v0.1.
- `partially implemented`: API exists but needs contract or authorization work.
- `api shape implemented / production source pending`: BFF route and DTO shape
  exist, but production validation still depends on authoritative upstream data
  rather than demo-derived or locally inferred values.
- `missing`: backend API does not exist.
- `deferred / out of scope`: explicitly not part of this backend API batch.

## Route Inventory

| Area | Endpoint | Current status | Notes |
| --- | --- | --- | --- |
| Current user | `GET /api/me` | implemented | Stable response shape includes `user_id`, `email`, `name`, `kind`, `memberships`, `active_org_id`, `demo_mode`, and `authenticated`. Production validation uses authenticated customer or platform sessions. |
| Current user | `POST /api/me/active-org` | implemented | Customer sessions can only switch to organizations in their membership set. |
| Quota | `POST /api/orgs/{orgId}/quota-raise-requests` | implemented | Requires customer session, targets only the active org, and maps upstream failures to stable gateway responses. |
| Customer dashboard | `GET /api/summary` | partially implemented | Customer sessions are org-scoped, but production validation should not rely on unauthenticated demo/cache fallback. |
| Customer dashboard | `GET /api/customers` | partially implemented | Returns active customer organization summary for customer sessions; production validation should not rely on public demo fallback. |
| Customer dashboard | `GET /api/devices` | implemented | Customer sessions return org-scoped customer-safe DTOs without `video_cloud_devid`, operation IDs, raw upstream payloads, or platform-only lifecycle states. |
| Device detail | `GET /api/devices/{id}` | implemented | Customer sessions return customer-safe identity, readiness, firmware, health, signal, timestamps, and source facts. Platform Admin routes keep the full internal projection where allowed. |
| Device telemetry | `GET /api/devices/{id}/telemetry` | api shape implemented / production source pending | DTO shape exists and Video Cloud proxy mode exists. Production validation requires authoritative per-device telemetry; demo telemetry fallback is not acceptable for server testing. |
| Fleet health | `GET /api/fleet/health-summary` | api shape implemented / production source pending | BFF route exists, but production validation requires `device.health.summary` aggregation or equivalent authoritative telemetry read model, not readiness-derived trend data. |
| Fleet stream | `GET /api/fleet/stream-stats` | api shape implemented / production source pending | BFF route exists, but production validation requires WebRTC session event data from Video Cloud or an equivalent normalized read model, not local estimates. |
| Firmware | `GET /api/fleet/firmware-distribution` | api shape implemented / production source pending | BFF route exists and proxies firmware endpoints when configured. Production validation requires observed firmware and rollout facts; generated fallback versions are not acceptable. |
| Platform dashboard | `GET /api/admin/summary` | implemented | Platform-admin protected. Returns cross-tenant customer/device/operation summary. |
| Platform dashboard | `GET /api/admin/platform-dashboard` | implemented | Platform-admin protected BFF boundary for existing summary data, operation risk, KPI strip, grouped scrape health, and allowlisted server-side Prometheus queries. Returns stable source states instead of leaking raw upstream errors. |
| Platform dashboard | `GET /api/admin/customers` | implemented | Platform-admin protected. Returns organization id/name, totals, readiness buckets, and last seen. |
| Platform dashboard | `GET /api/admin/devices` | implemented | Platform-admin protected. Returns all device read models with organization, readiness, firmware, health, signal quality, and source facts. |
| Platform operations | `GET /api/admin/operations` | implemented | Platform-admin protected. |
| Platform audit | `GET /api/admin/audit` | implemented | Platform-admin protected. |
| Service health | `GET /api/admin/service-health` | implemented | Platform-admin protected cross-service health. |

## v0.1 Backend API Items

### Membership and Quota Contract

Status: implemented.

The backend stabilizes `/api/me` for customer sessions and platform-admin
sessions. Membership objects contain:

- `organization_id`
- `organization`
- `role`
- `tier`
- `evaluation_device_quota`

`POST /api/me/active-org` rejects organizations outside the current membership
set.

Quota raise requests are scoped to the active organization and return stable
errors for non-active organizations and Account Manager failures.

### Platform Admin Read Models

Status: implemented.

The platform admin dashboard can read:

- `GET /api/admin/summary`
- `GET /api/admin/platform-dashboard`
- `GET /api/admin/customers`
- `GET /api/admin/devices`

These endpoints are guarded by `platform_admin` sessions. Customer sessions are
rejected and unauthenticated requests return `401`.

`GET /api/admin/platform-dashboard` is the server-side Prometheus boundary for
Platform Dashboard. It uses `VIDEO_CLOUD_PROMETHEUS_BASE_URL` from the BFF,
runs only repo-owned allowlisted query definitions, and returns source states
`configured`, `unconfigured`, `unavailable`, `empty`, or `stale`. The payload
also composes deterministic KPI, service/scrape health, and operation-risk
sections from Admin BFF read models plus those Prometheus results.

The device read model is additive and includes customer organization, readiness,
firmware version, source facts, health, signal quality, last seen, and updated
timestamps.

### Customer-Safe DTO Contract

Status: implemented for customer device and device-detail routes.

Customer View API payloads must be safe by construction, not merely hidden by
React components. For any customer-session route, the response must omit:

- `video_cloud_devid`
- `operation_id`
- `upstream_operation_id`
- raw upstream error payloads
- `dead_lettered` and other platform-only lifecycle states

Platform Admin routes may keep these fields where allowed by
`docs/ROLES.md`.

### Device Detail Contract

Status: implemented.

`GET /api/devices/{id}` includes:

- device identity: `id`, `name`, `serial_number`, `model`, `organization_id`,
  `organization`
- readiness state
- firmware version
- health and signal quality
- `last_seen_at` and `updated_at`
- customer-safe source facts with `layer`, `state`, `detail`, `retryable`,
  `error_code`, and `updated_at` where available

Customer sessions are scoped to the active organization. Customer View payloads
must not include platform-only identifiers; Platform Admin payloads may keep the
full internal projection.

### Production Data Source Requirements

Status: production source pending.

The Customer View WebUI is intended to be validated against real upstream
servers. The following production sources are required before the redesigned
pages can be treated as complete:

- Fleet Health Overview: normalized `device.health.summary` aggregation per
  organization and time window.
- Devices drawer telemetry: authoritative per-device telemetry including
  health, signals, RSSI 7d, uptime 7d, recent events, firmware version, and
  explicit active stream status.
- Firmware & OTA: observed firmware versions and rollout/campaign facts from
  Video Cloud or the normalized telemetry read model.
- Stream Health: WebRTC session event aggregation with success/failure,
  duration, active-session, never-streamed, and per-device worst-device facts.

Local demo, deterministic sample generation, or readiness-derived trends may
remain useful for development, but they are not acceptable evidence for server
validation.

### Admin Repo Follow-Up Work

Status: completed for the first WebUI implementation batch tracked in
[webui-implementation-roadmap.md](webui-implementation-roadmap.md).

These items can be implemented in `rtk_cloud_admin` without making this repo the
source of truth for upstream facts. The completed milestone sequence covered:

1. WebUI foundation cleanup and route guards.
2. Customer View source-aware page states.
3. Fleet Health Overview completion.
4. Devices table and detail drawer completion.
5. Firmware & OTA read-only workflows.
6. Stream Health read-only workflows.
7. Public auth, signup, verification, and quota UX polish.
8. Platform View polish.
9. Final WebUI browser QA and documentation signoff.

Production telemetry, firmware rollout, and stream-session facts remain
upstream blockers. Admin Console must show blocked/unavailable states when
those sources are absent; it must not replace those sources with demo-derived
production data.

### Read-only Observer Enforcement

Status: implemented for current provision/deactivate handlers.

Read-only Observer must be a distinct customer role before production use.
Backend write handlers must reject read-only sessions for provision,
deactivate, and any future tenant write action. Frontend button hiding is not a
security boundary.

## Frontend-Only Gaps

These items are not backend API gaps:

- Missing navigation or UI affordances for already implemented endpoints.
- WebUI redesign, Figma files, mockups, and visual layout work.
- Any table column that can be rendered from existing backend DTO fields.

## Deferred / Out of Scope

These are intentionally not part of the v0.1 backend API batch:

- Role assignment UI and write APIs.
- Tenant impersonation.
- Device groups API.
- WebUI redesign or design artifacts.
- Tenant write actions from platform admin endpoints.
