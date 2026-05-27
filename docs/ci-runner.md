# CI Runner Notes

The GitHub Actions workflow runs on the self-hosted `rtk-cloud-admin-ci`
runner. The current pipeline is intentionally local-only: it builds the Go
server, builds the React frontend, and runs native smoke checks against the
built server binary.

## Quick Health Checks

On the runner host, verify:

- the runner service is still connected to GitHub
- the workspace has enough free disk space for Go, npm, and release artifacts
- the last workflow run finished with the expected native smoke checks

Useful commands:

```sh
df -h
systemctl status actions.runner.hkt999rtk-rtk_cloud_admin.rtk-ci-cloud-admin.service
```

## Recovery

If the runner gets stuck or disk usage climbs too high:

1. Restart the runner service on `cloud-admin-ci.local`.
2. Check current runner state:
   - `df -h`
   - `ps aux | grep rtk-cloud-admin`
   - `systemctl status actions.runner.hkt999rtk-rtk_cloud_admin.rtk-ci-cloud-admin.service`
3. Remove stale local CI work directories if disk usage is high.
4. Restart the runner service if needed:
   - `sudo systemctl restart actions.runner.hkt999rtk-rtk-cloud-admin-ci-1.service`
5. Rerun the workflow from GitHub.
6. If smoke checks fail again, reproduce locally:
   - `go build -o /tmp/rtk-cloud-admin ./cmd/server`
   - `PORT=18080 DATABASE_PATH=/tmp/ci.db /tmp/rtk-cloud-admin`
   - `curl http://127.0.0.1:18080/healthz`
   - `curl http://127.0.0.1:18080/api/service-health`
   - `curl -X POST http://127.0.0.1:18080/api/auth/platform/login` after
     setting `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, and
     `ADMIN_BREAK_GLASS_ENABLED=true`
   - `curl http://127.0.0.1:18080/api/me` after replaying the login cookie
   - `curl http://127.0.0.1:18080/api/summary`
   - `curl http://127.0.0.1:18080/console`
