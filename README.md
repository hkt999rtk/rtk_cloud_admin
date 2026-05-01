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
- SQLite persistence for local demo/cache data
- React frontend built with Vite
- device fleet dashboard
- customer overview with organization-level fleet health
- device list with readiness states
- provisioning and deactivation demo actions
- lifecycle operation list
- audit log for local lifecycle actions
- service health summary
- shared frontend style contract in `rtk_cloud_contracts_doc/FRONTEND_STYLE.md`
- local Realtek logo asset copied from the Realtek Connect+ marketing site

The current data is demo seed data stored in SQLite. Account Manager and Video
Cloud upstream integration points are documented in `docs/SPEC.md`, but real
upstream calls are not wired yet.

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
- `ACCOUNT_MANAGER_BASE_URL`: planned upstream Account Manager URL
- `VIDEO_CLOUD_BASE_URL`: planned upstream Video Cloud URL

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
