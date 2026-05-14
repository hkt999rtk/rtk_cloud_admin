# Local Video Cloud Admin Certificate Material

This directory is for operator-local certificate material used by
`rtk_cloud_admin` when bootstrapping or validating access to Video Cloud
staging.

Only this README is intended to be tracked by git. Private keys, generated
certificates, CSRs, serial files, tokens, and rendered secret material must stay
local.

## Expected Local Files

Copy these files from `../rtk_video_cloud/keys/`:

```text
admin-client.ed25519.cert.pem
admin-client.ed25519.key.pem
admin-client-root-ca.ed25519.cert.pem
```

`admin-client.ed25519.key.pem` should be mode `0600`.

## Staging Admin Token Bootstrap

Use Homebrew curl on macOS because the system curl may not support Ed25519
client certificates:

```sh
/opt/homebrew/opt/curl/bin/curl \
  --cert keys/admin-client.ed25519.cert.pem \
  --key keys/admin-client.ed25519.key.pem \
  -H 'Content-Type: application/json' \
  -d '{"scope":"admin","expiry":3600}' \
  https://video-cloud-staging.realtekconnect.com/request_token
```

The returned `access_token` is the value to pass to this service as
`VIDEO_CLOUD_ADMIN_TOKEN`. Do not commit or log the token.

## Runtime Use

```sh
VIDEO_CLOUD_BASE_URL=https://video-cloud-staging.realtekconnect.com
VIDEO_CLOUD_ADMIN_TOKEN=<redacted>
```

The Admin BFF sends the token to Video Cloud as:

```http
Authorization: Bearer <VIDEO_CLOUD_ADMIN_TOKEN>
```

## Notes

- The admin client certificate subject is expected to be `CN=Video Cloud Admin`.
- Video Cloud staging must trust `admin-client-root-ca.ed25519.cert.pem` at the
  edge and forward verified client certificate identity to the API.
- Never copy CA private keys into this repository.
