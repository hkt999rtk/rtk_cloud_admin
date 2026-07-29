---
rtk_spec:
  id: SPEC-CA
  status: normative
  owner: rtk_cloud_admin
---

# RTK Cloud Admin Console Specification

## Summary

RTK Cloud Admin Console is a B2B operations console for RTK Cloud device fleet management and provisioning. It is a tenant-first web application: customer users manage their own organization devices, while platform administrators use a separate local-admin entry point to inspect customers, devices, lifecycle operations, service health, and audit activity across tenants.

The first implementation uses a Go backend/BFF, SQLite, and a React JavaScript frontend. Backend code and runtime services must be Go only. Node.js/npm are allowed only for frontend development and static asset builds; they must not be required by the Go backend at runtime.

## Product Direction

The console follows the contracts in `docs/rtk_cloud_contracts_doc`:

- Account Manager owns customer authentication, organizations, members, registry devices, provisioning/deactivation APIs, platform-admin/root identity, and brand-cloud administration.
- Realtek Video Cloud owns activation, scoped tokens, stream/media routes, firmware routes, and transport ownership.
- Product readiness is an aggregate projection across account registry, claim/bind, local onboarding, cloud activation, and transport online facts.
- Frontend color, typography, status labels, and layout tone follow `docs/rtk_cloud_contracts_doc/FRONTEND_STYLE.md`.
- This repository provides a frontend/BFF surface. It must not redefine the source-of-truth ownership from the contracts.

In short, `rtk_account_manager` is the authoritative backend control plane for
identity, tenant context, authorization, entitlement, device registry, and
provisioning intent. `rtk_cloud_admin` is the enterprise/admin dashboard and
BFF; it may proxy or aggregate upstream facts but must not become the canonical
account, organization, device, quota, or provisioning store.
The same boundary applies to brand clouds: Account Manager owns
`organization_kind=brand_cloud` records, membership, status, and audit. Admin
Console may proxy these APIs and later add WebUI screens, but it must not store
authoritative brand-cloud records in SQLite.

## MVP Scope

Included in v0.1:

- Go HTTP server using `net/http`.
- SQLite persistence for platform admin users, local sessions, integration settings, audit events, UI preferences, and cached customer/device/operation projections.
- JSON API routes for the React frontend.
- React SPA with JavaScript, HTML, and CSS.
- Static serving of the built React assets from the Go backend.
- Local Realtek logo asset under `web/public/assets/realtek-logo.png`, sourced
  from the Realtek Connect+ marketing site and served locally by the app.
- Customer console pages:
  - Brand Fleet Overview for 100K+ devices
  - server-side Devices table with detail drawer and batch actions
  - Groups and Tags
  - SKU and Services, including product/device specifications and policies
  - Firmware Releases and full OTA Update Plans
  - Batch Jobs and Reports
  - async provisioning validation, confirmation, execution, and result views
  - customer-readable health, firmware, and connectivity summaries
- Platform admin pages:
  - Platform Dashboard with cross-tenant summary and curated Prometheus-backed
    operational metrics
  - service health
  - SSO provider status and settings
  - backend/BFF brand-cloud management routes for future Platform View Brand
    Clouds UI consumption
  - lifecycle operations log
  - audit log
- Audit events are recorded when demo lifecycle actions are created from the
  console.
- Local demo mode backed by SQLite seed data so the console is useful before
  real service endpoints are configured. Demo mode is for local development
  only and is not acceptable for production or server validation.

Out of scope for v0.1:

- Replacing Account Manager or Video Cloud as source of truth.
- End-user consumer app dashboard.
- Telemetry ingestion pipeline.
- WebRTC player, clip library, or media download manager.
- Smart-home schedules, scenes, Matter, Alexa, or Google Assistant runtime features.
- Platform-wide cross-tenant fleet control from a brand session.

## Self-Service Signup Ownership

`rtk_cloud_admin` is the owner of the self-service signup user interface for
the public evaluation tier defined in `rtk_cloud_workspace/docs/business-model.md`.
The marketing site (`rtk_cloud_frontend`) links into this repo for signup; it
does not implement signup itself.

The signup flow is split between this repo and `rtk_account_manager`:

- This repo (`rtk_cloud_admin`) owns: signup React page, email-verification
  landing page, "check your email" interstitial, login page wiring for the
  newly verified account, and any tier/quota indicator on the customer
  dashboard. Signup goes through new endpoints on `rtk_account_manager` rather
  than this console's local SQLite.
- `rtk_account_manager` owns: signup API, password storage, email verification
  token issuance and consumption, account-level evaluation device quota field
  (default 5, ceiling 200 — see business-model.md), and the quota-raise
  request workflow.

This split mirrors the existing customer login flow which already proxies to
Account Manager when configured. Local SQLite stays authoritative only for
platform-admin users, sessions, audit, settings, and demo data — it does not
become authoritative for self-service customer accounts.

Self-service signup UI is implemented in this repo; track the remaining
quota, verification, and cross-repo integration work through the issues opened
against this repo and `rtk_account_manager` once the doc baseline is approved.

The production deployment profile for the admin dashboard is documented in
[`docs/private-cloud-deployment.md`](private-cloud-deployment.md).

## Architecture

Runtime components:

- `cmd/server`: process entry point, configuration, server startup, graceful shutdown.
- `internal/app`: application wiring, route registration, JSON API handlers, static frontend serving, health endpoint.
- `internal/app/store_ports.go`: narrow local-store interfaces for sessions,
  audit events, projection reads, and lifecycle operations.
- `internal/store`: SQLite schema, repository methods, seed data, migrations,
  and the current implementation of the app-local store interfaces.
- `internal/contracts`: Go vocabulary for readiness states, operation states, roles, and DTOs used by the UI.
- `web`: React frontend source, built with Vite and served as static files by the Go backend.
- `web/dist`: generated frontend build output, not manually edited.

Data ownership:

- SQLite is authoritative only for console-local data: sessions, audit,
  settings, preferences, and demo projections.
- SQLite cache tables for upstream organizations, devices, operations, and readiness facts are non-authoritative mirrors that can be refreshed from Account Manager and Video Cloud.
- Application handlers depend on narrow local-store interfaces where practical;
  this is a boundary for future cache/session backends, not a change in source
  of truth.
- Account Manager remains authoritative for customer users, organizations, membership, and registry devices.
- Account Manager is also the planned identity broker and authorization source
  for standards-based SSO; see
  [`docs/sso-oidc-design.md`](sso-oidc-design.md).
- Video Cloud remains authoritative for activation, transport, streaming, media, firmware, and device runtime facts.

Future Redis-compatible session or projection cache support must start by
extracting narrow ports from the current SQLite `internal/store.Store`. SQLite
remains authoritative only for console-local data such as sessions, audit,
settings, preferences, and demo data. Upstream
organization, device, operation, readiness, firmware, telemetry, and stream
facts remain non-authoritative projections or proxy results from Account Manager
and Video Cloud. The cross-repository roadmap is maintained in
`../../docs/persistence-cache-refactor-roadmap.md`.

## HTTP Interface

The machine-readable BFF API contract is maintained in
[`docs/openapi.yaml`](openapi.yaml). Keep that file in sync when adding,
renaming, or changing JSON API routes registered by `internal/app`.

Public and shared routes:

- `GET /healthz`: plain health check.
- `POST /api/auth/customer/login`: customer password login through Account
  Manager when configured. The resolved Account Manager profile must include at
  least one customer organization; platform-admin-only accounts must not create
  Customer View sessions.
- `POST /api/auth/platform/login`: Account Manager-backed platform-admin
  password login for the migration period; the returned upstream token must
  pass a platform-admin authorization check before a local session is created.
- `POST /api/auth/logout`: deletes local session metadata.
- `GET /api/me`: current user, memberships, active organization, and demo/auth state.
- `POST /api/me/active-org`: switches active organization for the current session.
- `GET /api/summary`: customer and platform dashboard summary.
- `GET /api/admin/platform-dashboard`: platform-admin protected Platform
  Dashboard BFF contract with server-side allowlisted Prometheus queries for
  service metrics, k8s workload health, cluster node snapshots, scrape health,
  and operation risk.
- `GET /api/admin/platform-resource-trends`: deprecated compatibility route for
  older Resource Trends clients. The WebUI no longer links to or calls this
  endpoint; long-term metrics and trend analysis belong in Grafana.
- `GET /api/admin/grafana/status`: platform-admin protected Grafana embed
  status. Returns whether Grafana is configured and the same-origin iframe URL
  for the provisioned LKE staging dashboard.
- `GET /api/admin/grafana/*`: platform-admin protected reverse proxy to the
  private Grafana Service. The BFF strips inbound `X-WEBAUTH-*` headers and
  injects trusted Grafana auth-proxy identity headers before forwarding.
- `GET /api/devices`: device list from cache/demo or upstream aggregation.
- `GET /api/devices/{id}`: device detail.
- `GET /api/skus`: SKU list with enabled services, policies, counts, and
  current-user allowed actions.
- `GET /api/skus/{id}`: SKU detail and affected device/firmware summaries.
- `GET /api/fleet/summary`: server-side fleet, SKU, service, region, firmware,
  and batch-job aggregates.
- `POST /api/devices/{id}/provision`: starts or simulates provisioning.
- `POST /api/devices/{id}/deactivate`: starts or simulates deactivation.

SKU service capabilities and human ACL are separate. Account Manager owns SKU
profiles, device-to-SKU membership, service capability policy, and product
authorization facts. Video Cloud owns firmware releases, OTA campaigns, and
deployment results. Cloud Admin presents the effective result and must not
infer service entitlement or user permissions from model names or runtime
token scopes.
- `GET /api/operations`: lifecycle operation list.
- `GET /api/service-health`: configured upstream service health.
- `GET /api/audit`: audit log.
- `GET /api/admin/audit`: platform-admin protected audit log.
- `GET /api/admin/brand-clouds`: Account Manager-backed brand cloud list.
- `POST /api/admin/brand-clouds`: Account Manager-backed brand cloud create.
- `GET /api/admin/brand-clouds/{id}`: Account Manager-backed brand cloud read.
- `PATCH /api/admin/brand-clouds/{id}`: Account Manager-backed brand cloud update.
- `POST /api/admin/brand-clouds/{id}/members`: Account Manager-backed brand cloud member assignment.
- `GET /assets/...`: built frontend assets.
- `GET /*`: React SPA fallback.

The v0.1 implementation may run without configured upstream services for local
development only. Production/server validation must use configured upstream
services and authenticated customer sessions; SQLite seed data, generated
sample values, and demo-derived trends are not acceptable validation sources.
When `ACCOUNT_MANAGER_BASE_URL` is configured and a customer session exists,
`/api/customers`, `/api/devices`, and lifecycle actions use Account Manager
proxy mode and preserve the frontend DTO shape. When `VIDEO_CLOUD_BASE_URL` and
`VIDEO_CLOUD_ADMIN_TOKEN` are configured, firmware, telemetry, stream, and
readiness enrichment paths use Video Cloud proxy mode; failures return gateway
errors instead of silently falling back.

Platform Admin read models prefer Account Manager admin inventory when the
platform session has an upstream token. During the migration period,
Account Manager may not expose every cross-tenant inventory route yet; 404 from
`/v1/admin/orgs`, `/v1/admin/devices`, or `/v1/admin/operations` is treated as
"optional inventory route not available" and falls back to the Admin BFF
projection cache so Platform Dashboard remains usable. Other Account Manager
errors remain gateway errors. Prometheus-backed Platform Dashboard panels also
degrade independently: unavailable or unconfigured Prometheus returns stable
source-unavailable states and the known staging server/resource rows instead
of hiding the entire dashboard.

## Authentication And Sessions

Production Customer authentication uses email and password credentials verified
by Account Manager. Admin Console remains the BFF and session owner, creating
the existing `rtk_admin_session` cookie after Account Manager returns customer
account and organization context. Platform SSO provider management remains a
separate capability documented in [`docs/sso-oidc-design.md`](sso-oidc-design.md).

Customer sessions:

- customer password login is enabled by default
- customer credentials are posted only to Account Manager login
- customer login rejects accounts without customer organization membership so
  platform-admin credentials can fall through to Platform Admin login
- the BFF stores session metadata plus upstream access/refresh tokens
- plaintext passwords are never stored
- `/api/me` returns user, memberships, active organization, and auth state
- active organization can be switched with `/api/me/active-org`
- demo mode remains available only for local development when Account Manager is
  not configured

Platform admin sessions:

- Platform Admin daily login should use Account Manager-backed SSO or the
  migration-period Account Manager platform password login.
- Cloud Admin does not provide a local break-glass administrator account.
- Emergency operator control is handled through Linode, SSH, and deployment
  tooling.
- platform-only API routes require a `platform_admin` session
- Account Manager upstream `401 Unauthorized` for Platform Admin routes means
  the upstream platform token is expired or invalid. The BFF must delete the
  local `rtk_admin_session` and clear the cookie before returning 401, so the
  browser cannot bounce between `/login` and the protected Platform View route.

## Upstream Integration

Account Manager proxy mode:

- `GET /api/customers` calls Account Manager organizations
- `GET /api/devices` calls Account Manager devices for visible organizations
- `POST /api/devices/{id}/provision` calls the Account Manager provision endpoint
- `POST /api/devices/{id}/deactivate` calls the Account Manager deactivate endpoint
- upstream failures return a gateway error instead of silently falling back
- attempted, accepted/completed, and failed lifecycle actions are recorded in audit with actor kind, organization id, result, request id, and upstream operation id fields where available

Service health:

- unset URLs report `demo` for local development; production/server validation
  should configure upstream URLs
- configured URLs are checked with a timeout
- responses include status, latency, and last checked timestamp

## UI Direction

The visual system follows `docs/rtk_cloud_contracts_doc/FRONTEND_STYLE.md` and should feel like an operational B2B console:

- compact left sidebar navigation
- restrained white/gray surfaces
- blue/teal status accents
- KPI strips for fleet state
- filterable React tables for devices and operations
- detail pages with a readiness timeline and right-side action panel
- status labels using the contract vocabulary instead of vague UI-only names
- URL-backed routes so console views are directly linkable
- device readiness detail panels that show source facts, including missing/stale facts

The WebUI design history is documented in:

- [`webui-customer-view-design.md`](webui-customer-view-design.md) for the
  approved Customer View visual concepts and state requirements
- [`admin-dashboard-redesign.md`](admin-dashboard-redesign.md) for Platform
  View structure
- [`platform-view-dashboard-design.md`](platform-view-dashboard-design.md) for
  the Platform Dashboard metrics and Prometheus-backed source mapping
- [`platform-brand-cloud-management-design.md`](platform-brand-cloud-management-design.md)
  for the Platform View Brand Clouds GUI draft
- [`webui-implementation-roadmap.md`](webui-implementation-roadmap.md) for the
  developer-ready WebUI issue sequence

Avoid marketing-style hero sections, decorative card grids, and large illustration-led pages.

## Readiness And Operation Vocabulary

Readiness states:

- `registered`
- `claim_pending`
- `local_onboarding_pending`
- `cloud_activation_pending`
- `activated`
- `online`
- `failed`
- `deactivation_pending`
- `deactivated`

Operation states:

- `pending`
- `published`
- `succeeded`
- `failed`
- `retrying`
- `dead_lettered`

Production-mode readiness precedence:

- Account Manager owns registry, organization membership, account status, and
  lifecycle operation state.
- Video Cloud owns cloud activation and current transport online facts whenever
  `VIDEO_CLOUD_BASE_URL` and `VIDEO_CLOUD_ADMIN_TOKEN` are configured.
- `online` requires both Video Cloud activation and current Video Cloud
  transport evidence; `DeviceProvisionSucceeded` or Account Manager
  `status=online` is not enough.
- Activated devices with missing or stale Video Cloud transport are shown as
  `activated`, with `transport_online` exposed as a missing/stale source fact.
- Missing `video_cloud_devid`, unavailable Video Cloud facts, authorization
  failures, stale data, or partial device-info/transport responses are surfaced
  as readiness gaps instead of being treated as activation success.
- Demo/cache mode remains available when upstream services are not configured,
  but its source facts are local projections and are not authoritative
  production readiness.

## Configuration

Environment variables:

- `PORT`: HTTP port, default `8080`.
- `DATABASE_PATH`: SQLite path, default `data/rtk-cloud-admin.db`.
- `ACCOUNT_MANAGER_BASE_URL`: optional upstream Account Manager URL.
- `VIDEO_CLOUD_BASE_URL`: optional upstream Video Cloud URL.
- `VIDEO_CLOUD_ADMIN_TOKEN`: optional upstream Video Cloud admin token.
- `ADMIN_BREAK_GLASS_ENABLED`: deprecated compatibility flag; local
  break-glass login is not supported and deployments should set it to `false`.
- `CUSTOMER_PASSWORD_LOGIN_ENABLED`: disables customer password login when set to `false`; default `true`.

## Test Plan

- Unit tests for app wiring, health endpoint, JSON API handlers, and SPA fallback.
- Store tests for SQLite schema creation, seed data, device queries, operation queries, audit metadata insertion, migration idempotence, and upgrade from the current v2 schema.
- Store tests for versioned migrations, admin password verification, and session expiry.
- App tests for customer login, upstream proxy mode, provision proxy, and platform admin route guards.
- Frontend build verification with `npm run build`.
- Backend build verification with `go test ./...` and `go build ./cmd/server`.
- Native server smoke verification for `/healthz`, `/api/service-health`, platform admin login/session, `/api/summary`, and `/console`.

## ChipSet and SDK Resource Catalog

Cloud Admin is a BFF and presentation layer for the Account Manager-owned
catalog. It does not persist providers, raw manifests, or normalized snapshots
in SQLite.

- Platform Admin uses `/api/admin/chipset-providers` to create and inspect
  providers and the `publish`, `unpublish`, and `refresh` actions.
- Every mutation requires `Idempotency-Key`; the BFF forwards the current
  Account Manager access token and correlation headers.
- The BFF enforces the independent `platform.chipset_sdk.read`,
  `platform.chipset_sdk.edit`, and `platform.chipset_sdk.publish`
  capabilities against Account Manager before proxying an operation.
- Developers use `/api/developer/chipsets` and
  `/api/developer/chipsets/{chipsetId}` and can receive only published,
  normalized resources. Provider URLs and raw manifests are excluded.
- The WebUI exposes a Platform provider management page and a developer
  `ChipSet & SDK` resource center with versions, recommendation status,
  supported models, stale warnings, and HTTPS external resource links.

The normative schema, lifecycle, SSRF controls, error contract, and ownership
boundary are defined by
`rtk_cloud_contracts_doc/CHIPSET_SDK_INFORMATION_PROVIDER.md`.
# Developer Brand Fleet Dashboard contract

The Developer console uses one global developer session and a server-side
active Brand Cloud scope. `/api/developer/brand-clouds` is the selector source
of truth; switching validates membership, refreshes capabilities, and clears
cloud-scoped frontend state. Fleet routes do not trust browser-supplied tenant
IDs or totals.

Authorization uses explicit capabilities rather than a UI role switch. Jobs,
reports, and provisioning store immutable server-side scope snapshots and
bounded pagination metadata. Mutating routes require `Idempotency-Key`, write
audit actor/cloud/scope/request metadata, and return stable capability errors.
Provisioning is a validation job followed by a separately confirmed execution
job; validation and execution history are never overwritten.

### Scope and source contract

OTA plans, batch jobs, reports, and provisioning executions use a server-
calculated immutable scope. A scope contains the normalized query,
`excluded_device_ids`, `scope_hash`, source freshness, and expiry. The browser
may request a preview but cannot provide a trusted target count, organization
identifier, or cross-cloud object identifier. OTA plan creation revalidates the
preview scope and rejects an expired or mismatched hash.

Provisioning accepts either compatibility JSON `device_ids` or a server-side
uploaded device-list source. Uploaded sources are checksum-bound,
organization-scoped, expiring, and referenced by validation jobs; an unbounded
100K-device JSON body is not the production upload path.

Reports persist `report_type`, dimensions, time range, timezone, output format,
scope hash, source freshness, result expiry, download status, and failure
reason. Team management uses `/api/developer/*`; Platform Admin Brand Cloud
lifecycle management remains under `/api/admin/*`.


## RTK Feature Requirement Inventory

This machine-readable acceptance inventory is normative for feature qualification and cross-references the behavioral sections above.

### [FEAT-CA-AUTHZ-001] Brand Cloud roles, scope, and administration

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"critical","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_admin/web/e2e/access-control.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-access.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-cloud.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-team.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/access-control.spec.mjs","selector":"[UI-CA-ACCESS-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/access-control.spec.mjs","selector":"[UI-CA-ACCESS-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/access-control.spec.mjs","selector":"[UI-CA-ACCESS-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-access.spec.mjs","selector":"[UI-CA-ROLE-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-access.spec.mjs","selector":"[UI-CA-ROLE-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-access.spec.mjs","selector":"[UI-CA-ROLE-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-cloud.spec.mjs","selector":"[UI-CA-SCOPE-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-cloud.spec.mjs","selector":"[UI-CA-SCOPE-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-team.spec.mjs","selector":"[UI-CA-TEAM-001]"}]}
-->

#### [REQ-UI-CA-ACCESS-001] Anonymous users cannot read the platform admin API

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Anonymous users cannot read the platform admin API.

#### [REQ-UI-CA-ACCESS-002] Customer users cannot read the platform admin API

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Customer users cannot read the platform admin API.

#### [REQ-UI-CA-ACCESS-003] Customer navigation remains separated from platform navigation

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Customer navigation remains separated from platform navigation.

#### [REQ-UI-CA-ROLE-001] Developer and release roles can manage release surfaces

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Developer and release roles can manage release surfaces.

#### [REQ-UI-CA-ROLE-002] Operations role cannot mutate SKU policy or release metadata

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Operations role cannot mutate SKU policy or release metadata.

#### [REQ-UI-CA-ROLE-003] Observer role is read-only through UI and API

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Observer role is read-only through UI and API.

#### [REQ-UI-CA-SCOPE-001] Brand Cloud switching keeps URL and data scope aligned

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud switching keeps URL and data scope aligned.

#### [REQ-UI-CA-SCOPE-002] Non-member cloud links are forbidden without changing active cloud

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Non-member cloud links are forbidden without changing active cloud.

#### [REQ-UI-CA-TEAM-001] Developer team management uses its namespace and is replay-safe

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Developer team management uses its namespace and is replay-safe.

### [FEAT-CA-BRAND-001] Brand Cloud lifecycle and audit

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"high","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_admin/web/e2e/audit.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","repos/rtk_cloud_admin/web/e2e/operations.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/audit.spec.mjs","selector":"[UI-CA-AUDIT-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-004]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-005]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-cloud.spec.mjs","selector":"[UI-CA-CLOUD-006]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/operations.spec.mjs","selector":"[UI-CA-OPS-001]"}]}
-->

#### [REQ-UI-CA-AUDIT-001] Platform admins can review audit records after a Brand Cloud action

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Platform admins can review audit records after a Brand Cloud action.

#### [REQ-UI-CA-CLOUD-001] Brand Cloud filters and detail reload show Account Manager data

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud filters and detail reload show Account Manager data.

#### [REQ-UI-CA-CLOUD-002] Brand Cloud status filter selects disabled clouds

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud status filter selects disabled clouds.

#### [REQ-UI-CA-CLOUD-003] Brand Cloud list renders upstream failures safely

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud list renders upstream failures safely.

#### [REQ-UI-CA-CLOUD-004] Brand Cloud detail supports cloud and user lifecycle actions

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud detail supports cloud and user lifecycle actions.

#### [REQ-UI-CA-CLOUD-005] Brand Cloud creation stepper completes successfully

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud creation stepper completes successfully.

#### [REQ-UI-CA-CLOUD-006] Brand Cloud creation surfaces partial owner-assignment failure

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Brand Cloud creation surfaces partial owner-assignment failure.

#### [REQ-UI-CA-OPS-001] Platform admins can open operations and service logs

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Platform admins can open operations and service logs.

### [FEAT-CA-OBS-001] Platform observability and safe failure states

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"high","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_logger/**","repos/rtk_cloud_admin/web/e2e/brand-fleet-errors.spec.mjs","repos/rtk_cloud_admin/web/e2e/platform-dashboard.spec.mjs","repos/rtk_cloud_admin/web/e2e/service-logs.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/platform-dashboard.spec.mjs","selector":"[UI-CA-DASH-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/platform-dashboard.spec.mjs","selector":"[UI-CA-DASH-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/platform-dashboard.spec.mjs","selector":"[UI-CA-DASH-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/service-logs.spec.mjs","selector":"[UI-CA-LOGS-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-errors.spec.mjs","selector":"[UI-CA-SOURCE-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-errors.spec.mjs","selector":"[UI-CA-SOURCE-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-errors.spec.mjs","selector":"[UI-CA-SOURCE-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-errors.spec.mjs","selector":"[UI-CA-SOURCE-004]"}]}
-->

#### [REQ-UI-CA-DASH-001] Platform admins can triage the platform dashboard

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Platform admins can triage the platform dashboard.

#### [REQ-UI-CA-DASH-002] Dashboard reports degraded state when Prometheus is unavailable

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Dashboard reports degraded state when Prometheus is unavailable.

#### [REQ-UI-CA-DASH-003] Dashboard exposes empty and stale Prometheus states

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Dashboard exposes empty and stale Prometheus states.

#### [REQ-UI-CA-LOGS-001] Platform admins can inspect service-log incident context

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Platform admins can inspect service-log incident context.

#### [REQ-UI-CA-SOURCE-001] Empty upstream source renders an empty state

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Empty upstream source renders an empty state.

#### [REQ-UI-CA-SOURCE-002] Stale upstream source keeps data and exposes freshness

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Stale upstream source keeps data and exposes freshness.

#### [REQ-UI-CA-SOURCE-003] Unavailable source is distinguished from an empty source

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Unavailable source is distinguished from an empty source.

#### [REQ-UI-CA-SOURCE-004] Customer-safe errors do not expose upstream credentials

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Customer-safe errors do not expose upstream credentials.

### [FEAT-CA-OPS-001] Operations, reports, and jobs

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"high","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_admin/web/e2e/brand-fleet-jobs.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-lifecycle.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-report-states.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-lifecycle.spec.mjs","selector":"[UI-CA-BATCH-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-lifecycle.spec.mjs","selector":"[UI-CA-BATCH-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-lifecycle.spec.mjs","selector":"[UI-CA-BATCH-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-jobs.spec.mjs","selector":"[UI-CA-JOBS-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-report-states.spec.mjs","selector":"[UI-CA-REPORT-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-report-states.spec.mjs","selector":"[UI-CA-REPORT-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-REPORT-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-REPORT-004]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-REPORT-005]"}]}
-->

#### [REQ-UI-CA-BATCH-001] Partial batch failure preserves item results and supports a new retry attempt

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Partial batch failure preserves item results and supports a new retry attempt.

#### [REQ-UI-CA-BATCH-002] Batch jobs enforce valid pause resume and cancel transitions

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Batch jobs enforce valid pause resume and cancel transitions.

#### [REQ-UI-CA-BATCH-003] Completed batch results can be downloaded as JSON and CSV

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Completed batch results can be downloaded as JSON and CSV.

#### [REQ-UI-CA-JOBS-001] Batch jobs use server scope idempotency and result lifecycle

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Batch jobs use server scope idempotency and result lifecycle.

#### [REQ-UI-CA-REPORT-001] Report failure remains customer-safe when upstream is unavailable

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Report failure remains customer-safe when upstream is unavailable.

#### [REQ-UI-CA-REPORT-002] Expired report results return an explicit expired state

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Expired report results return an explicit expired state.

#### [REQ-UI-CA-REPORT-003] Report builder submits complete metadata from the browser

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Report builder submits complete metadata from the browser.

#### [REQ-UI-CA-REPORT-004] Reports preserve scope metadata and expose async download

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Reports preserve scope metadata and expose async download.

#### [REQ-UI-CA-REPORT-005] Report idempotency replay and conflict preserve original scope

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Report idempotency replay and conflict preserve original scope.

### [FEAT-CA-PROV-001] Fleet provisioning and bulk workflows

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"critical","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_account_manager/**","repos/rtk_cloud_admin/web/e2e/brand-fleet-pages.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-provisioning.spec.mjs","repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-pages.spec.mjs","selector":"[UI-CA-FLEETPAGE-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-pages.spec.mjs","selector":"[UI-CA-FLEETPAGE-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-provisioning.spec.mjs","selector":"[UI-CA-PROV-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-provisioning.spec.mjs","selector":"[UI-CA-PROV-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-provisioning.spec.mjs","selector":"[UI-CA-PROV-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-PROV-004]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-PROV-005]"}]}
-->

#### [REQ-UI-CA-FLEETPAGE-001] Customer fleet pages load through the real BFF

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Customer fleet pages load through the real BFF.

#### [REQ-UI-CA-FLEETPAGE-002] Device fleet remains server paginated

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"independent","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Device fleet remains server paginated.

#### [REQ-UI-CA-PROV-001] Invalid-device validation is immutable and cannot execute

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Invalid-device validation is immutable and cannot execute.

#### [REQ-UI-CA-PROV-002] Provisioning upload replay is idempotent and conflicts are rejected

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Provisioning upload replay is idempotent and conflicts are rejected.

#### [REQ-UI-CA-PROV-003] Observers cannot start provisioning from browser or API

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Observers cannot start provisioning from browser or API.

#### [REQ-UI-CA-PROV-004] Provisioning CSV upload starts browser validation

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Provisioning CSV upload starts browser validation.

#### [REQ-UI-CA-PROV-005] Provisioning upload validates before creating an execution job

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Provisioning upload validates before creating an execution job.

### [FEAT-CA-RELEASE-001] OTA and chipset release administration

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"high","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","repos/rtk_cloud_admin/web/e2e/chipset-sdk.spec.mjs","repos/rtk_cloud_admin/web/e2e/chipset-sdk.visual.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.spec.mjs","selector":"[UI-CA-CHIPSET-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.spec.mjs","selector":"[UI-CA-CHIPSET-002]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.spec.mjs","selector":"[UI-CA-CHIPSET-003]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.spec.mjs","selector":"[UI-CA-CHIPSET-004]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.visual.spec.mjs","selector":"[UI-CA-CHIPSET-005]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/chipset-sdk.visual.spec.mjs","selector":"[UI-CA-CHIPSET-006]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-workflows.spec.mjs","selector":"[UI-CA-OTA-001]"}]}
-->

#### [REQ-UI-CA-CHIPSET-001] Chipset provider page exposes loading and validation states

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Chipset provider page exposes loading and validation states.

#### [REQ-UI-CA-CHIPSET-002] Read-only provider capability hides mutation controls

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Read-only provider capability hides mutation controls.

#### [REQ-UI-CA-CHIPSET-003] Provider and developer pages expose safe upstream-unavailable states

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Provider and developer pages expose safe upstream-unavailable states.

#### [REQ-UI-CA-CHIPSET-004] Provider publish refresh fallback and unpublish lifecycle works

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Provider publish refresh fallback and unpublish lifecycle works.

#### [REQ-UI-CA-CHIPSET-005] Platform provider design matches the approved visual baseline

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Platform provider design matches the approved visual baseline.

#### [REQ-UI-CA-CHIPSET-006] Developer resource design matches the approved visual baseline

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: Developer resource design matches the approved visual baseline.

#### [REQ-UI-CA-OTA-001] OTA scope preview is server calculated and immutable

<!-- rtk-requirement
{"acceptance_layer":"ui","operation_model":"workflow","gate":"pr","environments":["local"],"targets":["desktop","mobile"],"evidence":["screenshot"],"required":true,"status":"active"}
-->

Acceptance: OTA scope preview is server calculated and immutable.

### [FEAT-CA-STAGING-001] Deployed Cloud Admin experience

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"critical","status":"active","change_paths":["repos/rtk_cloud_admin/**","repos/rtk_cloud_admin/web/e2e/brand-fleet-staging.spec.mjs","repos/rtk_cloud_admin/web/e2e/staging.spec.mjs"],"commit_anchors":["workspace","cloud_admin"],"surfaces":[{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/staging.spec.mjs","selector":"[UI-CA-STAGING-001]"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/e2e/brand-fleet-staging.spec.mjs","selector":"[UI-CA-STAGING-002]"}]}
-->

#### [REQ-UI-CA-STAGING-001] Staging platform admin can read operations

<!-- rtk-requirement
{"acceptance_layer":"live","gate":"scheduled","environments":["staging"],"targets":["desktop","mobile"],"evidence":["screenshot"],"freshness_hours":36,"required":true,"status":"active"}
-->

Acceptance: Staging platform admin can read operations.

#### [REQ-UI-CA-STAGING-002] Staging customer can perform the read-only Brand Fleet smoke flow

<!-- rtk-requirement
{"acceptance_layer":"live","gate":"scheduled","environments":["staging"],"targets":["desktop","mobile"],"evidence":["screenshot"],"freshness_hours":36,"required":true,"status":"active"}
-->

Acceptance: Staging customer can perform the read-only Brand Fleet smoke flow.
