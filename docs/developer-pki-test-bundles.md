# Developer PKI Test Bundles

## Accepted Target: Customer Test Device Provisioning

Status: accepted design, updated 2026-09-04; implementation pending. This section
supersedes the device workflow in the implementation baseline below. The app
test-certificate workflow remains unchanged.

### Customer experience and shared core

The customer selects an active Brand Cloud and product/device profile and clicks
**Create test device**. The service must:

1. Authenticate the requester and enforce owner/admin role, `pki.test.issue`,
   tenant isolation, active profile, feature policy, quota, and rate limits.
2. Automatically allocate a unique Device ID through the existing manufacturing
   allocator. Do not introduce a separate test numbering scheme or client IDs.
3. Generate a unique P-256 private key and PKCS#10 CSR on the server, binding the
   CSR identity to the allocated Device ID.
4. Reuse the existing issuer, Factory Enrollment trust boundary, and authoritative
   device registration services. Automatically create a bounded one-device test
   run if required internally; never expose factory JWTs to customers.
5. Complete the required activation/service setup for the selected profile and
   validate the key/certificate match, chain, tenant, identity, and validity.
6. Provide the allocated Device ID, readiness and expiry information, and an
   authenticated download of the test package in the creation response only.

Customers must not supply a Device ID, private key, CSR, serial number, or
manufacturing configuration. Assign any internally required serial automatically.
The customer bypasses manufacturing operations, not authorization or registration.
Normal account binding, entitlements, and scoped-token rules still apply.
Readiness means cloud setup is complete, not that a physical device is online.

### Download package and private-key custody

Include Device ID, PKCS#8 private key, device certificate, certificate chain,
required CA trust material, SDK connection settings, and brief import instructions.
A CSR is optional diagnostic material, not a runtime connectivity requirement.
Keep settings/instructions and any CSR outside the strict existing certificate
bundle JSON unless a versioned contract explicitly supports them. Packaging
format and exact API schema are implementation design items, not defined here.

Use TLS, tenant-scoped authenticated downloads, and `Cache-Control: no-store`.
Do not retain private material for customer re-download. The creation response
is the only download opportunity; there is no 24-hour or 30-day download window.
Any internal material needed to complete an in-flight operation must not become
a recovery/download endpoint and must be cleared when processing ends. Preserve only
non-secret operation/audit metadata. Never put private keys, CSR/certificate PEM,
tokens, or download secrets in logs, analytics, or browser local/session storage.
Never include issuer/CA private keys or factory/service credentials in downloads.

Customers must save the creation download immediately. If files are lost, an
explicit new Create request allocates new Device IDs, keys, and certificates;
it does not recover old keys, reuse the lost identity, revoke the old certificate,
or release its quota automatically. Existing revocation and quota rules apply.
Server deletion cannot erase downloaded copies; certificate expiry and revocation
bound their usability. Never offer private-key recovery or re-download.

The page must explain this one-time-download policy next to the create/download
controls. It must also explain the 30-day certificate lifetime: expiry limits the
useful lifetime of leaked credentials and forgotten test devices. Expired
certificates cannot authenticate new connections. Creating another device does
not extend or revoke an existing certificate.

### Policy and lifecycle

Test purpose must be stored in authoritative device metadata independently of
the Device ID and deployment environment. Explicitly enabled production Clouds
may host restricted customer test devices; the environment name alone must not
categorically prohibit them. Default to disabled and require explicit tenant,
issuer/trust, quota, and test-device policy, not just a generic feature flag.

Use short-lived certificates (30 days by default, service policy may shorten
validity). Enforce expiry, revocation, and cleanup through authoritative services,
not merely UI hiding. Test devices must not be silently promoted into shipped
production devices. Normal manufacturing key custody remains unchanged.
Exact quotas, in-flight key custody, cleanup grace periods, and production trust
rollout must be specified before enabling the feature.

### Idempotency and partial failures

Persist an operation scoped to the requester, Brand Cloud, normalized request,
and `Idempotency-Key`. Identical concurrent retries resume the same allocation
and issuance without extra IDs, certificates, or quota consumption. Reject
conflicting reuse. Track allocation, issuance, registration, readiness, and
failure durably; do not publish a download before required registration succeeds.
Retry recoverable steps. On terminal failure, release reservations and revoke
unusable credentials as appropriate, preserving allocation/audit history and
existing ID reuse rules. A repeated completed request must not re-deliver private
material; report non-secret completion metadata instead. A new device requires an
explicit new Create request, not an automatic retry after a failed download.

### Implementation gap and acceptance

The existing device endpoint requires manual IDs/serials and browser-generated
CSRs, returns certificate-only material, and rejects production. It does not
implement this target. Update UI, orchestration, server key custody, API/OpenAPI,
feature gates, and shared bundle/SDK policies together. Bundle v1 currently
rejects embedded keys in production: require an explicit versioned contract/policy
migration and conformance rollout; never mislabel production as staging.

Acceptance must demonstrate:

- Cloud/profile selection alone produces an automatically allocated device and
  matching server-generated credentials without customer manufacturing setup.
- Package import enables mTLS, scoped-token acquisition, and an authorized
  profile-specific smoke test after normal binding prerequisites.
- Concurrent retries and partial failures preserve one operation/device and
  never expose false-ready downloads.
- Cross-tenant access, inactive profiles, exhausted quota, and disabled policy
  fail safely; completed requests cannot re-download keys, and key deletion,
  certificate expiry, revocation, and cleanup work.
- Explicitly permitted production-Cloud test devices work only after compatible
  trust, bundle, and SDK rollout. Ordinary production/app key policy is unchanged.

## Existing Implementation Baseline

The following describes the current implementation, not the target device flow.
Its browser-generated keys, required manual device identity, and production
restriction remain implementation gaps. App behavior below remains applicable.

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
