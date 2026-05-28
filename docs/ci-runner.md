# CI Runner Notes

The GitHub Actions workflow runs on the self-hosted `rtk-cloud-admin-ci`
runner. The current pipeline is intentionally artifact-only: it builds the Go
server, builds the React frontend, creates a native Linux release tarball, and
checks the Linode deploy script against that native bundle format.

The workflow does not push images or deploy to Linode. Release artifacts are
uploaded only by the release workflow.

## Quick Health Checks

On the runner host, verify:

- the runner service is still connected to GitHub
- Go and Node.js are available through the workflow setup actions
- the last workflow run finished with the release artifact check

Useful commands:

```sh
df -h
du -sh "$RUNNER_WORKSPACE" 2>/dev/null || true
```

## Recovery

If the runner gets stuck or disk usage climbs too high:

1. Restart the runner service on `cloud-admin-ci.local`.
2. Check current runner workspace disk usage.
3. Prune stale local CI work directories and temporary artifacts.
4. Restart the runner service if needed:
   `sudo systemctl restart actions.runner.hkt999rtk-rtk-cloud-admin-ci-1.service`
5. Rerun the workflow from GitHub.
6. If release artifact checks fail again, reproduce locally:

```sh
deploy/test-release-artifacts.sh
```
