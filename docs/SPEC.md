# RTK Cloud Admin Console Specification

## Summary

RTK Cloud Admin Console is a B2B operations console for RTK Cloud device fleet management and provisioning. It is a tenant-first web application: customer users manage their own organization devices, while platform administrators use a separate local-admin entry point to inspect customers, devices, lifecycle operations, service health, and audit activity across tenants.

The first implementation uses a Go backend/BFF, SQLite, and a React JavaScript frontend. Backend code and runtime services must be Go only. Node.js/npm are allowed only for frontend development and static asset builds; they must not be required by the Go backend at runtime.

## Product Direction

The console follows the contracts in `rtk_cloud_contracts_doc`:

- Account Manager owns customer authentication, organizations, members, registry devices, and provisioning/deactivation APIs.
- Realtek Video Cloud owns activation, scoped tokens, stream/media routes, firmware routes, and transport ownership.
- Product readiness is an aggregate projection across account registry, claim/bind, local onboarding, cloud activation, and transport online facts.
- Frontend color, typography, status labels, and layout tone follow `rtk_cloud_contracts_doc/FRONTEND_STYLE.md`.
- This repository provides a frontend/BFF surface. It must not redefine the source-of-truth ownership from the contracts.

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
  - dashboard overview
  - customer overview
  - device list
  - device detail
  - provisioning/deactivation actions
  - readiness status display
  - member/support placeholders
- Platform admin pages:
  - customer overview
  - all devices
  - lifecycle operations
  - service health
  - audit log
- Audit events are recorded when demo lifecycle actions are created from the
  console.
- Local demo mode backed by SQLite seed data so the console is useful before real service endpoints are configured.

Out of scope for v0.1:

- Replacing Account Manager or Video Cloud as source of truth.
- Full OTA campaign engine.
- Telemetry ingestion pipeline.
- WebRTC player, clip library, or media download manager.
- Smart-home schedules, scenes, Matter, Alexa, or Google Assistant runtime features.
- Multi-language UI. Console UI is English-first.

## Architecture

Runtime components:

- `cmd/server`: process entry point, configuration, server startup, graceful shutdown.
- `internal/app`: application wiring, route registration, JSON API handlers, static frontend serving, health endpoint.
- `internal/store`: SQLite schema, repository methods, seed data, and migrations.
- `internal/contracts`: Go vocabulary for readiness states, operation states, roles, and DTOs used by the UI.
- `web`: React frontend source, built with Vite and served as static files by the Go backend.
- `web/dist`: generated frontend build output, not manually edited.

Data ownership:

- SQLite is authoritative only for console-local data: platform admins, sessions, audit, settings, preferences, and cache/demo projections.
- Account Manager remains authoritative for customer users, organizations, membership, and registry devices.
- Video Cloud remains authoritative for activation, transport, streaming, media, firmware, and device runtime facts.

## HTTP Interface

Public and shared routes:

- `GET /healthz`: plain health check.
- `GET /api/summary`: customer and platform dashboard summary.
- `GET /api/devices`: device list from cache/demo or upstream aggregation.
- `GET /api/devices/{id}`: device detail.
- `POST /api/devices/{id}/provision`: starts or simulates provisioning.
- `POST /api/devices/{id}/deactivate`: starts or simulates deactivation.
- `GET /api/operations`: lifecycle operation list.
- `GET /api/service-health`: configured upstream service health.
- `GET /api/audit`: audit log.
- `GET /assets/...`: built frontend assets.
- `GET /*`: React SPA fallback.

The v0.1 implementation may run without configured upstream services. In that mode, API responses use SQLite seed data and clearly show local demo status in service health.

## UI Direction

The visual system follows `rtk_cloud_contracts_doc/FRONTEND_STYLE.md` and should feel like an operational B2B console:

- compact left sidebar navigation
- restrained white/gray surfaces
- blue/teal status accents
- KPI strips for fleet state
- filterable React tables for devices and operations
- detail pages with a readiness timeline and right-side action panel
- status labels using the contract vocabulary instead of vague UI-only names

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

## Configuration

Environment variables:

- `PORT`: HTTP port, default `8080`.
- `DATABASE_PATH`: SQLite path, default `data/rtk-cloud-admin.db`.
- `ACCOUNT_MANAGER_BASE_URL`: optional upstream Account Manager URL.
- `VIDEO_CLOUD_BASE_URL`: optional upstream Video Cloud URL.
- `ADMIN_BOOTSTRAP_EMAIL`: optional first local platform admin email.
- `ADMIN_BOOTSTRAP_PASSWORD`: optional first local platform admin password for development.

## Test Plan

- Unit tests for app wiring, health endpoint, JSON API handlers, and SPA fallback.
- Store tests for SQLite schema creation, seed data, device queries, operation queries, and audit insertion.
- Frontend build verification with `npm run build`.
- Backend build verification with `go test ./...` and `go build ./cmd/server`.
