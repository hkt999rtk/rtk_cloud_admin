# CI Environment Notes

The GitHub Actions CI workflow runs on GitHub-hosted `ubuntu-latest`.
It builds the Go server, builds the React frontend, and runs native smoke
checks against the built server binary.

## Required Secrets

CI checks out the private `rtk_cloud_contracts_doc` repository adjacent to this
repository when `CONTRACTS_REPO_TOKEN` is configured. The checked-in
`docs/rtk_cloud_contracts_doc` symlink resolves to that checkout. Configure a
repository or organization secret named `CONTRACTS_REPO_TOKEN` with read access to
`hkt999rtk/rtk_cloud_contracts_doc` when a CI job needs contract file contents.

If `CONTRACTS_REPO_TOKEN` is missing, CI skips the private contracts checkout
and continues with repo-local tests.

## Quick Health Checks

Use the GitHub Actions run page to verify:

- the job is assigned to `ubuntu-latest` instead of waiting for a repository
  runner
- the workspace contracts checkout step either succeeds or is skipped
  with the expected warning
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
  ACCOUNT_MANAGER_BASE_URL=http://127.0.0.1:18081 \
  /tmp/rtk-cloud-admin
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/api/service-health
```
