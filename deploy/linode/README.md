# Linode Admin Dashboard Deployment

This directory contains the operator-local deployment scripts for running
`rtk_cloud_admin` on a dedicated Linode VM.

The Admin VM is a dedicated public+VPC Linode:

- one dedicated public Linode VM
- one VPC interface on the Video Cloud subnet for private observability queries
- public HTTPS to Account Manager and Video Cloud upstreams
- private VPC HTTP to the Video Cloud Prometheus endpoint
- local SQLite persisted on the Admin VM

## Target Shape

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

This is the same operator-local deployment model used by the Video Cloud Linode
tooling: CI builds/test artifacts; a trusted operator machine performs Linode
mutation and host deployment with local secrets.

## Files

| File | Purpose |
| --- | --- |
| `admin-staging.env.example` | Local operator env template. Copy it before editing. |
| `provision-admin-vm.sh` | Creates the public+VPC Linode VM and firewall with the Linode API. |
| `deploy-admin.sh` | Deploys the selected release to the Admin VM, installs nginx/systemd, and starts the service. |
| `verify-admin.sh` | Runs external HTTP checks against the deployed dashboard. |
| `backup-admin-db.sh` | Pulls a sanitized SQLite backup archive from the Admin VM. |
| `../package.sh` | Builds a native Linux release bundle for CI/Object Storage handoff. |
| `../check-release.sh` | Verifies a native release bundle before upload/deploy. |

## Prerequisites

Operator machine:

- `linode-cli`
- `jq`
- `ssh` and `scp`
- a Linode API token configured for `linode-cli`
- an SSH key allowed for the Admin VM
- DNS control for the chosen hostname

Remote Admin VM:

- Ubuntu 24.04 image
- public IPv4 plus one Video Cloud VPC interface
- inbound `22/tcp` limited to operator CIDRs
- inbound `80/tcp` and `443/tcp` public for certbot and dashboard HTTPS
- outbound private VPC access to Prometheus on the Video Cloud infra VM

## 1. Prepare Local Env

```sh
export WORKSPACE=/path/to/rtk_cloud_workspace
export DEPLOY_SECRETS_DIR="$WORKSPACE/.secrets/staging/linode/admin"
mkdir -p "$DEPLOY_SECRETS_DIR"/{env,state}
cp deploy/linode/admin-staging.env.example "$DEPLOY_SECRETS_DIR/env/admin-staging.env"
$EDITOR "$DEPLOY_SECRETS_DIR/env/admin-staging.env"
```

When `DEPLOY_SECRETS_DIR` is set, the Linode scripts source
`$DEPLOY_SECRETS_DIR/env/admin-staging.env` and write/read state under
`$DEPLOY_SECRETS_DIR/state/`. The legacy `deploy/linode/*.env` and
`deploy/linode/*.state` paths remain supported for standalone repo usage. Do
not commit the copied env file. It contains deployment secrets.

## 2. Provision VM

```sh
deploy/linode/provision-admin-vm.sh
```

The script writes a local ignored state file such as:

```text
$DEPLOY_SECRETS_DIR/state/rtk-cloud-admin-staging.state
```

Create the DNS A record printed by the script before running the deploy step.

## 3. Deploy App

```sh
export WORKSPACE=/path/to/rtk_cloud_workspace
export DEPLOY_SECRETS_DIR="$WORKSPACE/.secrets/staging/linode/admin"

deploy/linode/deploy-admin.sh
```

The deploy script:

1. downloads or receives an explicit native release bundle
2. uploads the release bundle to the VM
3. installs nginx, certbot, and systemd units
4. writes `/etc/rtk_cloud_admin/admin.env`
5. stores SQLite data under `/var/lib/rtk_cloud_admin`
6. starts `rtk-cloud-admin.service`
7. optionally obtains a Let's Encrypt certificate and redirects HTTP to HTTPS

Release CI publishes native bundles to Linode Object Storage using the same
layout as the Video Cloud release flow:

```text
releases/rtk_cloud_admin-<version>/<version>.tar.gz
releases/rtk_cloud_admin-<version>/<version>.tar.gz.sha256
releases/rtk_cloud_admin-<version>/manifest.json
```
## 4. Verify

```sh
export WORKSPACE=/path/to/rtk_cloud_workspace
export DEPLOY_SECRETS_DIR="$WORKSPACE/.secrets/staging/linode/admin"

deploy/linode/verify-admin.sh
```

The verifier checks:

- `/healthz`
- `/api/service-health`
- `/console`
- platform break-glass login when bootstrap credentials are supplied

Artifacts are written to `.artifacts/linode-admin-verify/` and are not tracked.

## Backup

```sh
export WORKSPACE=/path/to/rtk_cloud_workspace
export DEPLOY_SECRETS_DIR="$WORKSPACE/.secrets/staging/linode/admin"

deploy/linode/backup-admin-db.sh
```

The backup script pulls `rtk-cloud-admin.db` and any SQLite WAL/SHM files into
`.artifacts/linode-admin-backups/` with a SHA-256 checksum.

## Security Notes

- Remote hosts never push to GitHub.
- Secrets are provided from the operator shell and copied only to
  `/etc/rtk_cloud_admin/admin.env` on the VM.
- The Admin VM joins the Video Cloud VPC only for private operator/runtime
  dependencies such as Prometheus. Do not expose Prometheus on the public
  network.
- `ADMIN_BREAK_GLASS_ENABLED=true` is acceptable for staging bootstrap. The
  production direction remains Account Manager-backed SSO.
