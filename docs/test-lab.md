# Developer Console Cloud Test Lab

This feature belongs to the authenticated Developer Console, not the documentation
site. Select a Brand Cloud and Product, then a bound test device using your current
Console login. No second account/password is needed. Device identity is unchanged.

## Test account, Bind and Unbind

1. Console login automatically resolves a stable internal App test identity by
   developer user ID, never by email. No second password or Authorize button is
   used. The browser renews cloud-scoped access automatically while open; every
   operation still checks current developer permissions. Existing ordinary App
   accounts and their bindings are not adopted or changed.
2. Create test device prepares a JSON credential file in an explicit download
   panel. Use the persistent download link, or Save file… in supporting browsers.
   Links remain usable while this Product page stays open; retrying does not issue
   another device or key. Save the private key and certificate and install them on
   the test board/client. Browser download requests are not proof of a saved file;
   confirm the file yourself (the file picker can confirm a completed write).
   Pending files live only in page memory, not localStorage or backend storage,
   and are cleared on Product change or unmount. Refresh/close warns about files
   not confirmed saved. After leaving, there is no server-side private-key
   retention or re-download. Existing eligible
   test devices can also be bound without uploading their private keys.
3. Bind device lists only unbound devices with a completed Developer Console test
   factory issuance record for this Product. A short-lived, one-use grant records
   the developer's approval. This dev test flow does not override production claim
   tokens or adopt arbitrary registry devices. Devices bound to another user
   cannot be taken over.
4. Bound devices distinguishes binding, cloud provisioning and connection state.
   Provision queues the existing lifecycle operation. It requires an activity ID
   and RSA clip-encryption public key, separate from the device TLS key. Browser
   key generation downloads the private key locally; only the public key is sent.
   On failure, retry with the original activity ID and public key from that file.
   Provision success does not prove the physical device is online.
5. Unbind removes only this end-user's binding and revokes its test access. It
   does not delete or deactivate the device, revoke certificates, or remove other
   users. It is blocked while provisioning is pending. Rebind requires a fresh
   grant; a retained activated device does not need provisioning again.

The bound list is refreshed every 10 seconds; each runtime request independently
rechecks authorization. Other tabs stop on their next check. Unbind clears this
page's selected device and local transports. MQTT Unsubscribe and WebRTC Stop
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
- Native WebRTC uses recvonly video, server ICE policy and existing signaling.
  Playback success requires decoded video frames; stats include bitrate and ICE
  candidate type. Stopping, changing device or leaving the viewer closes the local
  peer. A viewer test stops after 85 seconds.
- Exported diagnostics allowlist operation/status/timing fields. Credentials,
  payloads, SDP and ICE addresses are not exported.

## Configuration and access

Cloud Admin requires `CLOUD_ADMIN_TEST_LAB_ENABLED=true`, a non-production
`CLOUD_ADMIN_ENV`, `CLOUD_ADMIN_TEST_LAB_MQTT_URL` (WSS),
`CLOUD_ADMIN_TEST_LAB_MQTT_BACKEND` (internal HTTP WebSocket endpoint), and
`VIDEO_CLOUD_BASE_URL`. Account Manager and Video Cloud both require
`TEST_LAB_ENABLED=true` and an allowed dev/local/staging environment.
The deployment renderer exposes this only for explicitly enabled dev/staging stacks.

An authenticated developer with device-management permission creates a five-minute
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
- `POST /brand-clouds/{cloud}/test-lab/sessions/{session}/{action}`
  where action is `credentials`, `shadow`, `ice`, `offer`, `answer`, `stop`, `close`.
  Shadow body: `{name, operation, payload?}`; offer body: `{offer:{type,sdp}}`;
  other actions use `{}`. The client cannot select an upstream host or device.
- `GET /test-lab/mqtt`: authenticated same-origin WebSocket transport only.

Runtime requires an enabled Product service, active test-account authorization,
an active binding and successful provisioning. Device simulation, talkback,
recording and load testing are not included.

## Verification

Run Go app/config/accountclient tests, `npm test`, `npm run build`, and the isolated
Chromium `web/e2e/test-lab.spec.mjs` test. The browser fixture verifies scope/UI and
disabled-runtime behavior; it is not evidence of live MQTT or decoded camera video.
Live dev acceptance must separately cover login, a permitted device, MQTT roundtrip,
Shadow accepted/rejected responses, WebRTC first decoded frame and cleanup.
