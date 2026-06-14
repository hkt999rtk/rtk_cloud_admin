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
E2E_DIAGNOSTICS=1
E2E_FIRMWARE_MODEL=RTK-CAM-A
E2E_PORT=19082
E2E_KEEP_TMP=1
```

## What It Checks

- Bootstraps a runtime-only Video Cloud admin bearer token with the local admin
  client certificate.
- Builds the WebUI and starts a local Admin BFF with:
  - `VIDEO_CLOUD_BASE_URL`
  - runtime `VIDEO_CLOUD_ADMIN_TOKEN`
  - Account Manager platform-admin credentials
  - temporary SQLite database
- Verifies:
  - `/healthz`
  - `/api/service-health` reports Video Cloud `ok`
  - Account Manager-backed platform login and `/api/me.kind == platform_admin`
  - customer-safe `/api/devices`
  - `/api/devices/{id}/telemetry` has `telemetry_status == available`
  - `/api/fleet/firmware-distribution` has `source_status == available`
  - `/api/fleet/stream-stats?window=7d|30d` has `source_status == available`
  - live browser flows for Overview, Devices drawer, Firmware & OTA, Stream
    Health, and Platform Operations

Screenshots are written under `.artifacts/live-video-cloud-e2e/`.
The script also writes a redacted summary report to
`.artifacts/live-video-cloud-e2e/report.json`. The report records the fixture
ids, pass/fail matrix, source status/source message, upstream diagnostic
summaries when enabled, and browser screenshot directory. It must not contain
bearer tokens, private keys, certificate bodies, or raw sensitive upstream
payloads.

## Upstream Diagnostics

Set `E2E_DIAGNOSTICS=1` to add direct Video Cloud probes before the BFF live
source assertions. Diagnostics use the runtime admin bearer token but only
write redacted summaries:

- `GET /api/devices/{devid}/telemetry?org_id=...`
- `GET /api/fleet/stream-stats?org_id=...&window=7d|30d&devices=...`
- `POST /enum_firmware`
- `POST /query_firmware_rollout`
- `POST /query_firmware_campaign`

Diagnostic status values distinguish `auth_failed`, `not_found`,
`source_unavailable`, `empty_data`, `unexpected_schema`, and successful `ok`
responses. Use these entries to decide whether the failure is in Admin BFF
mapping or Video Cloud staging data/API readiness.

## Current Validation Coverage

Validated before a known-good fixture exists:

- admin client certificate can bootstrap a `scope=admin` bearer token
- local Admin BFF starts with the runtime token
- `/healthz` and `/api/service-health` reach Video Cloud
- Account Manager-backed platform login and local customer session work
- `/api/devices` returns customer-safe fields and omits platform-only ids

Blocked until a known-good provisioned/activated Video Cloud staging device
exists:

- device telemetry available path
- RSSI / uptime / recent telemetry event mapping
- active stream status from source data
- firmware distribution / rollout / campaign mapping
- stream stats for `7d` and `30d`
- live browser Overview, Devices drawer, Firmware & OTA, and Stream Health
  checks against non-demo source data

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

## Known-Good Fixture Contract

Admin WebUI E2E needs a fixed, production-like Video Cloud staging fixture. It
does not need a full production onboarding run or a physical camera unless the
test scope expands to transport/WebRTC pipeline validation.

Required fixture facts:

- fixed org id, default `org-acme`
- fixed account-device to Video Cloud device mapping, default
  `dev-001 -> device-1` and `dev-002 -> device-2`
- provisioned/activated Video Cloud device records for the mapped device ids
- telemetry samples sufficient for health, RSSI, uptime, and recent events
- firmware version, rollout, and campaign facts for the configured model
- stream stats for both `7d` and `30d`

Fixture creation should live in `rtk_video_cloud` as a staging seed or
maintenance flow because Video Cloud owns the telemetry, firmware, activation,
and stream data models. `rtk_cloud_admin` only consumes the resulting fixture
through the documented admin/customer-safe APIs.

As of the first local run, the default `dev-001 -> device-1` mapping reaches
the Admin BFF telemetry assertion but returns `telemetry_status=unavailable`;
that is the current staging fixture blocker.
