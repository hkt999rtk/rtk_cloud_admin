# Developer PKI Test Bundles

This document describes the Cloud Admin BFF and browser responsibilities for
RTK Certificate Bundle v1. The canonical JSON contract remains
[`docs/rtk_cloud_contracts_doc/certificate_bundle.md`](rtk_cloud_contracts_doc/certificate_bundle.md)
and its JSON Schema.

> This tool exists only for simple SDK parsing, import, mTLS, and scoped-token
> smoke tests in local or staging environments. It is not the production
> certificate issuance or provisioning flow.

## Browser and BFF flow

1. The browser generates an exportable P-256 key with WebCrypto.
2. The browser creates a PKCS#10 CSR whose subject is derived from the selected
   app or device identity.
3. The browser sends the CSR and bounded identity selectors to the BFF. It
   never sends the private key.
4. The BFF verifies the active Brand Cloud, `pki.test.issue`, owner/admin role,
   `Idempotency-Key`, environment gate, and target policy.
5. Account Manager issues app certificates. Device issuance creates a bounded
   production run and calls Factory Enrollment.
6. The BFF returns a `certificate_only` bundle with `caller_managed` key
   material and `Cache-Control: no-store`.
7. The browser locally changes the profile to `test_exportable`, embeds the
   unencrypted PKCS#8 PEM, validates key/certificate matching, and downloads
   the bundle.

The endpoints are:

- `POST /api/developer/pki/test-bundles/app`
- `POST /api/developer/pki/test-bundles/device`

Both return
`application/vnd.realtek.rtk-certificate-bundle+json`. Certificate lifetime is
fixed at 30 days and is not user-configurable.

## Security boundary

- Enable with `DEVELOPER_PKI_TEST_TOOLS_ENABLED=true` only in local/staging.
- `CLOUD_ADMIN_ENV=production` or `prod` always disables the endpoints.
- App subject and SAN policy is owned by Account Manager; arbitrary subjects
  are rejected.
- Device issuance requires an active device item profile in the active Brand
  Cloud and calls Factory Enrollment over an explicitly allowed private
  service path.
- Audit events contain request ids, target ids, hashes, and TTL metadata only.
  They must not contain CSR PEM, certificate PEM, private keys, session tokens,
  factory JWTs, or login credentials.
- Private keys must not be placed in HTTP bodies, localStorage, analytics, or
  logs. Downloaded test bundles are handled as secrets.

## Production distinction

Production keys remain non-exportable and caller/device managed. Formal
manufacturing enrollment, app bootstrap, rotation, revocation, hardware-backed
storage policy, and attestation are separate flows. Passing this tool's SDK
smoke test is not production identity or manufacturing approval.
