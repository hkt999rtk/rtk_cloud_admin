# Private Cloud Deployment Profile

Status: draft.

This document describes the supported deployment profile for `rtk_cloud_admin`
when it is run as the admin dashboard in a private-cloud environment. The
production migration target is Linode Kubernetes Engine (LKE). The Linode VM
profile below remains the staging and rollback reference until the workspace
LKE migration gates are approved.

## LKE Target Shape

Recommended LKE layout:

- run the Go server as a Deployment with readiness/liveness probes
- emit `rtk_cloud_logger` zap JSON logs to stdout/stderr for Kubernetes log
  collection
- expose HTTPS through Linode NodeBalancer plus Ingress or Gateway API
- mount a PVC for `DATABASE_PATH` while SQLite remains the selected persistence
  backend
- configure upstream Account Manager and Video Cloud endpoints explicitly
- keep admin bootstrap secrets out of source control and inject them from
  OpenBao or an approved secret-management path

The app is not a stateless frontend. Local SQLite holds sessions, audit
metadata, settings, and upstream cache projections. Treat the
database file as production state and back it up accordingly.

The Go application now accesses this local state through narrow app-level
interfaces for sessions, audit, projection reads, and lifecycle operations.
SQLite remains the implementation
for this deployment profile; no Redis-compatible session or projection cache is
required or configured by this release.

TODO: confirm whether production LKE keeps SQLite on a single-writer PVC,
migrates Admin state to PostgreSQL, or uses another persistence model before
writing production manifests. Until that decision is approved, do not scale the
Admin Deployment beyond the SQLite-safe topology.

## Linode Staging Profile

Linode staging runtime is K8s-only and is operated from the workspace. The
previous dedicated Admin VM scripts have been retired. Use
[`linode-staging-k8s.md`](linode-staging-k8s.md) for the supported staging
operator entrypoints.

Recommended staging traffic:

```text
internet
  -> admin.video-cloud-staging.realtekconnect.com:443
  -> K8s ingress/service path
  -> rtk_cloud_admin workload

rtk_cloud_admin
  -> ACCOUNT_MANAGER_BASE_URL through K8s service discovery
  -> VIDEO_CLOUD_BASE_URL through K8s service discovery
  -> observability through the K8s runtime log/query path
```

Do not add or use staging VM provision/deploy scripts in this repo. Staging
readiness and E2E verification belong to the workspace K8s flow.

## Runtime Configuration

Required or recommended environment variables:

- `PORT`: listen port for the HTTP server, default `8080`
- `DATABASE_PATH`: SQLite file path, typically on a persistent volume
- `ACCOUNT_MANAGER_BASE_URL`: upstream Account Manager base URL
- `VIDEO_CLOUD_BASE_URL`: upstream Video Cloud base URL
- `VIDEO_CLOUD_ADMIN_TOKEN`: admin token used for telemetry, firmware, and
  stream queries
- `VIDEO_CLOUD_PROMETHEUS_BASE_URL`: private Prometheus query endpoint, for
  example `http://10.42.1.30:9090`
- Platform admin login is backed by Account Manager; Cloud Admin does not
  require local bootstrap admin credentials.

Production mode should set all upstream variables. Demo or cache-only mode is
only appropriate for local development or isolated validation.

## Reverse Proxy And TLS

The application itself serves plain HTTP. TLS should be terminated by the
fronting Ingress/Gateway controller in LKE, or by nginx in the legacy VM bridge.

Operational expectations:

- expose the app only through its ClusterIP Service or legacy loopback/private
  interface
- forward client requests over HTTPS at the edge/Ingress
- preserve the `Host` header and standard forwarding headers used by the
  operator's proxy stack
- keep the session cookie `HttpOnly` and treat it as an authenticated browser
  session, not an API token
- expose metrics only to the observability namespace or private monitoring path;
  legacy node/nginx exporter ports remain VM-only migration reference

## Data Ownership

`rtk_cloud_admin` is a BFF and cache layer, not the source of truth for fleet
state.

- Account Manager remains authoritative for users, memberships, organizations,
  and registry devices
- Video Cloud remains authoritative for activation, telemetry, stream, and
  firmware facts
- local SQLite remains authoritative for admin sessions, platform admins,
  audit metadata, and cached projections used by the dashboard
- local projection interfaces are non-authoritative cache/read-model ports;
  they must not be used to turn Admin Console into the canonical brand-cloud,
  organization, device, or lifecycle-operation store

In production, upstream failures must be visible. The dashboard should surface
gateway errors instead of silently falling back when a configured upstream is
unreachable.
Platform Dashboard Prometheus panels are sourced through the Admin BFF using
`VIDEO_CLOUD_PROMETHEUS_BASE_URL`; browser JavaScript must not call Prometheus
directly, and Prometheus must remain private to the VPC.

## Backup, Restore, And Rollback

Back up the SQLite database file together with any `-wal` or `-shm` sidecar
files when the database is in use.

For LKE, take a storage-level snapshot or quiesced file backup of the PVC before
upgrades that may alter Admin state. Rollback must pair the known-good release
with a compatible SQLite/PVC snapshot. If Admin state moves to PostgreSQL later,
replace this section with the approved database restore procedure.

Practical workflow:

1. Stop the service or quiesce traffic.
2. Copy the current database file from `DATABASE_PATH`.
3. Archive the release version that produced the running service.
4. Restore by replacing the database file and redeploying the known-good
   release artifact.
5. Roll back by restoring the previous database snapshot and the previous app
   artifact together.

The fastest rollback path is to redeploy the previous release artifact and point
it at the last known good SQLite snapshot.

## Smoke Checks

The production profile should be validated with a small set of deterministic
checks after startup:

- `GET /healthz` returns `ok`
- `GET /api/service-health` returns the upstream status summary
- `POST /api/auth/platform/login` accepts Account Manager platform-admin
  credentials and creates a platform session only after upstream authorization
- `GET /api/me` succeeds when the login cookie is replayed
- `GET /api/summary` returns the dashboard summary payload
- `GET /console` renders the dashboard shell

The CI workflow in this repository mirrors that profile and should be kept in
sync with any future runtime or auth changes.
