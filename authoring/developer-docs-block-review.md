# Developer Docs block-diagram coverage review

Reviewed 2026-09-04 against the existing 26-page collection and its pinned contract/service snapshots. These diagrams organize already documented behavior; they do not establish new service capabilities. Eight new block diagrams are shared across nine guides. Total diagram inventory: 23 sequences and 13 block diagrams.

| Page | Decision and rationale |
| --- | --- |
| Documentation Map | Learning paths and grouped linked inventory are sufficient; no separate navigation graph |
| Cloud Service Overview | Existing service-overview block diagram retained |
| Before You Start | Add link to credential architecture; prerequisite tables remain easier to consult |
| Set Up Your First Cloud and Device | Link to existing Factory/Account/Runtime lifecycle architecture; keep activation sequence |
| Device and App Credential Setup | Add shared credential-use map to distinguish identities and token destinations |
| MQTT Quickstart | Link to MQTT topic-family architecture; retain interaction sequence |
| Shadow Quickstart | Link to Shadow document architecture; retain interaction sequence |
| End-to-End App and Device Example | Link to existing kit architecture; avoid a duplicate client-component map |
| Device Shadow Concepts | Add intent, observation, computed delta and server-owned metadata map |
| Designing Your Device State Model | Add independently versioned named/unnamed Shadow partition map |
| Device Presence and Lifecycle | Existing lifecycle-layers and control-topology diagrams retained |
| Authentication and Access Control | Share credential-use map with Credential Setup |
| MQTT Connection Guide | Existing link to owner-transport architecture and recovery guide retained; no duplicate broker map |
| Backend Integration Guide | Add caller authorization and approved credential-path responsibility map |
| Using Shadows over MQTT and HTTP | Add shared-state / distinct-authentication interface map |
| Integration Recipes | Existing offline/conflict sequences and conceptual guide links suffice |
| Device Ownership and Sharing | Existing identity-access block diagram retained |
| Credential Renewal and Connection Recovery | Add supervisor, worker, token-file and service component map |
| Debugging an Integration | Add observable dependency boundaries; explicitly not a timing sequence |
| Troubleshooting and Compatibility | Symptom/action table and debugging link suffice |
| Integration Test Kit | Existing kit-architecture diagram retained |
| MQTT Topics and Message Reference | Add protocol-family routing map; direction table remains authoritative |
| Shadow API and Message Reference | Exact field/path tables plus concepts/interface links suffice |
| API and Message Examples | JSON fixtures and existing reference/interface links suffice |
| Connection Settings and Service Limits | Settings/limits comparisons remain tables; avoid implying physical deployment topology |
| Compatibility and Release Notes | Mapping and release tables suffice; no invented SDK components |

## Design rules

Block diagrams describe logical components, data ownership or responsibility boundaries. Sequence diagrams describe interactions over time. New diagram labels are English, use Mermaid flowchart source plus generated SVG, and include prose equivalents for local retrieval. Full-size and source links remain available. Shared credential diagrams have one source file. Names such as configuration/diagnostics are application examples, not reserved or pre-created objects.

Sources remain the existing public auth, device transport and Shadow contracts, plus the previously reviewed implementation. Backend delegation remains an approved integration boundary, not a newly claimed customer API. Desired/reported writer roles remain conventions rather than built-in field ACLs. Internal deployment topology is deliberately not inferred.

## Validation

Required page metadata, category consistency, local links, JSON/Bash syntax, source-to-SVG hashes and downloadable ZIP integrity are checked by the existing documentation validator. Browser verification covers all chapter links, diagram views and Mermaid downloads on desktop/mobile. Local RAG refresh indexes the explanatory paragraphs; no external embeddings or answer service is enabled. No live deployment or new runtime protocol qualification is implied.
