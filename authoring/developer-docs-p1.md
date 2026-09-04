# P1 documentation and information architecture

Reviewed 2026-09-04. Maintainer-only evidence; not included in the public search index.

## Sources and authority

Same source snapshots as P0: contracts `9b1ed887912e`, Account Manager `54b37b9c407d`, Video Cloud `30fbb9a26155`, Admin baseline `bbaf62f7d6b5`.

| Deliverable | Canonical source | Implementation cross-check |
| --- | --- | --- |
| API and Message Examples | `device_shadow.md`, REQ-SHADOW-RESPONSE-001 and mutation requirements; auth routes | `internal/deviceshadow/protocol.go`; `internal/httpapi/shadow_sigv4.go`; auth Token and HTTP writeFail schemas |
| Credential Renewal and Connection Recovery | `auth.md` runtime reissue and certificate bootstrap requirements | `internal/httpapi/router.go`, `internal/auth/auth.go`; local supervisor policy tests |
| Designing Your Device State Model | `device_shadow.md` merge, version, validation and lifecycle requirements | Domain fields explicitly labeled application-owned; no built-in command or schema-validation capability claimed |
| Debugging an Integration | Auth, MQTT ACL and Shadow response contracts | Existing error paths and sample messages; operator logs are not exposed as a fabricated customer API |
| Compatibility and Release Notes | RTK namespace and AWS-style HTTP/document compatibility requirements | Pinned paho 2.1.0 sample evidence, source snapshots, explicit unqualified client/environment rows |
| Documentation Map / navigation | Curated public catalog | One category per chapter, stable slugs, mobile optgroups, desktop groups and grouped browse results |

Local RAG retrieved the canonical response requirement and was checked against source. Its citations are retained in `developer-docs-p1-rag.json`. Auth and serialization source inspection takes precedence over retrieval summaries.

## Structure

23 pages in six groups: Start here; Tutorials; Concepts; Build integrations; Operate and troubleshoot; Reference. The Documentation Map gives firmware, App and Backend learning paths. Existing URLs are preserved. References own protocol rules; tutorials/guides link to them. Category metadata is shared by the public catalog, navigation and local search. Maintainer notes and private runtime material remain outside the published content directory.

## Validation boundaries

- Required metadata, page inventory, local links, JSON and Bash syntax, 21 Mermaid/SVG hashes, deterministic ZIP/source correspondence.
- Recovery policy tests: expiry scheduling, malformed token, reissue, expired-token bootstrap, 401 fallback, 403 stop, missing metadata, bounded worker failure and private temporary-file cleanup.
- Existing six demo behavior checks retained. These are local fixtures/API-construction checks, not a live broker qualification.
- Desktop/mobile browser checks cover grouped navigation, all chapter links, article links, table-of-contents links, search and ZIP/Mermaid downloads.
- New diagram sources are rendered to SVG and visually inspected; full-size links remain available on narrow screens.
- No deployment or live onboarding, token renewal, revocation propagation, network switching or real-hardware execution is implied by local checks. Existing P0 qualification gaps remain open.

## Updating the collection

Edit Markdown/frontmatter and `index.en.yaml`, preserving matching categories and stable slugs. Re-render changed Mermaid sources and refresh their hashes. `python3 tools/check_developer_docs.py --package-example` rebuilds the example archive; build the website to regenerate the public index. Run the focused document tests and refresh the docs-only local RAG index with remote embeddings and answers disabled. Record real release/deployment status separately from authoring milestones.
