# Video Cloud Staging E2E

This local-only validation connects `rtk_cloud_admin` to Video Cloud staging and
runs deeper API and browser checks than the mocked WebUI smoke test.

The test is intentionally not part of default CI because it depends on local
operator certificate material and real staging data.

## Required Local Files

Copy the admin client material from the sibling Video Cloud repo:

```sh
mkdir -p keys
cp ../rtk_video_cloud/keys/admin-client.ed25519.cert.pem keys/
cp ../rtk_video_cloud/keys/admin-client.ed25519.key.pem keys/
cp ../rtk_video_cloud/keys/admin-client-root-ca.ed25519.cert.pem keys/
chmod 600 keys/admin-client.ed25519.key.pem
```

Only `keys/README.md` should be tracked by git. The certificate, private key,
and generated token must remain local.

## Command

```sh
VIDEO_CLOUD_BASE_URL=https://video-cloud-staging.realtekconnect.com \
./scripts/local_video_cloud_e2e.sh
```

Useful overrides:

```sh
E2E_ORG_ID=org-acme
E2E_ACCOUNT_DEVICE_1=dev-001
E2E_VIDEO_DEVICE_1=device-1
E2E_ACCOUNT_DEVICE_2=dev-002
E2E_VIDEO_DEVICE_2=device-2
E2E_PORT=19082
E2E_KEEP_TMP=1
```

## What It Checks

- Bootstraps a runtime-only Video Cloud admin bearer token with the local admin
  client certificate.
- Builds the WebUI and starts a local Admin BFF with:
  - `VIDEO_CLOUD_BASE_URL`
  - runtime `VIDEO_CLOUD_ADMIN_TOKEN`
  - local platform break-glass credentials
  - temporary SQLite database
- Verifies:
  - `/healthz`
  - `/api/service-health` reports Video Cloud `ok`
  - platform break-glass login and `/api/me.kind == platform_admin`
  - customer-safe `/api/devices`
  - `/api/devices/{id}/telemetry` has `telemetry_status == available`
  - `/api/fleet/firmware-distribution` has `source_status == available`
  - `/api/fleet/stream-stats?window=7d|30d` has `source_status == available`
  - live browser flows for Overview, Devices drawer, Firmware & OTA, Stream
    Health, and Platform Operations

Screenshots are written under `.artifacts/live-video-cloud-e2e/`.

## Failure Triage

- Token bootstrap failure: check `keys/` material, Homebrew curl/OpenSSL 3, and
  Video Cloud edge client certificate forwarding.
- Service health failure: check `VIDEO_CLOUD_BASE_URL`, TLS, and Video Cloud
  `/healthz`.
- Telemetry/firmware/stream unavailable: check staging data for the configured
  `video_cloud_devid` values and the corresponding Video Cloud BFF endpoints.
- Browser failure: inspect screenshots in `.artifacts/live-video-cloud-e2e/`
  and console output from the script.

The script hard-fails unavailable telemetry, firmware, and stream sources so
staging gaps are visible before Linode deployment.
