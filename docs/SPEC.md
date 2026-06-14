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
  - Fleet Health Overview
  - Devices with detail drawer
  - Firmware & OTA
  - Stream Health
  - provisioning/deactivation actions in the device drawer
  - readiness, health, firmware, telemetry, and stream status displays
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
- Full OTA campaign engine.
- Telemetry ingestion pipeline.
- WebRTC player, clip library, or media download manager.
- Device Groups in the first Customer View batch.
- Smart-home schedules, scenes, Matter, Alexa, or Google Assistant runtime features.
- Multi-language UI. Console UI is English-first.

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
  Dashboard BFF contract with server-side allowlisted Prometheus queries.
- `GET /api/admin/platform-resource-trends`: platform-admin protected rolling
  24h, 7d, and 90d server resource trend contract with sanitized Prometheus
  query_range output.
- `GET /api/devices`: device list from cache/demo or upstream aggregation.
- `GET /api/devices/{id}`: device detail.
- `POST /api/devices/{id}/provision`: starts or simulates provisioning.
- `POST /api/devices/{id}/deactivate`: starts or simulates deactivation.
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
