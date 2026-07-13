# Platform Admin Design-to-Implementation Plan

Date: 2026-07-13

Status: implementation plan based on the current `rtk_cloud_admin` checkout

Related documents:

- [Platform View Dashboard Design](platform-view-dashboard-design.md)
- [Platform Brand Cloud Management Design](platform-brand-cloud-management-design.md)
- [Backend API Gap Audit](backend-api-gap-audit.md)
- [Role Definitions](ROLES.md)
- [OpenAPI contract](openapi.yaml)

## Executive Summary

The current checkout already has a working Platform View shell, a server-side
Platform Dashboard BFF, Grafana proxying, Service Health, SSO Providers,
Service Logs, Operations Log, Audit Log, and an Account Manager-backed Brand
Clouds workflow. The backend is therefore sufficient for the current reduced
UI, but it does not yet support the design assets as a complete product
contract.

The remaining gaps after the management-first implementation are:

1. dashboard environment/cluster context remains intentionally deferred;
2. Brand Clouds list data lacks SSO, created-at, and region-filter support and
   is filtered after a full upstream list fetch;
3. entitlement display and full SSO setup workflows remain intentionally
   minimal;
4. rich log search, operation detail, and full upstream audit remain deferred;
5. Service Logs filters render as read-only inputs and do not become query
   parameters;
6. Audit and activity data remain local/BFF projections rather than a complete
   upstream platform activity contract.

The P0 dashboard source-state rendering, recent incident context, Brand Cloud
fresh detail/SSO read, create stepper, partial-failure handling, and local
management audit records are implemented in the current branch.

## Priority Rule

Backend work is urgent only when it is required for a Platform Admin to make a
management decision or perform a management action. Display-only context,
extra metrics, historical exploration, and deep diagnostics do not block the
first usable release.

- **P0 management:** health state, failed/open operations, service/workload
  status, Brand Cloud identity/status/owner, SSO setup state, enable/disable,
  member assignment, authorization, and source-state handling.
- **P1 workflow support:** basic search/filter, bounded paging, setup retry,
  partial-failure state, and links to existing detail pages.
- **P2 optional observability:** environment/cluster selectors, extra business
  metrics, historical trends, deep node/workload detail, rich log dimensions,
  and full audit export/search.

P2 items remain design extensions, but are not backend release blockers.

## Current Implementation Evidence

### Implemented baseline

- `/api/admin/platform-dashboard` returns KPI, scrape, service metric,
  workload, node, operation-risk, business, infrastructure, and source-state
  sections.
- `/api/admin/summary`, `/customers`, `/devices`, `/operations`,
  `/service-health`, and `/audit` are platform-admin protected.
- Grafana is embedded through the same-origin `/api/admin/grafana/*` proxy.
- Brand Clouds has list, pagination, search, status/tier filtering, create,
  update, member assignment, brand-user creation, user listing, approve,
  enable, disable, and delete routes.
- SSO provider list/read/upsert routes exist and secrets are not returned.
- Platform route guards distinguish platform-admin sessions from customer
  sessions and require an Account Manager-backed session for Brand Clouds.
- The shell refreshes authenticated data every 20 seconds.

### Design parity gaps

| Area | Design expectation | Current implementation | Required action | Owner |
|---|---|---|---|---|
| Dashboard shell | Environment, cluster, health, freshness and drill-down links | Environment and cluster are hard-coded in React; freshness says `now`; panels have limited/no drill-down actions | Add a dashboard context/read-model contract and route links to Service Health, Operations, and detail views | Admin BFF + WebUI |
| Dashboard metrics | Compact KPI and dense service/workload/node/risk tables | Main tables and panels are implemented and backed by `/api/admin/platform-dashboard` | Keep payload; add stable IDs, links, detail routes, and source freshness | Admin BFF + WebUI |
| Platform navigation | Dashboard, Service Health, Brand Clouds, SSO, Operations, Audit | Also exposes Grafana and Service Logs; this is useful but not represented consistently in design docs | Make the extended navigation explicit in the approved design | Docs + WebUI |
| Brand Clouds list | Search, status/tier/region filters; SSO, quota, created columns | Search/status/tier work; region filter, SSO, created columns are absent; BFF fetches all upstream records then filters locally | Enrich list DTO and add upstream/BFF pagination/filter contract | Account Manager + Admin BFF + WebUI |
| Create Brand Cloud | Four-step drawer: Identity, Admin, Entitlement, Review | Single form; no brand code, fixed organization-kind display, entitlement snapshot, or review summary | Implement stepper and validation; extend create DTO only for fields owned by Account Manager | WebUI + Account Manager contract |
| Brand Cloud detail | Fresh setup checklist, identity, members, SSO, quota, actions | Uses selected list row; SSO is hard-coded unavailable; no fresh detail join | Fetch detail and SSO status in parallel; return a composed detail DTO | Admin BFF + WebUI |
| Brand users | Existing-user assignment and lifecycle actions | Routes and UI exist, including create/reactivate | Add capability-aware controls, audit correlation, and pagination if upstream grows | Account Manager + Admin BFF |
| SSO | Provider status in Brand Cloud setup and dedicated SSO page | Dedicated list/upsert exists; Brand Cloud detail does not consume it; OIDC only | Add detail composition, verify/test status, and document SAML as out of scope | Admin BFF + Account Manager |
| Service Logs | Search/filter by service, host, level, trace/request/operation/device/org/user | Inputs are read-only; fetch is effectively fixed to one service | Add query parameters, bounded pagination, redaction, and backend log-search contract | Logger/BFF + WebUI |
| Operations | Scan-first queue with filters and detail links | List exists but is a basic read model; dashboard does not provide complete drill-down | Add bounded filters, cursor/page contract, operation detail, and source freshness | Admin BFF + upstream |
| Audit | Cross-platform actor/action/target history | Local audit rows exist; full upstream audit mirroring/export is not implemented | Define authoritative audit source, cursor pagination, filters, and retention/export behavior | Account Manager/Video Cloud + Admin BFF |

## Backend/API Assessment

### APIs that can support the current frontend

The following APIs are adequate for the current baseline and should not be
replaced merely for UI refactoring:

- `GET /api/admin/platform-dashboard`
- `GET /api/admin/summary`
- `GET /api/admin/service-health`
- `GET /api/admin/operations`
- `GET /api/admin/audit`
- `GET /api/admin/grafana/status` and the same-origin Grafana proxy
- `GET/POST /api/admin/brand-clouds`
- `GET/PATCH /api/admin/brand-clouds/{brandCloudId}`
- `POST /api/admin/brand-clouds/{brandCloudId}/members`
- Brand-user list/create/lifecycle routes
- `GET /api/admin/sso/providers` and
  `GET/PUT /api/admin/orgs/{orgId}/sso-provider`

### API work required for design parity

#### 1. Platform dashboard management contract (P0/P1)

The existing dashboard response is sufficient for the first management release.
Only add stable service/workload/node/operation identifiers, meaningful source
freshness, and route-safe references to the existing Service Health and
Operations pages. Environment selectors, historical context, and new resource
detail routes are P2 and should not block the release.

If later required, suggested bounded detail routes are:

```text
GET /api/admin/platform-dashboard?environment=&cluster=
GET /api/admin/services/{serviceId}
GET /api/admin/workloads/{workloadId}
GET /api/admin/nodes/{nodeId}
GET /api/admin/operations/{operationId}
```

These routes must return sanitized summaries only. Raw Prometheus labels and
arbitrary PromQL remain server-side concerns.

#### 2. Brand Cloud management read models (P0/P1)

For the first management release, keep the current endpoint and make the
management fields authoritative. A future enriched endpoint may be:

```text
GET /api/admin/brand-clouds?q=&status=&tier=&region=&limit=&cursor=
GET /api/admin/brand-clouds/{brandCloudId}/overview
```

Rows/detail must include brand name/id, tier, normalized status, owner/admin,
SSO setup status, source status, and enough quota/setup information to avoid an
unsafe action. Region, created-at, brand code, and historical usage are P2
display fields. A fresh detail read is P0 when the list row may be stale.
Cloud Admin must not create a second authoritative store.

Account Manager support is urgent only for authoritative owner, status, member,
SSO, and action results. Server-side pagination, region/brand code/created-at,
and rich entitlement usage are follow-up work unless current tenant counts make
the existing bounded list unsafe.

#### 3. Create/update workflow contract

Keep creation as one Account Manager operation where possible. The BFF response
should include the created brand cloud, owner assignment result, entitlement
snapshot, SSO setup state, request correlation id, and retryable versus
non-retryable failure. Do not accept billing approval or arbitrary entitlement
changes in Cloud Admin.

#### 4. Logs, operations, and audit (P1/P2)

Keep current read routes for the first management release. Define bounded query
contracts only when the current lists cannot support safe triage:

```text
GET /api/admin/service-logs?service=&host=&level=&trace_id=&request_id=&operation_id=&device_id=&org_id=&user_id=&cursor=&limit=
GET /api/admin/operations?state=&organization_id=&type=&cursor=&limit=
GET /api/admin/audit?actor=&action=&target=&organization_id=&result=&cursor=&limit=
```

The BFF must redact secrets, enforce maximum page sizes, and return source
freshness. Full audit history requires an authoritative upstream audit API or
an explicitly documented ingestion pipeline.

## Delivery Plan

### Phase 0 — Contract and documentation lock

- Approve this matrix as the source plan.
- Update OpenAPI schemas and examples for current versus planned fields.
- Confirm Account Manager ownership for brand code, region, quota, SSO, users,
  memberships, and audit.
- Decide whether dashboard detail routes are needed immediately or whether
  existing pages can be used as drill-down targets.

Exit criteria: no design field is marked implemented without a route, DTO,
source owner, and test reference.

### Phase 1 — Make the existing Platform Dashboard management-ready

- Make source status and freshness meaningful.
- Add links from risk/KPI panels to existing Service Health and Operations
  pages.
- Add responsive/visual QA against the dashboard mockup.

Exit criteria: an operator can identify the unhealthy service/workload/node or
operation and reach the existing management/investigation page.

### Phase 2 — Complete Brand Clouds management read experience

- Make identity, status, owner, SSO, and action results authoritative.
- Keep basic search/status filtering usable.
- Fetch fresh detail data rather than reusing the list row.
- Join SSO status and the minimum quota/setup state needed for safe actions.

Exit criteria: an operator can find a Brand Cloud, understand whether it is
ready, identify its owner/setup blocker, and safely enable/disable or assign a
member.

### Phase 3 — Complete Brand Cloud create/update workflow

- Implement the four-step drawer with validation and review.
- Handle initial-admin partial failure with retry from detail.
- Add capability-aware actions and audit correlation.
- Add tests for active, setup-required, disabled, unavailable, and
  partial-failure states.

Exit criteria: create/update/member flows are safe for production Account
Manager sessions and cannot silently fall back to demo data.

### Phase 4 — Optional observability depth

- Add Service Logs filters and bounded pagination.
- Add rich operation detail and source-backed dead-letter history.
- Add audit filters, export, and authoritative upstream activity integration.
- Keep Grafana private and linked for deep investigation.

Exit criteria: a Platform Admin can move from a red KPI to a sanitized,
traceable detail page without reading SQLite or constructing PromQL manually.

## Verification Plan

- Backend: Go handler/client tests, upstream contract fixtures, OpenAPI
  validation, authorization, redaction, and pagination tests.
- Frontend: route/component/state tests plus loading, empty, unavailable, and
  partial-failure browser tests.
- Visual: render Platform Dashboard and Brand Clouds list/create/detail at the
  approved 1440px reference width and at a narrow viewport.
- Live acceptance: Account Manager-backed Platform Admin login, real Brand
  Cloud list/create/member assignment, SSO status, Prometheus source states,
  Grafana proxy health, and audit correlation.
- Regression: customer sessions cannot access `/api/admin/*` or receive
  cross-tenant data.
