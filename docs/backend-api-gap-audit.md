# Backend API Gap Audit

Date: 2026-07-13

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

## 2026-07-13 Design-to-Implementation Reconciliation

The current Platform View and Brand Clouds backend baseline exists and supports
the current React pages. It does not yet support every field and workflow in
the approved dashboard/Brand Clouds design assets. The detailed execution plan
is [platform-admin-implementation-plan.md](platform-admin-implementation-plan.md).

Current gaps that are backend or upstream-contract work, rather than merely
visual work:

- Brand Cloud list filtering is performed in Cloud Admin after a full upstream
  list fetch; Account Manager needs bounded server-side pagination and filters.
- Brand Cloud list/detail DTOs do not consistently expose SSO status, region,
  created-at, brand code, entitlement usage, and freshness as one stable read
  model.
- Brand Cloud detail now performs fresh reads through the existing organization
  and SSO routes; a composed overview endpoint is not required for the first
  management release.
- Service Logs, Operations, and Audit need bounded filter/pagination contracts;
  full cross-service audit history still requires an authoritative upstream
  source or ingestion contract.
- Platform Dashboard now uses source-state/freshness data and existing
  management-page links; environment/cluster context and deep resource detail
  remain deferred display work.

Priority adjustment: authoritative health, operation risk, Brand Cloud
identity/status/owner/SSO, member assignment, enable/disable, safe source
states, and local management audit records are implemented or first-release
blockers. Region, brand code, created-at, historical quota/device analytics,
rich Service Logs queries, deep resource detail, and full audit export remain
design follow-ups, not urgent API work.

## Status Legend

- `implemented`: API exists and has the fields/guards required for v0.1.
- `partially implemented`: API exists but needs contract or authorization work.
- `implemented / live evidence pending`: BFF route, DTO shape, upstream proxy
  behavior, unavailable states, and route tests exist; production validation
  still requires live Account Manager or Video Cloud evidence.
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
| Device telemetry | `GET /api/devices/{id}/telemetry` | implemented / live evidence pending | DTO shape, Video Cloud proxy mode, customer-safe redaction, unauthorized/unavailable handling, and route tests exist. Production sign-off still requires authoritative per-device telemetry from a live Video Cloud environment. |
| Fleet health | `GET /api/fleet/health-summary` | implemented / live evidence pending | BFF route and unavailable states exist. Production sign-off requires live `device.health.summary` aggregation or equivalent authoritative telemetry read model evidence, not demo data. |
| Fleet stream | `GET /api/fleet/stream-stats` | implemented / live evidence pending | BFF route proxies Video Cloud WebRTC session stats and handles upstream failures. Production sign-off requires live WebRTC session event aggregation evidence. |
| Firmware | `GET /api/fleet/firmware-distribution` | implemented / live evidence pending | BFF route proxies firmware endpoints when configured and avoids treating generated fallback versions as production evidence. Production sign-off requires observed firmware and rollout facts. |
| SKU and services | `GET /api/skus`, `GET /api/skus/{id}` | implemented / live evidence pending | Account Manager exposes brand-scoped profile reads and Cloud Admin returns customer-safe SKU/service DTOs with device counts plus per-SKU region and firmware distributions. Impact previews and production-run counts remain separate policy data. |
| Effective SKU ACL | `GET /api/skus/{id}/permissions`, `/api/role-assignments` | implemented / live evidence pending | Account Manager supports organization, SKU, region, group, and device assignment scopes; fleet list, summary, and device routes enforce the effective resource scope; Cloud Admin exposes customer-safe role/assignment views. Production validation still needs live evidence. |
| Fleet summary | `GET /api/fleet/summary` | implemented / live evidence pending | Account Manager aggregates status, SKU, model, firmware, region, enabled services, and per-SKU region/firmware distributions in the database. Group/job/authoritative health dimensions remain separate indexed sources. |
| Platform dashboard | `GET /api/admin/summary` | implemented | Platform-admin protected. Returns cross-tenant customer/device/operation summary. |
| Platform dashboard | `GET /api/admin/platform-dashboard` | implemented | Platform-admin protected BFF boundary for summary data, operation risk, KPI strip, grouped scrape health, k8s service metrics, workload health, cluster node snapshots, and allowlisted server-side Prometheus queries. Returns stable source states instead of leaking raw upstream errors. |
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
also composes deterministic KPI, service/scrape health, k8s service metrics,
workload health, cluster node snapshots, and operation-risk sections from Admin
BFF read models plus those Prometheus results. Long-term trend analysis is left
to Grafana rather than the Admin WebUI.

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

Status: implemented locally; live source evidence pending.

The Customer View WebUI is intended to be validated against real upstream
servers. The following production sources are required before live deployment
sign-off, but their absence is no longer a backend API implementation gap:

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
remain useful for development, but they are not acceptable evidence for live
server validation. When upstreams are absent, Admin Console must expose stable
not-configured, unauthorized, unavailable, empty, or stale states rather than
silently falling back to demo-derived production data.

### Admin Repo Follow-Up Work

Status: completed for the first WebUI implementation batch tracked in
[webui-implementation-roadmap.md](webui-implementation-roadmap.md).

These items can be implemented in `rtk_cloud_admin` without making this repo the
source of truth for upstream facts. The completed milestone sequence covered:

1. WebUI foundation cleanup and route guards.
2. Customer View source-aware page states.
3. Fleet Health Overview completion.
4. Devices table and detail drawer completion.
5. Firmware & OTA release and update-plan workflows.
6. Stream Health operational workflows.
7. Public auth, signup, verification, and quota UX polish.
8. Platform View polish.
9. Final WebUI browser QA and documentation signoff.

Production telemetry, firmware rollout, and stream-session facts remain live
evidence requirements. Admin Console shows blocked/unavailable states when
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

## Brand Fleet 100K+ Follow-up Audit

Status: required for the Brand Fleet redesign; existing v0.1 routes are not
treated as sufficient just because they can render a small demo fleet.

The Brand Fleet UI must use server-side queries and asynchronous jobs for
100K+ devices. The following interface areas need explicit BFF contracts or
upstream confirmation before formal React implementation:

| Area | Required behavior | Current assessment |
| --- | --- | --- |
| Device inventory | Paginated, searchable, sortable, multi-filter query scoped to the active brand organization | Implemented through Account Manager `/fleet/devices` and Cloud Admin `/api/fleet/devices`; maximum page size is 250 and filters are server-side |
| Cross-page selection | Select a filtered result set without loading every device into the browser | Implemented as an immutable job scope containing the filter query plus exclusions, or explicit device IDs |
| Groups and tags | List, create, update, member counts, and use as batch/OTA scope | Account Manager primitives and Cloud Admin group create/update/delete/read UI now exist; tags are listed and applied through asynchronous batch jobs. Per-group aggregate indexes and a dedicated tag editor remain follow-up work |
| Products and profiles | SKU/device profile, enabled services, policy summaries, and production-run counts | Brand-scoped SKU list/detail BFF and UI now include per-SKU region/firmware summaries, production-run counts, scoped ACL data, and an affected-device policy impact preview |
| Batch jobs | Create, progress, partial failure, retry, result download, and audit | Cloud Admin job store and customer-safe routes implemented; provision/deactivate/settings/group/tag jobs execute asynchronously, with JSON and CSV result downloads. Firmware retry still belongs to the OTA plan lifecycle |
| OTA plans | Create, schedule, start, pause, resume, cancel, retry, and summary reporting | Cloud Admin update-plan aliases now enforce active-organization authorization and proxy the SKU-scoped Video Cloud lifecycle; retry resumes paused/completed campaigns as a new deployment attempt |
| Fleet summaries | Aggregate by region, product, group, firmware, health, and job state | Summary respects ACL scope and now includes status, SKU, model, firmware, region metadata, enabled services, and per-SKU region/firmware dimensions. Group/job/authoritative health data still need indexed source fields |
| Reports | Filtered report generation and asynchronous export | Customer-safe asynchronous report jobs now apply fleet query filters and return dimension rows with durable job results plus JSON/CSV download; object-storage delivery and richer report templates remain follow-up work |

### SKU → Service → ACL → Policy Contract

The Brand Fleet UI must model this relationship explicitly:

```
SKU
  → product/device specification
  → enabled service capabilities
  → user ACL and scope
  → device policy
  → firmware policy and OTA plans
```

Account Manager is the source of truth for SKU profiles, device-to-SKU
membership, service capability policy, and human authorization. Video Cloud is
the source of truth for SKU-scoped firmware releases, campaigns, deployments,
and rollout events. Cloud Admin must expose a customer-safe effective DTO and
must not let React infer the relationship from `model`, raw
`service_options`, or runtime token scopes.

Required BFF data for the SKU page:

- SKU identity and product/device specification.
- Enabled service labels and machine-readable capability flags.
- Device count, region distribution, and firmware distribution.
- Device and firmware policy summaries.
- Current-user allowed actions for the SKU and its device scopes.
- Impact preview before changing a policy or service capability.

Implementation rule: do not work around these gaps by fetching the entire fleet
into React. Each gap must either be backed by an existing indexed upstream
query or be recorded as a separate contract/API implementation item.

Provisioning boundary: device registration and claim/bind are owned by the
approved provisioning flow. The Brand Fleet Dashboard is read-only for this
area: it can show setup status, latest result, retryability, and the next
provisioning instruction, but it must not create a parallel registration form.
