# P0 Developer Docs additions

Reviewed 2026-09-04. Maintainer evidence; excluded from the public site/search package.

## Source alignment

Baseline: contracts `9b1ed887912e`, Account Manager `54b37b9c407d`, Video Cloud `30fbb9a26155`, Admin `bbaf62f7d6b5`. Source inspection, local sample tests and UI tests are distinct from live service qualification.

| Chapter | Authoritative source | Implementation or test cross-check |
| --- | --- | --- |
| Set Up Your First Cloud and Device | Account Manager `openapi.yaml`: claim resolve, provision, provisioning; contracts `provision.md` | Admin `web/src/main.jsx`: Product capability editor and device drawer; Account Manager ProvisioningStateResponse |
| Device and App Credential Setup | contracts `auth.md:285–345`, factory requirements; Account Manager login and certificate schemas | Account Manager `internal/api/integration_test.go`: CSR required, wrong subject, issuer failure, certificate reuse |
| End-to-End App and Device Example | contracts `device_shadow.md`: exact topics, correlation, versions, notifications | Video Cloud `internal/mqtt/shadow_test.go`, `internal/deviceshadow/protocol_test.go`; new `tools/test_shadow_demo.py` |
| Backend Integration Guide | contracts `auth.md` route authorization matrix and `device_shadow.md` HTTP contract | Video Cloud `internal/httpapi/router.go:289–430`, `shadow_sigv4.go`, admin scoped issuance tests in `router_test.go` |
| Connection Settings and Service Limits | contracts `device_shadow.md`, `auth.md`; actual dev MQTT configuration readback | Video Cloud Shadow validation and MQTT ACL code; dev broker `conf show mqtt`, 2026-09-04 |

## Differences that must remain explicit

- `api_usage.md` contains the older app-brand-cloud-user subject. The current auth contract, Account Manager schema and tests establish `app-user:<user_id>` for a global human user; roles remain memberships.
- `http_api.md` retains HMAC/shared-key factory ingress wording. Current auth/provision requirements specify the production-context factory JWT. This guide documents the authorized factory boundary without inventing factory provisioning commands.
- The Product editor exposes `mqtt` as Device Telemetry but has no `iot_shadow` checkbox. Document the approved operator configuration prerequisite; this change does not add UI/API capabilities.
- A generic self-service backend OAuth grant/delegation endpoint is not established. The backend example is explicitly for an operator-authorized trusted platform integration.
- Existing capability-enforcement, SigV4 schema and live qualification gaps in `developer-docs.md` remain open. Missing `iot_shadow` denial is a required negative test, not a verified result.
- Dev broker values are observed configuration, not public account quotas or proof of offline replay/feature support.

## Validation and maintenance

- `python3 tools/check_developer_docs.py --package-example`: regenerates the deterministic download, checks archive bytes against the three source files, validates all 17 pages, 16 SVG hashes, metadata, local links, JSON and Bash syntax.
- `python tools/test_shadow_demo.py` with `paho-mqtt==2.1.0`: six passing behavior/API-construction checks for response correlation, stale reads, rejection, missing Shadow, duplicate/unrelated deltas, unsupported state and bounded timeout. These use an in-process session fixture, not a live broker.
- Frontend production build passed. Desktop and mobile Developer Docs browser checks passed (six tests), exercising all chapter/body/TOC/search links and Mermaid/ZIP downloads.
- Six new Mermaid source files and pre-rendered SVGs are bundled with the website. The downloadable demo retains TLS verification, separate app/device credentials and exact topics.
- Re-render modified diagrams with `python3 tools/check_developer_docs.py --render`; package checks reject stale source/SVG or source/ZIP pairs.
- Local RAG source retrieval informed the CSR section; only canonical source citations are retained in the adjacent P0 RAG evidence. A separate docs-only local SQLite index was built with remote embeddings and answer generation disabled. The website's existing bundled local search index includes all 17 pages; deployment will rebuild it without needing an external AI service.

## Remaining environment qualification

No new real-user onboarding or live two-principal MQTT run was performed for this addition. On a dedicated activated dev device, verify enrollment/login, claim and activation, independently issued credentials, MQTT convergence, offline restart, credential expiry, cross-device denial and missing-capability denial. Record exact deployment versions and sanitized results. This source change has not yet been deployed.
