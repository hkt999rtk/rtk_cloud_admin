# Lifecycle documentation and architecture diagrams

Reviewed 2026-09-04. Maintainer-only record; not in the public search corpus.

Added Device Ownership and Sharing, Device Presence and Lifecycle, and Integration Test Kit. Total: 26 pages in the existing six groups. Added three sequence diagrams and four Mermaid block diagrams: identity/access boundaries, lifecycle layers, control topology and kit architecture. Existing Service Overview remains the high-level system map. Sequence diagrams describe temporal interactions; block diagrams describe components, responsibility and data paths. Keep both formats source-controlled and linked to their corresponding guide.

## Evidence

Same reviewed snapshots as P1: contracts 9b1ed887912e, Account Manager 54b37b9c407d, Video Cloud 30fbb9a26155, Admin baseline bbaf62f7d6b5.

- Ownership: contracts `provision.md`, REQ-CONTRACT-PROV-UNPROVISION-001; Account Manager OpenAPI org unprovision, APP claim and admin transfer routes; `internal/api/integration_test.go` TestIntegrationDeviceUserUnprovisionWorkflow and write-boundary tests.
- Presence: contracts `device_transport.md` owner/priority/routing and WebSocket frame rules; Video Cloud `internal/devicebus/registry_test.go` stale session removal and priority tests, `router_test.go` no-owner routing tests.
- Test kit: existing exact-topic Shadow contract and sample; new `verify.py` probes only GET by default, with an explicit simulator mutation option. Local probe tests check correlation, no private-state logging, 404, denial, timeout and read-only default.
- Local RAG retrieved canonical unprovision requirements; citations are preserved in the adjacent evidence JSON. Source text is authoritative, not retrieved summaries.

## Boundaries

No generic consumer sharing API, universal revocation/offline latency, blanket unprovision data deletion, or automatic owner session from a generic MQTT connection is claimed. No real ownership operation was executed. The kit's live matrix deliberately separates automated probes/control exercise from HTTP, expiry, authorization, ownership and presence qualification. No new service behavior or deployment is part of this addition.

## Checks

Document metadata/category inventory, local links, JSON/Bash syntax, Mermaid source hashes and example ZIP correspondence. Four block diagrams visually inspected; control topology uses a vertical layout for readability. Nineteen Python policy/demo checks and three documentation navigation unit checks pass. Desktop/mobile full-link checks are recorded separately after completion. The documentation-only local RAG index contains 29 indexable files; the website catalog contains 26 pages. Both run without remote embeddings or answers.
