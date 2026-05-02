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
- local platform admin login/session endpoint backed by SQLite
- Account Manager proxy mode for organizations, devices, provision, and deactivate
- explicit SQLite schema migrations tracked in `schema_migrations`
- URL routes for `/console`, `/console/customers`, `/console/devices`,
  `/console/operations`, `/console/audit`, and `/admin`
- Docker packaging and GitHub Actions CI
- shared frontend style contract in `rtk_cloud_contracts_doc/FRONTEND_STYLE.md`
- local Realtek logo asset copied from the Realtek Connect+ marketing site

When `ACCOUNT_MANAGER_BASE_URL` is unset, the app runs from SQLite demo/cache
data. When it is set and a customer signs in, customer, device, and lifecycle
actions proxy through Account Manager while preserving the current frontend DTOs.

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

Backend build:

```sh
go build -o /tmp/rtk-cloud-admin-server ./cmd/server
```

Frontend build:

```sh
cd web
npm run build
```

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
- `ADMIN_BOOTSTRAP_EMAIL`: optional local platform admin email
- `ADMIN_BOOTSTRAP_PASSWORD`: optional local platform admin password

If both admin bootstrap variables are set, startup creates the first local
platform admin if it does not already exist. Passwords are stored as bcrypt
hashes. Session rows store metadata and upstream bearer/refresh tokens, never
plaintext credentials.

SQLite schema changes are applied through versioned migrations. Existing local
databases are upgraded in place and applied versions are stored in
`schema_migrations`. Upstream cache tables are non-authoritative mirrors of
Account Manager and Video Cloud facts; they can be refreshed or rebuilt from the
owning services. Local SQLite remains authoritative only for console-local
sessions, platform admins, integration settings, and audit metadata.

## Docker

Build:

```sh
docker build -t rtk-cloud-admin .
```

Run with a mounted SQLite data path:

```sh
docker run --rm -p 18081:8080 \
  -v "$PWD/data:/data" \
  -e ACCOUNT_MANAGER_BASE_URL="https://account-manager.example" \
  -e VIDEO_CLOUD_BASE_URL="https://video-cloud.example" \
  rtk-cloud-admin
```

Container health uses `/healthz`.

## CI

`.github/workflows/ci.yml` checks out submodules and runs `go test ./...`,
`go build ./cmd/server`, `npm ci`, and `npm run build`.

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
