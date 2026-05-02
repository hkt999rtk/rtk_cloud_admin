# CI Runner Notes

The GitHub Actions workflow runs on the self-hosted `rtk-cloud-admin-ci`
runner. The current pipeline is intentionally local-only: it builds the Go
server, builds the React frontend, builds a Docker image, and runs container
smoke checks against the built image.

The workflow does not push images to a registry. It tags the image as
`rtk-cloud-admin:ci` for the duration of the run and then removes the image and
build cache so the runner disk does not grow without bound.

## Quick Health Checks

On the runner host, verify:

- the runner service is still connected to GitHub
- Docker is available and has free disk space
- the last workflow run finished with the expected smoke checks

Useful commands:

```sh
docker ps
docker system df
docker info
```

## Recovery

If the runner gets stuck or disk usage climbs too high:

1. Restart the runner service on `cloud-admin-ci.local`.
2. Check current runner/container state:
   - `docker ps -a`
   - `docker images | head`
   - `docker system df`
3. Prune stale local CI artifacts:
   - `docker image rm rtk-cloud-admin:ci`
   - `docker image prune -af`
   - `docker builder prune -af`
4. Prune and restart the runner service if needed:
   - `sudo systemctl restart actions.runner.hkt999rtk-rtk-cloud-admin-ci-1.service`
5. Rerun the workflow from GitHub.
6. If smoke checks fail again, reproduce locally:
   - `docker run --rm -p 18080:8080 -e DATABASE_PATH=/tmp/ci.db rtk-cloud-admin:ci`
   - `curl http://127.0.0.1:18080/healthz`
   - `curl http://127.0.0.1:18080/api/summary`
   - `curl http://127.0.0.1:18080/console`
