# CI Environment Notes

The GitHub Actions CI workflow runs on GitHub-hosted `ubuntu-latest`.
It builds the Go server, builds the React frontend, and runs native smoke
checks against the built server binary.

## Required Secrets

CI initializes the private `rtk_cloud_contracts_doc` submodule over HTTPS.
Configure a repository or organization secret named `CONTRACTS_REPO_TOKEN` with
read access to `hkt999rtk/rtk_cloud_contracts_doc`.

If CI fails before Go or Node setup with `Missing CONTRACTS_REPO_TOKEN`, add or
repair that secret and rerun the workflow.

## Quick Health Checks

Use the GitHub Actions run page to verify:

- the job is assigned to `ubuntu-latest` instead of waiting for a repository
  runner
- the contracts submodule initialization step succeeds
- the Go, frontend, and native smoke steps finish with the expected checks

```sh
gh run list --workflow ci --limit 10
gh run view <run-id> --log
```

## Recovery

If CI is queued for more than a few minutes, verify the workflow still uses
`runs-on: ubuntu-latest` and rerun the workflow from GitHub.

If smoke checks fail, reproduce locally:

```sh
go build -o /tmp/rtk-cloud-admin ./cmd/server
PORT=18080 \
  DATABASE_PATH=/tmp/ci.db \
  ADMIN_BOOTSTRAP_EMAIL=admin@example.com \
  ADMIN_BOOTSTRAP_PASSWORD=secret \
  ADMIN_BREAK_GLASS_ENABLED=true \
  /tmp/rtk-cloud-admin
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/api/service-health
```
