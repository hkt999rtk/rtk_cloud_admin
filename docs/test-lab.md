# Developer Console Cloud Test Lab

This feature belongs to the authenticated Developer Console, not the documentation
site. Select a Brand Cloud and Product, then a test device using your current
Console login. No second account/password is needed. Device identity is unchanged.

## Page workflow

Brand Cloud and Product selectors stay above two top-level tabs. **Devices &
credentials** opens by default and contains device issuance, credential downloads,
binding, provisioning/activation, unbinding, and retirement. Each row shows the
next required step when its test device is not ready. A bound, activated device
offers **Test this device**, which selects it and opens **Run tests**. The Run tests
tab is always available, but without a selected device it shows guidance to choose
and activate one; it does not request live runtime credentials. Its header shows
the selected device, environment, and readiness below the Cloud and Product scope,
with **Change device** returning
to Devices & credentials. MQTT, Shadow, and WebRTC are second-level tabs inside Run
tests; diagnostic history and report download also live there. An offline device
has its own status because being offline does not mean its authorization failed.

Switching top-level tabs keeps the device-management state mounted, including
credential files held only in page memory. The Devices & credentials tab flags
unconfirmed files until they are explicitly marked saved; switching tabs does not
mark them saved. Leaving an active Run tests connection asks for confirmation.
Confirming closes local MQTT and WebRTC connections and invalidates pending live
actions; cancelling stays in Run tests. Changing Product during an active
connection asks for confirmation too; cancelling keeps the Product and session.
Confirming a Product change, unbinding, or retiring the selected device clears its
test scope and closes those connections. **Reload devices & access** remains
available during device setup, including when the Product list initially fails. A link
with `product_id` and `device_id` selects that device and opens Run tests only if
it is eligible, bound, and activated. Otherwise it opens Devices & credentials
and explains the next required step.

## Test account, Bind and Unbind

1. Console login automatically resolves a stable internal App test identity by
   developer user ID, never by email. No second password or Authorize button is
   used. The browser renews cloud-scoped access automatically while open; every
   operation still checks current developer permissions. Existing ordinary App
   accounts and their bindings are not adopted or changed.
2. Creating one test device requests a ZIP credential bundle. It contains
   `device.key`, `device.crt`, `certificate-chain.pem`, the original
   `certificate-bundle.json`, and an installation note. The existing API defaults
   to JSON unless the caller requests ZIP. The download card receives focus after
   creation; the device row links back to it. Repeating the download from this
   card does not issue another device or key. Save the private key and certificate and install them on
   the test board/client. Browser download requests are not proof of a saved file;
   confirm the file yourself (the file picker can confirm a completed write).
   Pending files live only in page memory, not localStorage or backend storage,
   and survive tab, Product, and language changes while this page remains mounted.
   Refresh/close warns about files not confirmed saved. After leaving, there is no server-side private-key
   retention or re-download. If the file is lost, safely retire the old device
   and create a new one. Existing eligible
   test devices can also be bound without uploading their private keys.
3. Bind device lists only unbound devices with a completed Developer Console test
   factory issuance record for this Product. A short-lived, one-use grant records
   the developer's approval. This dev test flow does not override production claim
   tokens or adopt arbitrary registry devices. Devices bound to another user
   cannot be taken over.
4. The device list includes every test-issued device in this Product, including
   unbound and retired devices. It distinguishes binding, cloud provisioning,
   connection and retirement state. The selected device appears in the Run tests
   header above the MQTT, Shadow and WebRTC tools. Changing selection stops old
   connections and clears old test results.
   Provision queues the existing lifecycle operation. It requires an activity ID
   and RSA clip-encryption public key, separate from the device TLS key. Browser
   key generation downloads the private key locally; only the public key is sent.
   On failure, retry with the original activity ID and public key from that file.
   Provision success does not prove the physical device is online.
5. Unbind removes only this end-user's binding and revokes its test access. It
   does not delete or deactivate the device, revoke certificates, or remove other
   users. It is blocked while provisioning is pending. Rebind requires a fresh
   grant; a retained activated device does not need provisioning again.
6. Safe retirement requires product/device management authority and an operation
   ID. Account Manager immediately blocks new Test Lab operations, revokes every
   test binding and lease, and records an audit event. Video Cloud then revokes
   the device entitlement and certificate and evicts its connection. A failed
   cross-service step remains visible and can be retried with the same operation
   ID. Completed retirement cannot be reversed by binding again. The row remains
   as a read-only record; audit history is retained.

The bound list is refreshed every 10 seconds; each runtime request independently
rechecks authorization. If access changes, live actions become unavailable on the
next check. Unbind clears this page's selected device and local transports. MQTT Unsubscribe and WebRTC Stop
playback retain their separate meanings; there is no global test-session button.
Certificate expiry remains in the downloaded certificate, not an inferred UI date.

## Runtime

- MQTT.js connects over same-origin WSS to the opt-in EMQX test listener. Device
  commands use QoS 1 without retain; acceptance means broker acceptance, not device
  execution. Reconnection restores subscriptions only; commands are never replayed.
- Shadow supports HTTP and MQTT get/update/delete, including named shadows. Only
  desired state is editable. MQTT subscribes before publishing and correlates
  accepted/rejected responses. Shadow is included with MQTT-enabled device
  integration; there is no separate `iot_shadow` Product service. Incoming topics
  may include the broker's `_bc/<cloud>/` mountpoint; only the selected Cloud and
  device are normalized/accepted. Internal routing prefixes are not shown as
  developer-facing topics.
- Live mutations and starting playback use a page-level Continue/Cancel
  confirmation. Cancel sends no request; a changed device scope invalidates a
  pending confirmation.
- WebRTC requests recvonly video and sendrecv Opus audio on one PeerConnection,
  using the server ICE policy and existing signaling. The browser requests
  microphone access only after the developer presses Enable microphone. Speaker,
  device audio, and microphone have separate status; denial or unavailable audio
  leaves video usable. An older device that rejects the audio offer gets one
  video-only retry. Playback success requires decoded video frames; diagnostics
  show bitrate, ICE candidate type, and audio packet counts. The viewer reconnects
  before each 90-second media session expires, and stops after at most 10 minutes.
  Stopping, changing device or leaving the viewer closes the local peer.
- Exported diagnostics allowlist operation/status/timing fields. Credentials,
  payloads, SDP and ICE addresses are not exported.

## Configuration and access

Cloud Admin requires `CLOUD_ADMIN_TEST_LAB_ENABLED=true`, a non-production
`CLOUD_ADMIN_ENV`, `CLOUD_ADMIN_TEST_LAB_MQTT_URL` (WSS),
`CLOUD_ADMIN_TEST_LAB_MQTT_BACKEND` (internal HTTP WebSocket endpoint), and
`VIDEO_CLOUD_BASE_URL`. Account Manager and Video Cloud both require
`TEST_LAB_ENABLED=true` and an allowed dev/local/staging environment.
The deployment renderer exposes this only for explicitly enabled dev/staging stacks.

An authenticated developer with device-management permission creates an 11-minute
lease scoped to one cloud/product/device; at most three active leases per user.
Account Manager rechecks device access when credentials are requested. Video Cloud
checks the lease on HTTP calls and MQTT connection authentication. Thirty-second
test tokens cannot be refreshed and are restricted to the selected device/services.
The BFF retains no runtime credentials; AWS signing stays server-side.

Established MQTT connections expire within the token lifetime (30 seconds); lease
revocation is not an instantaneous broker disconnect. Browser renewal has a brief
subscription gap and messages may be missed. Signaling close is not a guarantee
that a remote media peer has terminated; local viewer cleanup is explicit.

Limits: 8 KiB application payload, 10 KiB broker packet, 32 broker subscriptions,
100 test-listener connections, 10 BFF actions/second/lease. These are interactive
test limits, not a load-test or global MQTT message-rate enforcement mechanism.

## BFF API

All paths below are under `/api/developer`. Responses use `Cache-Control: no-store`.

- `GET /brand-clouds/{cloud}/test-lab/context?product_id=...&device_id=...&account_id=...`
- `POST /brand-clouds/{cloud}/test-lab/sessions` with `product_id`, `device_id`, `account_id`
- `/brand-clouds/{cloud}/test-lab/manage/...` proxies the documented Account
  Manager test-account and device-binding routes; all mutations are same-origin.
- `POST /brand-clouds/{cloud}/test-lab/manage/devices/{device}/retire` accepts
  `{account_id,product_id,operation_id}` and returns the retirement status.
- `POST /brand-clouds/{cloud}/test-lab/sessions/{session}/{action}`
  where action is `credentials`, `shadow`, `ice`, `offer`, `answer`, `stop`, `close`.
  Shadow body: `{name, operation, payload?}`; offer body: `{offer:{type,sdp}}`;
  other actions use `{}`. The client cannot select an upstream host or device.
- `GET /test-lab/mqtt`: authenticated same-origin WebSocket transport only.

Runtime requires an enabled Product service, active test-account authorization,
an active binding and successful provisioning. Device simulation, recording and
load testing are not included.

## Verification

Run Go app/config/accountclient tests, `npm test`, `npm run localization:check`,
`npm run build`, and the isolated Chromium `web/e2e/test-lab.spec.mjs` test. The
browser fixture verifies both tab levels, keyboard and mobile navigation, device
readiness and deep links, credential persistence across tabs, and disabled-runtime
behavior; it is not evidence of live MQTT, decoded camera video, or physical
two-way audio.
Live dev acceptance must separately cover login, a permitted device, MQTT roundtrip,
Shadow accepted/rejected responses, WebRTC first decoded frame, Opus in both
directions, speaker/AEC behavior, 10-minute playback and cleanup.
