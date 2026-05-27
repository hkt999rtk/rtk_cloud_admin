# RTK Cloud Admin

RTK Cloud Admin is a B2B operations console for RTK Cloud device fleet
management and provisioning. The backend is Go-only; the frontend is a React
JavaScript app built into static assets and served by the Go server.

The console is tenant-first:

- customer users manage their own organization devices and provisioning state
- platform administrators inspect customers, devices, lifecycle operations,
  service health, and audit activity across tenants

The product and integration contracts live in the
`rtk_cloud_contracts_doc` submodule.

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
rtk_cloud_contracts_doc/     Shared contracts submodule
```

## Configuration

Environment variables:

- `PORT`: HTTP port, default `8080`
- `DATABASE_PATH`: SQLite path, default `data/rtk-cloud-admin.db`
- `ACCOUNT_MANAGER_BASE_URL`: optional upstream Account Manager URL
- `VIDEO_CLOUD_BASE_URL`: optional upstream Video Cloud URL
- `VIDEO_CLOUD_ADMIN_TOKEN`: optional upstream Video Cloud admin token
- `ADMIN_BOOTSTRAP_EMAIL`: optional local platform admin break-glass email
- `ADMIN_BOOTSTRAP_PASSWORD`: optional local platform admin break-glass password
- `ADMIN_BREAK_GLASS_ENABLED`: set to `true` to enable local Platform Admin break-glass login; default `false`
- `LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED`: set to `true` to enable legacy customer password login; default `false`

If both admin bootstrap variables are set, startup creates the first local
platform admin break-glass account if it does not already exist. Passwords are
stored as bcrypt hashes. Session rows store metadata and upstream
bearer/refresh tokens, never plaintext credentials.
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

## CI

`.github/workflows/ci.yml` checks out submodules and runs `go test ./...`,
`go build ./cmd/server`, `npm ci`, `npm test`, `npm run build`, and a native
server smoke test on the self-hosted `rtk-cloud-admin-ci` runner.

Runner health and recovery notes live in [`docs/ci-runner.md`](docs/ci-runner.md).

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
