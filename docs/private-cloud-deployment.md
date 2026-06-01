# Private Cloud Deployment Profile

Status: draft.

This document describes the supported production deployment profile for
`rtk_cloud_admin` when it is run as the admin dashboard in a private-cloud
environment.

## Target Shape

Recommended production layout:

- run the Go server as a native systemd service
- emit `rtk_cloud_logger` zap JSON logs to stdout/stderr for journald collection
- place it behind a reverse proxy that terminates TLS
- mount a persistent SQLite volume for `DATABASE_PATH`
- configure upstream Account Manager and Video Cloud endpoints explicitly
- keep admin bootstrap secrets out of source control and inject them at deploy
  time

The app is not a stateless frontend. Local SQLite holds sessions, platform
admins, audit metadata, settings, and upstream cache projections. Treat the
database file as production state and back it up accordingly.

## Linode Staging Profile

The supported Linode staging shape is a dedicated Admin VM with public HTTPS
ingress and a Video Cloud VPC interface for private observability access. This
keeps the dashboard deployment boundary separate from `rtk_video_cloud` while
avoiding any public exposure of Prometheus.

Recommended staging traffic:

```text
internet
  -> admin.video-cloud-staging.realtekconnect.com:443
  -> nginx on the Admin VM
  -> native rtk_cloud_admin systemd service on 127.0.0.1:8080

rtk_cloud_admin
  -> ACCOUNT_MANAGER_BASE_URL over public HTTPS
  -> VIDEO_CLOUD_BASE_URL over public HTTPS
  -> VIDEO_CLOUD_PROMETHEUS_BASE_URL over private VPC HTTP
```

The operator-local scripts live under [`deploy/linode/`](../deploy/linode/):

- `provision-admin-vm.sh` creates the public-only Linode VM and firewall.
- `deploy-admin.sh` uploads the selected native release bundle, installs nginx,
  writes the systemd unit, and starts the service.
- `verify-admin.sh` checks the deployed HTTP surface.
- `backup-admin-db.sh` pulls a timestamped SQLite backup.

The copied `deploy/linode/*.env` and generated state files are local operator
artifacts and must not be committed.

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
- `ADMIN_BOOTSTRAP_EMAIL`: local platform admin bootstrap email
- `ADMIN_BOOTSTRAP_PASSWORD`: local platform admin bootstrap password

Production mode should set all upstream variables. Demo or cache-only mode is
only appropriate for local development or isolated validation.

## Reverse Proxy And TLS

The application itself serves plain HTTP. TLS should be terminated by the
fronting proxy or ingress controller.

Operational expectations:

- expose the app only on the private network or loopback interface
- forward client requests over HTTPS at the edge
- preserve the `Host` header and standard forwarding headers used by the
  operator's proxy stack
- keep the session cookie `HttpOnly` and treat it as an authenticated browser
  session, not an API token

## Data Ownership

`rtk_cloud_admin` is a BFF and cache layer, not the source of truth for fleet
state.

- Account Manager remains authoritative for users, memberships, organizations,
  and registry devices
- Video Cloud remains authoritative for activation, telemetry, stream, and
  firmware facts
- local SQLite remains authoritative for admin sessions, platform admins,
  audit metadata, and cached projections used by the dashboard

In production, upstream failures must be visible. The dashboard should surface
gateway errors instead of silently falling back when a configured upstream is
unreachable.

## Backup, Restore, And Rollback

Back up the SQLite database file together with any `-wal` or `-shm` sidecar
files when the database is in use.

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
- `POST /api/auth/platform/login` accepts the bootstrap admin credentials only
  when `ADMIN_BREAK_GLASS_ENABLED=true`
- `GET /api/me` succeeds when the login cookie is replayed
- `GET /api/summary` returns the dashboard summary payload
- `GET /console` renders the dashboard shell

The CI workflow in this repository mirrors that profile and should be kept in
sync with any future runtime or auth changes.
