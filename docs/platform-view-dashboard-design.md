---
rtk_spec:
  id: SPEC-CA-DASHBOARD-DESIGN
  status: approved
  owner: rtk_cloud_admin
  requirement_inventory: complete
---

# Platform View Dashboard Design

## [FEAT-CA-PLATFORM-DASHBOARD-001] Platform operations dashboard

<!-- rtk-feature
{"owner":"rtk_cloud_admin","risk":"critical","status":"active","change_paths":["repos/rtk_cloud_admin/internal/app/**","repos/rtk_cloud_admin/web/**"],"commit_anchors":["cloud_admin"],"surfaces":[{"kind":"api-route","source":"repos/rtk_cloud_admin/docs/openapi.yaml","selector":"getApiAdminPlatformDashboard"},{"kind":"ui-route","source":"repos/rtk_cloud_admin/web/src/routes.mjs","selector":"platform-dashboard"}]}
-->

Status: implemented baseline; design-parity follow-up is tracked in
`platform-admin-implementation-plan.md`.

Date: 2026-06-02

Audience:

- `rtk_cloud_admin` frontend and backend developers
- SRE / operators maintaining Video Cloud Prometheus
- product / QA reviewers for Platform View

Related documents:

- [SPEC.md](SPEC.md)
- [ROLES.md](ROLES.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [backend-api-gap-audit.md](backend-api-gap-audit.md)
- [private-cloud-deployment.md](private-cloud-deployment.md)
- [rtk_cloud_contracts_doc/METRICS_EXPORT.md](../docs/rtk_cloud_contracts_doc/METRICS_EXPORT.md)

## Summary

### [REQ-CA-DASHBOARD-AUTHORITY-001] Dashboard preserves product and data-source authority boundaries

<!-- rtk-requirement
{"acceptance_layer":"integration","gate":"pr","environments":["ci"],"evidence":["json","junit"],"required":true,"status":"active"}
-->

Acceptance: The Platform Dashboard is the role-gated Tier 1 landing page; Cloud Admin owns only its WebUI and BFF, authoritative facts remain in Account Manager, Video Cloud, and Prometheus, and the product does not expose a raw Prometheus browser or replace Grafana.

Platform Dashboard is the Tier 1 landing page for Realtek Platform Admins. It
is a productized operations dashboard implemented in `rtk_cloud_admin`, not a
Grafana replacement and not a public Prometheus browser.

Grafana owns long-term metrics, trend analysis, deep SRE debugging, alert
authoring, and raw time-series exploration. The Platform Dashboard should
instead show a curated, role-gated, product-aware overview: tenant/device
footprint, service status, k8s workload health, cluster node snapshots, scrape
health, and cross-service risk that help Platform Admins decide where to
investigate next.

`rtk_cloud_admin` owns the WebUI and BFF. Account Manager, Video Cloud, and
Prometheus remain the sources of truth for their respective facts.

## Management-First Scope

### [REQ-CA-DASHBOARD-SCOPE-001] First viewport presents the minimum management decision surface

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: The first viewport shows overall service, workload, and node health; operation risk; tenant/device impact; source freshness and degradation; and links to existing drill-downs, while optional selectors, historical charts, and rich diagnostics cannot block the first release.

The first Platform Dashboard viewport is optimized for decisions and actions,
not for displaying every available metric. The required management information
is:

- overall platform/service/workload/node health;
- open, failed, and dead-lettered operation risk;
- enough tenant/device footprint to understand impact;
- source freshness and unavailable/degraded state;
- links to the existing Service Health, Operations, and Grafana surfaces.

Environment selectors, extra business signals, historical charts, detailed
resource drill-downs, and rich log/audit exploration are optional follow-up
surfaces. Their absence must not block the management dashboard or require new
backend APIs in the first release.

## Product Goals

- Give Tier 1 Platform Admins a first-screen answer to whether the platform is
  healthy enough for tenant operations.
- Summarize cross-tenant fleet footprint without exposing Customer View-only
  workflows or tenant write actions.
- Surface Prometheus scrape health and core operational metrics in product
  language.
- Link from summary cards to existing Platform View drill-down pages:
  Service Health, SSO Providers, Operations Log, Audit Log, and future Brand
  Clouds.
- Keep raw Prometheus labels, host details, and arbitrary query construction
  out of the product UI.

## Non-Goals

- Replacing Grafana for raw observability, ad hoc PromQL, alert rule authoring,
  long-term trend analysis, or host/container-level forensic debugging.
- Showing customer-visible Insights from raw Prometheus metrics.
- Exposing Prometheus publicly or querying Prometheus directly from browser
  JavaScript.
- Adding tenant impersonation, lifecycle write actions, or device operations
  from Platform View.
- Showing high-cardinality or sensitive labels such as device id, user id,
  email, IP address, request id, serial number, MAC address, access token, or
  session id.

## Navigation Placement

### [REQ-CA-DASHBOARD-NAVIGATION-001] Dashboard navigation preserves Platform View boundaries

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: Platform Dashboard is the first Platform View destination, links to the dedicated management drill-downs, keeps Service Health separate, and exposes ChipSet & SDK Provider mutation actions only to capable Platform Admin sessions without revealing raw provider URLs or manifests to Developer sessions.

Current Platform View nav order:

1. Platform Dashboard
2. Grafana
3. Service Health
4. Brand Clouds
5. ChipSet & SDK Providers
6. SSO Providers
7. Service Logs
8. Operations Log
9. Audit Log

`Service Health` remains a dedicated drill-down page. `Platform Dashboard`
summarizes service and metrics health at a higher level. The current React
implementation has the management summary panels, source-state rendering,
recent incident context, and links to existing management pages.
Environment/cluster selectors and deep resource detail remain deferred; see
`platform-admin-implementation-plan.md`.

`ChipSet & SDK Providers` is a management surface rather than an observability
panel. Its approved interactive design is
[`chipset-sdk-information-provider-mock.html`](assets/webui-design/chipset-sdk-information-provider-mock.html).
The page displays provider publication state, manifest version/hash, parsed
resource counts, last successful refresh, stale/unavailable state, validation
preview, and capability-gated publish/unpublish/refresh actions. It must not
expose the raw manifest or provider URL to Developer sessions.

## Page Layout

### [REQ-CA-DASHBOARD-LAYOUT-001] Dashboard layout is dense scan-first and accessible

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: The first viewport keeps Service Health, K8s Workloads, Cluster Nodes, and Operation Risk visible in the Realtek Ops Console visual system; panels use compact rows, status treatment, Font Awesome affordances with accessible labels, and the authenticated shell refreshes through one background loading path every 20 seconds without a manual topbar refresh action.

```
Platform View / Platform Dashboard
Cross-tenant operating status for Realtek Platform Admins.

[Tenants] [Devices Online] [Open Operations] [Scrape Targets Down]

Service Health
| Service | Namespace | targets | req/s | 5xx/s | avg latency | status |

K8s Workloads
| Workload | Namespace | kind | replicas | ready pods | restarts | crashloop | status |

Cluster Nodes
| Node | ready | CPU | memory | status |

Service & Scrape Health
| Account Manager | Video Cloud API | Cloud Admin | Prometheus | SQLite |

Tenant & Device Footprint                         Operation Risk
| Readiness distribution | top customer risks |    | open ops | failed ops | dead letters |

Cross-Service Risk                               Infrastructure Health
| consumer backlog | dead letters | errors |       | gateway | broker | data targets |

Business Signals                                  Recent Platform Activity
| quota requests | eval signups | blob use |       | audit + ops links |
```

The page should use the existing Realtek Ops Console visual system:
compact KPI strip, dense tables, restrained status labels, and right-side
drill-down links. Do not use marketing hero sections or decorative charts.
The primary viewport must keep Service Health, K8s Workloads, Cluster Nodes,
and Operation Risk visible. Cross-Service Risk, Business Signals,
Infrastructure Health, and historical/deep diagnostic panels are secondary and
may be hidden or deferred when their source/API is not available.

Operation Risk and Platform Activity must be scan-first dashboard panels, not
large card stacks. Operation Risk uses a compact three-metric strip for Open,
Failed, and Dead letters, followed by an incident queue with tenant/device,
short operation summary, concise message, and a small right-aligned status
badge. Platform Activity uses a compact service checklist with service name,
short health detail, optional latency, and a small status badge. These panels do
not show raw ISO timestamps; freshness is handled by the global 20-second
auto-refresh cadence and by detail pages where exact timestamps are useful.
Do not use oversized circular status blobs, oversized pill buttons, or
timestamp strings as primary visual content. Each row should have a small
Font Awesome icon, a colored left accent or compact badge, and readable
metadata columns.

The shell refreshes dashboard data automatically every 20 seconds while the
user is on an authenticated route. Do not show a manual refresh button in the
topbar. If a user action mutates data, it may still trigger an immediate
background refresh through the same loading path.

Use Font Awesome icons from `@fortawesome/fontawesome-free` for recognisable
navigation, topbar actions, KPI tiles, table row state, and common action
buttons. Icons are decorative unless they are the only visible affordance; in
that case the control must have an accessible label. Avoid letter-only glyphs
such as `R`, `OK`, `BC`, or `FW` as visual icons.

## Data Sources

### [REQ-CA-DASHBOARD-DATA-001] Browser receives only allowlisted BFF-composed dashboard data

<!-- rtk-requirement
{"acceptance_layer":"integration","gate":"pr","environments":["ci"],"evidence":["json","junit"],"required":true,"status":"active"}
-->

Acceptance: The Go BFF queries configured authoritative sources with short timeouts and server-side allowlisted PromQL, briefly caches duplicate panel queries, redacts upstream errors, and returns sanitized JSON; browser code never queries Prometheus directly.

| Source | Used for | Access path |
| --- | --- | --- |
| Admin BFF read models | tenants, devices, readiness counts, open operations | `/api/admin/summary`, `/api/admin/customers`, `/api/admin/devices`, `/api/admin/operations` |
| Admin BFF service health | Account Manager, Video Cloud, SQLite status | `/api/admin/service-health` |
| Admin BFF audit | recent platform activity | `/api/admin/audit` |
| Account Manager | SSO setup status, quota requests, brand-cloud ownership | Account Manager-backed BFF routes |
| Video Cloud Prometheus | runtime, cross-service, device aggregate, infrastructure metrics | server-side query through `VIDEO_CLOUD_PROMETHEUS_BASE_URL` |

Prometheus queries must run from the Go BFF with short timeouts and stable
allowlisted query definitions. The browser should call Admin Console JSON
routes, not Prometheus directly.

## Current Prometheus Scrape Inventory

### [REQ-CA-DASHBOARD-SCRAPE-LIVE-001] Deployed scrape inventory is verified through Prometheus

<!-- rtk-requirement
{"acceptance_layer":"live","gate":"release","environments":["staging"],"evidence":["json","junit"],"required":true,"status":"active"}
-->

Acceptance: A staging qualification queries the Prometheus targets and metric-name APIs, verifies the repo-owned configured target families are discoverable, and reports unavailable or missing jobs without exposing raw target addresses in product UI evidence.

This inventory is based on the repo-owned current configured scrape inventory
in `rtk_cloud_workspace/repos/rtk_video_cloud/docs/prometheus-metrics-inventory.md`
and the Admin deployment docs in this repo. Live verification should still use
the Prometheus API after deployment:

```sh
curl -fsS http://10.42.1.30:9090/api/v1/targets
curl -fsS http://10.42.1.30:9090/api/v1/label/__name__/values
```

Current configured targets:

| Job | Target | Path | Dashboard use |
| --- | --- | --- | --- |
| `prometheus` | `10.42.1.30:9090` | `/metrics` | Prometheus self-health |
| `nginx` role `edge` | `10.42.1.5:9113` | `/metrics` | public gateway health |
| `nginx` role `admin` | `10.42.1.60:9113` | `/metrics` | Admin gateway health |
| `postgres` role `infra` | `10.42.1.30:9187` | `/metrics` | database exporter health |
| `redis` role `infra` | `10.42.1.30:9121` | `/metrics` | cache exporter health |
| `emqx` role `mqtt` | `10.42.1.40:18083` | `/api/v5/prometheus/stats` | MQTT broker health |
| `video_cloud_app` service `api` | `10.42.1.10:18080` | `/metrics/prometheus` | Video Cloud API runtime |
| `video_cloud_app` service `turnregistry` | `10.42.1.10:18190` | `/metrics/prometheus` | TURN registry runtime |
| `video_cloud_app` service `metricsexporter` | `10.42.1.10:19200` | `/metrics/prometheus` | aggregate device/blob metrics |
| `video_cloud_app` service `logingester` | `10.42.1.10:19300` | `/metrics/prometheus` | device log ingestion |
| `node` role `edge` | `10.42.1.5:9100` | `/metrics` | edge host health |
| `node` role `api` | `10.42.1.10:9100` | `/metrics` | api host health |
| `node` role `infra` | `10.42.1.30:9100` | `/metrics` | infra host health |
| `node` role `mqtt` | `10.42.1.40:9100` | `/metrics` | mqtt host health |
| `node` role `admin` | `10.42.1.60:9100` | `/metrics` | admin host health |
| `account_manager_app` | `10.42.1.50:18081` | `/metrics/prometheus` | Account Manager app signals |
| `account_manager_node` role `account-manager` | `10.42.1.50:9100` | `/metrics` | Account Manager host resource signals |
| `cloud_admin_app` | `10.42.1.60:8080` | `/metrics/prometheus` | Admin app up signal |
| `coturn_node` role `coturn` | `10.42.1.80:9100` | `/metrics` | Coturn host resource signals over private VPC |
| `cloud_logger_app` | `10.42.1.90:18090` | `/metrics/prometheus` | Cloud Logger backend app signal |
| `cloud_logger_node` role `cloud-logger` | `10.42.1.90:9100` | `/metrics` | Cloud Logger host resource signals |
| `cloud_frontend_app` | `10.42.1.70:8080` | `/metrics/prometheus` | marketing/signup frontend signals |

Do not show this table as a raw target list in the first UI. Convert it into
aggregated health groups and drill-down rows.

## Dashboard Metrics

### [REQ-CA-DASHBOARD-METRICS-001] Metrics are grouped into product-operational signals

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: KPI, service/scrape, Kubernetes, runtime, cross-service, domain, and infrastructure metrics are rendered as current product-aware health and risk groups; raw series dumps, sensitive/high-cardinality labels, and misleading long-term trend or percentile claims are excluded.

### KPI Strip

| KPI | Primary source | Notes |
| --- | --- | --- |
| Tenants | `/api/admin/summary.customers` | Cross-tenant count. |
| Devices Online | `/api/admin/summary.online_devices / total_devices` | Show count and rate. |
| Open Operations | `/api/admin/summary.open_operations` | Link to Operations Log filtered to non-succeeded states. |
| Scrape Targets Down | Prometheus `up == bool 0` by allowlisted jobs | Link to Service Health / Prometheus status panel. |

### Service And Scrape Health

| Metric | Prometheus query shape | UI treatment |
| --- | --- | --- |
| Target availability | `sum by(job, service, role) (up)` | Group into App, Host, Data, Broker, Gateway. |
| Targets down | `sum by(job, service, role) (up == bool 0)` | Red/yellow count with affected group names. |
| Scrape duration | `scrape_duration_seconds` | Warning only when unusually high. |
| Samples scraped | `scrape_samples_scraped` | Support detail; not a primary KPI. |

### K8s Service, Workload, And Node Health

The first dashboard viewport is k8s-native. It does not present long-term trend
charts; Grafana owns trend analysis and detailed capacity exploration.

| Surface | Prometheus query shape | UI treatment |
| --- | --- | --- |
| Service targets | `sum by(job, service, namespace) (up)` and `up == bool 0` | Compact service table with up/down targets and row status. |
| Service runtime | request rate, 5xx rate, and average latency by service | Current values only; non-zero 5xx marks warning. |
| Workload replicas | `kube_deployment_spec_replicas` and `kube_deployment_status_replicas_available` | Desired/available replica comparison. |
| Pod readiness | `kube_pod_status_ready{condition="true"}` | Ready pod count by workload. |
| Restarts and crashloops | `kube_pod_container_status_restarts_total` and `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}` | Restart count and crashloop count with warning/critical row status. |
| Cluster nodes | `kube_node_status_condition`, container CPU, and container memory summaries by node | Current node readiness/resource snapshot only. |

The browser receives only sanitized service, namespace, workload, and node
summaries. Raw Prometheus `instance`, UID, container, device, IP address, and
other high-cardinality labels are not part of the UI contract.

Legacy `server_resources` may remain in the BFF payload for one transition
cycle, but the WebUI treats it as a lower-priority fallback and k8s health is
the primary dashboard contract.

### Runtime Health

| Metric | Prometheus query shape | UI treatment |
| --- | --- | --- |
| Request rate | `sum by(service) (rate(http_requests_total[5m]))` | Compact service table. |
| 5xx rate | `sum by(service) (rate(http_status_group_total{status="5xx"}[5m]))` | Highlight services with non-zero 5xx. |
| Average latency | `sum by(service) (rate(http_request_duration_seconds_sum[5m])) / sum by(service) (rate(http_request_duration_seconds_count[5m]))` | Show pithy "avg latency" value; avoid implying p95. |
| App up | `rtk_account_manager_up`, `rtk_cloud_admin_up`, `rtk_cloud_frontend_up` | Use as app endpoint status. |

### Cross-Service Risk

| Metric | Prometheus query shape | UI treatment |
| --- | --- | --- |
| Consumer backlog | `crossservice_bus_consumer_pending_messages` | Show worst streams/consumers. |
| Worker outcomes | `increase(crossservice_worker_outcomes_total[1h])` | Summarize succeeded/failed/pending. |
| Dead letters | `increase(crossservice_worker_dead_letters_total[1h])` | High-priority risk card and Operations Log link. |
| Publish/consume errors | `increase(crossservice_bus_publish_total{status="error"}[1h])`, `increase(crossservice_bus_consume_total{status="error"}[1h])` | Show only aggregate counts and service context. |

### Domain And Business Signals

| Metric | Prometheus query shape | UI treatment |
| --- | --- | --- |
| Video Cloud devices | `video_cloud_devices_online`, `video_cloud_devices_activated`, `video_cloud_devices_connected` | Compare with Admin BFF readiness counts; mark discrepancy as investigation item. |
| Blob utilization | `video_cloud_blob_capacity_utilization_percent` | Capacity risk card. |
| Exporter freshness | `time() - video_cloud_exporter_last_collect_timestamp_seconds` | Show stale/healthy state. |
| Exporter success | `video_cloud_exporter_last_collect_success` | Show last collect failed as source issue. |
| Account Manager quota requests | `rtk_account_manager_quota_raise_requests` | Pending quota review indicator. |
| Evaluation signups | `increase(rtk_account_manager_eval_signups_total[24h])` | Optional business signal; keep below operational panels. |
| Lifecycle operation counts | `rtk_account_manager_lifecycle_operations` | Compare against Operations Log shape when useful. |
| Frontend leads | `rtk_cloud_frontend_leads_total` | Optional marketing/signup context, not an operations KPI. |

### Infrastructure Health

| Metric group | Query approach | UI treatment |
| --- | --- | --- |
| Cluster node readiness | `kube_node_status_condition{condition="Ready"}` | Current node health summary. |
| Cluster node CPU | container CPU aggregate by node | Snapshot only; use Grafana for trends. |
| Cluster node memory | container working-set aggregate by node | Snapshot only; use Grafana for trends. |
| nginx | `nginx_up`, `nginx_connections_*`, `nginx_http_requests_total` | Gateway status summary. |
| PostgreSQL | `up{job="postgres"}` plus exporter-specific `pg_*` detail | Primary card is availability; deep DB charts remain Grafana/SRE. |
| Redis | `up{job="redis"}` plus exporter-specific `redis_*` detail | Primary card is availability. |
| EMQX | `up{job="emqx"}` plus broker/client/session families | Primary card is availability and broker pressure. |

## Drill-Down Behavior

- `Tenants` links to the customer/tenant list when available.
- `Devices Online` links to the cross-tenant device read model or to a
  role-gated future cross-tenant device detail surface.
- `Open Operations` links to Operations Log filtered to active or failed states.
- `Scrape Targets Down` links to the Service Health panel with affected jobs.
- SSO setup warnings link to SSO Providers.
- Brand-cloud setup warnings link to Brand Clouds after that UI is implemented.

## Page States

### [REQ-CA-DASHBOARD-STATES-001] Panels degrade independently and preserve safe fallbacks

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: Loading, unconfigured, failed, empty, partial, stale, unavailable, and unmonitored sources have distinct panel-level states; optional Account Manager inventory 404s use BFF projections, other upstream failures remain gateway errors, and wrong-role sessions never receive Customer View fallback data.

- Loading: skeleton KPI cards and panel-level loading rows.
- Prometheus not configured: show the BFF/admin read-model sections and a
  "Prometheus source unavailable" panel. Do not hide the whole dashboard.
- K8s Service Health, K8s Workloads, and Cluster Nodes render clear empty or
  unavailable states when Prometheus or kube metrics are unavailable. Legacy
  server resource rows may remain as transition fallback only.
- Prometheus query failed: show a retryable source-unavailable state with the
  source category, not raw upstream payloads.
- No series returned: show "No metrics reported for this query window" and keep
  the relevant BFF data visible.
- Partial source unavailable: degrade only the affected panel.
- Account Manager admin inventory routes are optional during the migration
  period. If `/v1/admin/orgs`, `/v1/admin/devices`, or
  `/v1/admin/operations` return 404, Platform Dashboard and the related
  `/api/admin/summary`, `/api/admin/customers`, `/api/admin/devices`, and
  `/api/admin/operations` routes fall back to Admin BFF read-model projections
  instead of returning 502. Non-404 upstream failures still surface as gateway
  errors.
- Wrong role: show Platform View access gate; never render Customer View data as
  fallback.

## Backend/BFF Requirements

### [REQ-CA-DASHBOARD-BFF-001] Dashboard BFF enforces Platform Admin policy and stable failure semantics

<!-- rtk-requirement
{"acceptance_layer":"integration","gate":"pr","environments":["ci"],"evidence":["json","junit"],"required":true,"status":"active"}
-->

Acceptance: Dashboard routes require an Account Manager-backed Platform Admin session, use only the configured Prometheus base URL and allowlisted queries, apply bounded timeouts and short caching, return stable source-unavailable states, and redact upstream errors.

Add a small, allowlisted Platform metrics BFF surface instead of exposing
Prometheus directly:

- `GET /api/admin/platform-dashboard`: composed dashboard payload for the page.
- `GET /api/admin/platform-resource-trends?range=24h|7d|90d`: deprecated
  compatibility route for older clients; the WebUI no longer calls it.
- Optional `GET /api/admin/platform-dashboard/prometheus-status`: scrape target
  health summary for service-health drill-downs.

Implementation requirements:

- Require an Account Manager-backed Platform Admin session according to the
  Platform View guard rules.
- Query only configured Prometheus base URL from `VIDEO_CLOUD_PROMETHEUS_BASE_URL`.
- Use short timeouts and return stable source-unavailable states.
- Keep PromQL definitions server-side and allowlisted.
- Cache dashboard Prometheus results briefly to avoid refreshing multiple panels
  with duplicate queries.
- Redact raw upstream errors before returning browser payloads.

## Acceptance Criteria

### [REQ-CA-DASHBOARD-UI-001] Platform dashboard meets role content refresh and privacy acceptance

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: Desktop and mobile UI evidence proves Platform Admin-only access, management-first content, automatic 20-second refresh, clear Kubernetes and source states, product-grouped metrics, accessible icons, no direct Prometheus calls, no sensitive labels, and no redundant timestamps or manual refresh affordance.

- Platform Dashboard is visible only to Tier 1 Platform Admin sessions.
- Customer users cannot see Platform Dashboard data or nav.
- The first viewport shows tenant/device footprint, open operation risk, and
  scrape health.
- Prometheus-backed panels clearly distinguish unavailable, stale, empty, and
  unmonitored states without showing a redundant `Configured` source pill.
- The first viewport includes Service Health, K8s Workloads, and Cluster Nodes
  with clear ok/warning/degraded/critical/unmonitored treatment.
- Service Health, K8s Workloads, Cluster Nodes, and Service Exporter Status do
  not show `Last checked` columns.
- The shell auto-refreshes every 20 seconds and has no manual refresh button.
- Font Awesome icons are used for navigation, topbar actions, KPIs, status
  badges, and common action buttons.
- Prometheus data is grouped into product/SRE-friendly panels, not shown as raw
  target or series dumps.
- No browser code calls Prometheus directly.
- No high-cardinality or sensitive labels are displayed.
- Grafana remains optional deep observability tooling; it is not presented as
  the Platform Admin product UI.

### ChipSet And SDK Provider Acceptance

#### [REQ-CA-DASHBOARD-CHIPSET-001] ChipSet and SDK Provider surface matches its approved interactive design

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","screenshots"],"required":true,"status":"active"}
-->

Acceptance: Desktop and mobile evidence matches the approved four KPIs, stale last-known-good banner, filters, provider table, create/edit/validation drawer, non-mutating validation preview, and capability-dependent mutation visibility; mock changes require implementation and snapshot updates.

`assets/webui-design/chipset-sdk-information-provider-mock.html#/platform` is
the visual and interaction source of truth for this work area. Completion
requires the four KPI cards, stale last-known-good banner, search and status
filters, seven-column provider table, and the right-side create/edit/validation
drawer shown by that mock. Draft validation uses the refresh action and must
show manifest, ChipSet, SDK, endpoint, and normalized preview results without
changing publication status. Read-only sessions retain Preview and hide all
mutations. Desktop and mobile Playwright screenshots are committed acceptance
artifacts; changes to the mock require corresponding implementation and
snapshot updates.

## Required Tests

### [REQ-CA-DASHBOARD-QUALIFICATION-001] Dashboard qualification covers guards sources states and responsive UI

<!-- rtk-requirement
{"acceptance_layer":"ui","gate":"pr","environments":["ci"],"evidence":["json","junit","screenshots"],"required":true,"status":"active"}
-->

Acceptance: Qualification includes backend role guards, allowlisted Prometheus composition, timeout/unavailable and error-redaction behavior; frontend loading/empty/partial states; production build; and mobile layout without control or table overflow.

Implementation PRs should include:

- Backend tests for Platform Admin guard behavior.
- Backend tests for Prometheus query timeout/unavailable handling.
- Backend tests for allowed query composition and redacted errors.
- Frontend tests for loading, unavailable, empty, and partial source states.
- `cd web && npm test`
- `cd web && npm run build`
- `go test ./...` when backend code changes.

Manual QA should verify:

- Platform Admin with Prometheus configured.
- Platform Admin with Prometheus unset.
- Platform Admin with Prometheus returning one down target.
- Customer user route guard.
- Mobile-width layout without table/control overflow.

## Open Questions

### [REQ-CA-DASHBOARD-DECISIONS-001] Deferred dashboard naming precedence and SRE-link decisions remain planned

<!-- rtk-requirement
{"acceptance_layer":"supporting","gate":"none","environments":["review"],"evidence":["json"],"required":false,"status":"planned"}
-->

Planning note: Product and SRE owners will decide the final visible page label, readiness-source precedence, and optional Grafana host-detail linking before those choices become required product behavior.

1. Should the visible page label be `Platform Dashboard`, `Platform Overview`,
   or `Operations Dashboard`?
2. Which source should win when Admin BFF readiness counts and
   `video_cloud_devices_*` aggregate metrics disagree?
4. Should SRE-only host detail links point to a future Grafana URL when Grafana
   exists, or remain text-only in this product UI?
