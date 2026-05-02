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
2. Prune the Docker build cache with `docker builder prune -af`.
3. Remove any stale local CI image with `docker image rm rtk-cloud-admin:ci`.
4. Rerun the workflow from GitHub.
