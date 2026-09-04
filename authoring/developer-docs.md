# Developer Docs authoring and validation record

Reviewed: 2026-09-04. This is maintainer material, not a public Developer Docs page or a source for public RAG answers.

## Sources and authority

Canonical public contract snapshot: `rtk_cloud_contracts_doc` at `9b1ed887912e0ff6d5cede0e9a09136500a613eb`. Implementation/test snapshot: `rtk_video_cloud` at `30fbb9a26155d67948f031f199c55161e4f50ace`. SDK cross-check snapshot: `rtk_cloud_client` at `0ae797a92424a47f2e753630e9fb2e47de273eed`.

| Chapters | Canonical sources in rtk_cloud_contracts_doc | Implementation/test cross-check in rtk_video_cloud |
| --- | --- | --- |
| Overview, prerequisites | `contract_overview.md`, `auth.md`, `device_transport.md`, `device_shadow.md` | `internal/httpapi/mqtt_auth.go`, token issuance routes |
| Authentication | `auth.md`: runtime scope, subject, MQTT tenant identity, certificate bootstrap and token reissue | `internal/httpapi/dto.go`, `shadow_sigv4.go`, `router.go`, `internal/auth/auth.go` |
| MQTT Quickstart and connection guide | `auth.md`, `device_transport.md` | `internal/httpapi/mqtt_auth_test.go`; `docs/mqtt-broker.md` for deployment boundary |
| MQTT Topic reference | `device_transport.md`, `device_shadow.md` | `internal/httpapi/mqtt_auth.go`, `internal/mqtt/shadow.go` |
| Shadow concepts and Quickstart | `device_shadow.md` | `internal/deviceshadow/service_test.go`, `protocol_test.go`, `internal/mqtt/shadow_test.go` |
| MQTT/HTTP interface and reference | `device_shadow.md`, `openapi.yaml` | `internal/httpapi/device_shadow_test.go`, `shadow_sigv4.go` |
| Recovery and troubleshooting | `device_shadow.md`, `auth.md` | Concurrent/version/tombstone tests, MQTT ACL tests, SigV4 and subject-binding tests |

## Local RAG review

Used this workspace's existing `tools/local-rag` command and `.rag/rag.db`. Refreshed changed source content: 618 indexed, 478 unchanged, 1,096 active files. Remote embeddings and remote answer generation were disabled; retrieval and extractive summaries ran locally. This was not an embedding refresh or a repository update.

The existing database uses the SQLite LIKE fallback, so broad queries were dominated by deployment artifacts. Follow-up queries using canonical requirement IDs recovered the normative mutation, notification, HTTP, validation, and reissue passages. Citation paths, headings, line ranges, commits, and confidence notes are preserved in `developer-docs-rag-sources.json`. The public draft itself is never evidence for its own claims.

A historical load report retrieved by RAG says devices must be prevented from writing desired state. That conflicts with the current canonical Shadow contract, which permits desired/reported according to explicit principal policy. The new guide follows the canonical contract and does not repeat the historical restriction. Historical load-test success is not evidence that today's tutorial ran successfully.

Recheck token bootstrap against the environment's mTLS origin: ordinary HTTP API port-forwards cannot carry a verified client certificate. The prerequisites and example token commands use distinct configurable device/app token origins.

## Known differences and publication gates

1. **Capability enforcement:** the canonical contract requires `iot_shadow` independently of `mqtt`. The reviewed MQTT ACL builder checks `mqtt` for connection access but grants subject Shadow topics without an explicit `iot_shadow` check, and the inspected Shadow HTTP authorization attaches service options without an explicit Shadow capability check. Do not claim tested deny behavior for missing `iot_shadow`. Service owners must verify/fix enforcement and add target-environment negative tests before release qualification. The guide states the required capability configuration; no service behavior was changed here.
2. **HTTP authentication:** canonical OpenAPI declares SigV4. The current HTTP implementation also accepts a Bearer path. The guide documents SigV4 as the public contract and does not advertise the additional path as a stable compatibility promise.
3. **Credential response schema:** `aws_iot_data` and the returned `aws_credentials` fields are confirmed by implementation and tests, but are absent from the inspected canonical auth/OpenAPI text. Update the canonical token schema before treating this implementation-derived bootstrap example as a version-independent API promise.
4. **Deployment settings:** universal MQTT session/retain/Keep Alive limits and numeric Shadow per-connection capacity were not established by the public contract. The guide labels tutorial client choices and asks readers to obtain actual environment limits.

## Validation performed

- 12 English pages: required metadata, ordered navigation, local links, JSON blocks, and Bash syntax pass the document checker.
- 10 Mermaid sources rendered successfully to SVG using Mermaid CLI 11.15.0. SVG/source hashes are checked to prevent stale diagrams.
- 92 top-level existing service tests passed across `internal/deviceshadow`, `internal/mqtt`, and `internal/httpapi`. Test names are recorded in `developer-docs-validation.json`. Coverage includes merge/null/arrays, missing state, named listing, version conflict, tombstones, protocol serializers, MQTT response mapping and notification order, SigV4, subject binding, and MQTT identity/ACL handling.
- These are local service/adapter/HTTP tests, not a live broker run of the pasted tutorial commands. MQTT CLI tools were not installed, and no target-environment test credential bundle was selected for this authoring pass. Live publish/subscribe, offline recovery, cross-protocol convergence and missing-capability deny checks remain deployment qualification tasks.

Reproduce local service tests with `GOWORK=off go test ./internal/deviceshadow ./internal/mqtt ./internal/httpapi -run 'Test(Service|Validation|Decode|Delta|AWSShadow|Payload|Documents|UpdateAccepted|Mutation|PerShadow|Shadow|Adapter.*Shadow|DeviceShadow|ActivationDoesNotBootstrap|MQTT|RequestToken)' -count=1` from the service checkout.

## Console integration verification

The English collection is maintained in `web/content/developer-docs` in Cloud Admin. The independent Developer Docs entry appears immediately below ChipSet & SDK in the Connect+ Features navigation. `/console/developer-docs` provides local full-text search; `/console/developer-docs/{slug}` provides chapters, source metadata, and SVG/Mermaid diagrams. The normal console login gate and return destination apply. The former Portal integration has been removed.

The Admin build publishes the curated collection and a local search index at `/assets/developer-docs/index.en.json`. Only public authored content is packaged, never this authoring directory or raw RAG source chunks. This is local full-text retrieval, without vector embeddings or AI answering. The existing workspace RAG was used for source verification separately.

Local verification covers navigation order, global route handling, deep-link login, full-text search, diagram loading, and desktop/mobile overflow. Live protocol qualification remains pending as described below; moving the reading UI does not change MQTT or Shadow service behavior.

## Target-environment acceptance

Use fresh dedicated test identities and the selected environment's verified mTLS endpoints. Follow both Quickstarts literally, observe successful subscriptions before publication, then verify HTTP GET/update/list/delete with scoped SigV4 credentials. Stop the device observer, change desired, reconnect and GET/reconcile; confirm reported convergence. Send a stale-version patch and expect 409. Verify invalid identity, another device's reserved topics, and missing capabilities are denied at the appropriate layer. Record sanitized outcomes and exact deployed service/image versions; do not store credential values.
