# Linode Admin Dashboard Deployment

This directory contains the operator-local deployment scripts for running
`rtk_cloud_admin` on a dedicated Linode VM.

The Admin VM is intentionally independent from the `rtk_video_cloud` Linode VPC:

- one dedicated public Linode VM
- no VPC interface
- no dependency on the Video Cloud edge VM as a gateway
- public HTTPS to Account Manager and Video Cloud upstreams
- local SQLite persisted on the Admin VM

## Target Shape

```text
internet
  -> admin.video-cloud-staging.realtekconnect.com:443
  -> nginx on the Admin VM
  -> rtk_cloud_admin container on 127.0.0.1:8080

rtk_cloud_admin
  -> ACCOUNT_MANAGER_BASE_URL over public HTTPS
  -> VIDEO_CLOUD_BASE_URL over public HTTPS
```

This is the same operator-local deployment model used by the Video Cloud Linode
tooling: CI builds/test artifacts; a trusted operator machine performs Linode
mutation and host deployment with local secrets.

## Files

| File | Purpose |
| --- | --- |
| `admin-staging.env.example` | Local operator env template. Copy it before editing. |
| `provision-admin-vm.sh` | Creates the public-only Linode VM and firewall with `linode-cli`. |
| `deploy-admin.sh` | Builds the Docker image locally or uses `ADMIN_LINODE_RELEASE_BUNDLE`, uploads it, installs nginx/systemd, and starts the service. |
| `verify-admin.sh` | Runs external HTTP checks against the deployed dashboard. |
| `backup-admin-db.sh` | Pulls a sanitized SQLite backup archive from the Admin VM. |

## Prerequisites

Operator machine:

- `linode-cli`
- `jq`
- `docker`
- `ssh` and `scp`
- a Linode API token configured for `linode-cli`
- an SSH key allowed for the Admin VM
- DNS control for the chosen hostname

Remote Admin VM:

- Ubuntu 24.04 image
- public IPv4 only
- inbound `22/tcp` limited to operator CIDRs
- inbound `80/tcp` and `443/tcp` public for certbot and dashboard HTTPS

## 1. Prepare Local Env

```sh
cp deploy/linode/admin-staging.env.example deploy/linode/admin-staging.env
$EDITOR deploy/linode/admin-staging.env
set -a
. deploy/linode/admin-staging.env
set +a
```

Do not commit the copied env file. It contains deployment secrets.

## 2. Provision VM

```sh
deploy/linode/provision-admin-vm.sh
```

The script writes a local ignored state file such as:

```text
deploy/linode/rtk-cloud-admin-staging.state
```

Create the DNS A record printed by the script before running the deploy step.

## 3. Deploy App

```sh
set -a
. deploy/linode/admin-staging.env
. deploy/linode/rtk-cloud-admin-staging.state
set +a

deploy/linode/deploy-admin.sh
```

The deploy script:

1. builds `rtk-cloud-admin:<release>` locally, unless `ADMIN_LINODE_RELEASE_BUNDLE` points at a prebuilt release archive
2. uploads a Docker image archive to the VM
3. installs Docker, nginx, certbot, and systemd units
4. writes `/etc/rtk_cloud_admin/admin.env`
5. stores SQLite data under `/var/lib/rtk_cloud_admin`
6. starts `rtk-cloud-admin.service`
7. optionally obtains a Let's Encrypt certificate and redirects HTTP to HTTPS

To deploy a CI-built release artifact instead of building locally:

```sh
ADMIN_LINODE_RELEASE=v1.2.3 \
ADMIN_LINODE_RELEASE_BUNDLE="$PWD/dist/rtk_cloud_admin-v1.2.3.tar.gz" \
deploy/linode/deploy-admin.sh
```

The release bundle must be named `rtk_cloud_admin-<version>.tar.gz` and contain
the Docker image tag `rtk-cloud-admin:<version>`.

## 4. Verify

```sh
set -a
. deploy/linode/admin-staging.env
. deploy/linode/rtk-cloud-admin-staging.state
set +a

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
set -a
. deploy/linode/admin-staging.env
. deploy/linode/rtk-cloud-admin-staging.state
set +a

deploy/linode/backup-admin-db.sh
```

The backup script pulls `rtk-cloud-admin.db` and any SQLite WAL/SHM files into
`.artifacts/linode-admin-backups/` with a SHA-256 checksum.

## Security Notes

- Remote hosts never push to GitHub.
- Secrets are provided from the operator shell and copied only to
  `/etc/rtk_cloud_admin/admin.env` on the VM.
- The Admin VM does not join the Video Cloud VPC and must not call private
  `10.42.x.x` service addresses.
- `ADMIN_BREAK_GLASS_ENABLED=true` is acceptable for staging bootstrap. The
  production direction remains Account Manager-backed SSO.
