# RTK Cloud Admin

RTK Cloud Admin is a B2B operations console for RTK Cloud device fleet
management and provisioning. The backend is Go-only; the frontend is a React
JavaScript app built into static assets and served by the Go server.

The console is tenant-first:

- customer users manage their own organization devices and provisioning state
- platform administrators inspect customers, devices, lifecycle operations,
  service health, and audit activity across tenants

The WebUI is intentionally implemented in this repository, not in
`rtk_account_manager`. Account Manager owns identity, organizations,
membership, entitlement, and brand-cloud source-of-truth APIs. This server owns
the React WebUI and BFF surface that operators use to view or administer those
upstream facts. Realtek Video Cloud owns activation, firmware, telemetry,
streaming, and media runtime facts.

The product and integration contracts live in the
`rtk_cloud_contracts_doc` submodule.

The service logging migration to `rtk_cloud_logger` zap and central journald
forwarding is documented in
[`docs/SERVICE_LOGGING_MIGRATION.md`](docs/SERVICE_LOGGING_MIGRATION.md).

## Current Scope

Implemented in this first version:

- Go HTTP server using `net/http`
- SQLite persistence for local demo data, upstream cache projections, settings,
  sessions, and audit metadata
- React frontend built with Vite
- device fleet dashboard
- customer overview with organization-level fleet health
- device list with readiness states
- provisioning and deactivation demo actions
- lifecycle operation list
- audit log for local lifecycle actions
- service health summary
- customer login/session endpoint backed by Account Manager when configured
- legacy local platform admin login/session endpoint backed by SQLite for controlled break-glass access
- SSO/OIDC architecture documented for the next authentication milestone
- Account Manager proxy mode for organizations, devices, provision, and deactivate
- Platform Dashboard BFF and React landing page with curated Prometheus-backed
  operational panels, source states, and no browser-side Prometheus or Grafana
  access
- Account Manager-backed brand-cloud admin BFF routes for future Platform View
  UI implementation
- narrow application store interfaces for sessions, break-glass platform
  admins, audit events, projection reads, and lifecycle operations; the current
  implementation remains SQLite-backed and does not add Redis
- explicit SQLite schema migrations tracked in `schema_migrations`
- URL routes for `/console`, `/console/customers`, `/console/devices`,
  `/console/operations`, `/console/audit`, and `/admin`
- native release packaging and GitHub Actions CI
- shared frontend style contract in `rtk_cloud_contracts_doc/FRONTEND_STYLE.md`
- local Realtek logo asset copied from the Realtek Connect+ marketing site

When `ACCOUNT_MANAGER_BASE_URL` is unset, the app runs from SQLite demo/cache
data. When it is set and a customer signs in, customer, device, and lifecycle
actions proxy through Account Manager while preserving the current frontend DTOs.

The planned production authentication direction is SSO-only daily login for both
Customer users and Platform Admins, with Account Manager acting as the OIDC
identity broker and authorization source. See
[`docs/sso-oidc-design.md`](docs/sso-oidc-design.md). Existing password login
paths are legacy compatibility or controlled break-glass surfaces, not the
long-term production target.

Recent completion status:

- Platform Dashboard implementation, QA documentation, OpenAPI coverage, and
  browser smoke coverage are complete.
- Admin Console local-store access is split behind narrow interfaces so future
  session/projection cache work can be introduced without making Admin Console
  the source of truth for upstream tenant or device facts.
- The contracts documentation submodule URL and CI rewrite now support the
  local `github.com-work` SSH alias while preserving token-authenticated CI
  checkout.

## WebUI Background

This server has two WebUI modes that share the same React/Vite application and
Go BFF:

- **Customer View** is for Tier 2 brand operators. It covers Fleet Health,
  Devices, Firmware & OTA, and Stream Health for the active organization only.
  Customer-facing pages must not expose platform-only audit, customer browsing,
  raw upstream payloads, or cross-tenant facts.
- **Platform View** is for Tier 1 Platform Admins. It covers Platform
  Dashboard, Service Health, SSO Providers, Operations Log, Audit Log, and the
  planned Brand Clouds management UI. Platform View data and navigation are
  role-gated away from Customer View.

The design and implementation context is split across these documents:

- [`docs/SPEC.md`](docs/SPEC.md): product scope, source-of-truth ownership,
  HTTP routes, and runtime architecture.
- [`docs/ROLES.md`](docs/ROLES.md): Tier 1/Tier 2 responsibilities,
  capabilities, and field visibility rules.
- [`docs/webui-customer-view-design.md`](docs/webui-customer-view-design.md):
  approved Customer View design direction and visual concepts.
- [`docs/admin-dashboard-redesign.md`](docs/admin-dashboard-redesign.md):
  Customer/Platform View split and Platform View structure.
- [`docs/platform-view-dashboard-design.md`](docs/platform-view-dashboard-design.md):
  Platform Dashboard metrics, Prometheus source mapping, and BFF boundary.
- [`docs/platform-brand-cloud-management-design.md`](docs/platform-brand-cloud-management-design.md):
  draft Platform View Brand Clouds GUI and workflow design.
- [`docs/webui-implementation-roadmap.md`](docs/webui-implementation-roadmap.md):
  developer-ready issue roadmap for implementing the WebUI milestones.
- [`docs/customer-view-visual-qa-checklist.md`](docs/customer-view-visual-qa-checklist.md)
  and [`docs/webui-browser-qa.md`](docs/webui-browser-qa.md): browser QA and
  visual signoff expectations.

Visual mock assets live under `docs/assets/webui-design/`. Customer View has
approved PNG concepts. Brand Clouds has a reviewable static GUI mock at
`docs/assets/webui-design/platform-brand-clouds-mock.html` plus PNG captures
for the list, create drawer, and detail drawer states.

## Requirements

- Go 1.24 or newer
- Node.js and npm for frontend development/build only
- SQLite is embedded through the Go driver; no external SQLite service is needed

## Run Locally

Build the frontend first:

```sh
cd web
npm install
npm run build
cd ..
```

Run the Go server:

```sh
PORT=18081 DATABASE_PATH=data/dev.db go run ./cmd/server
```

Open:

```text
http://localhost:18081
```

Health check:

```sh
curl http://localhost:18081/healthz
```

## Development

Backend tests:

```sh
go test ./...
```

Backend coverage:

```sh
go test ./... -coverprofile=coverage.out
go tool cover -func=coverage.out
```

CI enforces Go total coverage >= 80%.

Backend build:

```sh
go build -o /tmp/rtk-cloud-admin-server ./cmd/server
```

Frontend build:

```sh
cd web
npm test
npm run build
```

Testing policy:

- API handler behavior changes need focused Go tests with `httptest`.
- Account Manager and Video Cloud integrations must be tested with local
  `httptest` upstreams, never real services.
- Frontend route or API helper changes need Node test coverage in
  `web/src/*.test.mjs`.

Run a persistent local server through tmux:

```sh
tmux new-session -d -s rtk-cloud-admin \
  'cd /Users/kevinhuang/work/rtk_cloud_admin && PORT=18081 DATABASE_PATH=data/dev.db /tmp/rtk-cloud-admin-server'
```

Stop it:

```sh
tmux kill-session -t rtk-cloud-admin
```

## Repository Layout

```text
cmd/server/                  Go server entrypoint
internal/app/                HTTP routes and API handlers
internal/contracts/          Go DTOs and shared vocabulary
internal/store/              SQLite schema, seed data, and repositories
web/                         React frontend
docs/SPEC.md                 Product and implementation specification
docs/openapi.yaml            OpenAPI contract for the Admin Console BFF API
docs/assets/webui-design/    WebUI visual concepts and static GUI mocks
rtk_cloud_contracts_doc/     Shared contracts submodule
```

## Configuration

Environment variables:

- `PORT`: HTTP port, default `8080`
- `DATABASE_PATH`: SQLite path, default `data/rtk-cloud-admin.db`
- `ACCOUNT_MANAGER_BASE_URL`: optional upstream Account Manager URL
- `VIDEO_CLOUD_BASE_URL`: optional upstream Video Cloud URL
- `VIDEO_CLOUD_ADMIN_TOKEN`: optional upstream Video Cloud admin token
- `VIDEO_CLOUD_PROMETHEUS_BASE_URL`: optional private Prometheus query endpoint
- `ADMIN_BOOTSTRAP_EMAIL`: optional local platform admin break-glass email
- `ADMIN_BOOTSTRAP_PASSWORD`: optional local platform admin break-glass password
- `ADMIN_BREAK_GLASS_ENABLED`: set to `true` to enable local Platform Admin break-glass login; default `false`
- `LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED`: set to `true` to enable legacy customer password login; default `false`

If both admin bootstrap variables are set, startup creates the first local
platform admin break-glass account if it does not already exist. Passwords are
stored as bcrypt hashes. Session rows store metadata and upstream
bearer/refresh tokens, never plaintext credentials.

Linode Admin deployments install node and nginx Prometheus exporters for
private Prometheus scraping. The nginx exporter uses local nginx `stub_status`
on `127.0.0.1:8081` so the Admin service remains bound to `127.0.0.1:8080`.
Break-glass login is rejected unless `ADMIN_BREAK_GLASS_ENABLED=true`, and
customer password login is rejected unless
`LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED=true`.

SQLite schema changes are applied through versioned migrations. Existing local
databases are upgraded in place and applied versions are stored in
`schema_migrations`. Upstream cache tables are non-authoritative mirrors of
Account Manager and Video Cloud facts; they can be refreshed or rebuilt from the
owning services. Local SQLite remains authoritative only for console-local
sessions, platform admins, integration settings, and audit metadata.

## Release Packaging

Build a Linux amd64 release bundle:

```sh
VERSION=dev-local deploy/package.sh
deploy/check-release.sh dist/rtk_cloud_admin-dev-local
```

The release bundle contains the Go server binary, built frontend assets, a
manifest, and checksums. The Linode deploy script installs this bundle as a
native systemd service behind nginx.

For a production private-cloud deployment, see
[`docs/private-cloud-deployment.md`](docs/private-cloud-deployment.md). For the
Linode staging scripts, see [`deploy/linode/`](deploy/linode/).

## Release Artifacts

Release artifacts are native Linux bundles produced by `deploy/package.sh` and
verified by `deploy/check-release.sh`:

```sh
VERSION=v1.2.3 deploy/package.sh
deploy/check-release.sh dist/rtk_cloud_admin-v1.2.3
```

Release runs upload the bundle, checksum, and manifest to Linode Object Storage
under `releases/rtk_cloud_admin-<version>/`. The object filenames use the
version directly, for example `v1.2.3.tar.gz`. Object Storage credentials belong
in GitHub repository secrets and variables, not local `.env` files.

## CI

`.github/workflows/ci.yml` runs on GitHub-hosted `ubuntu-latest`, initializes
the contracts submodule when `CONTRACTS_REPO_TOKEN` is configured, and runs
`go test ./...`, `go build ./cmd/server`, `npm ci`, `npm test`,
`npm run build`, and a native server smoke test.

`.github/workflows/release.yml` runs only for `v*` tags or manual dispatch.
Manual dispatch builds and verifies a release bundle as a GitHub workflow
artifact. Tag-triggered runs also publish the release bundle to Linode Object
Storage and attach assets to the GitHub Release. Normal PR and main CI do not
upload release artifacts.

CI environment notes live in [`docs/ci-runner.md`](docs/ci-runner.md).

## Contracts

Initialize submodules after clone:

```sh
git submodule update --init --recursive
```

Update the contracts submodule:

```sh
git -C rtk_cloud_contracts_doc pull --ff-only
git add rtk_cloud_contracts_doc
```

Frontend color, typography, layout, and status presentation rules are defined in:

```text
rtk_cloud_contracts_doc/FRONTEND_STYLE.md
```

The React console uses a local copy of the Realtek logo at:

```text
web/public/assets/realtek-logo.png
```
