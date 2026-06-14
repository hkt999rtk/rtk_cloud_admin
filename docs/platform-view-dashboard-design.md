# Platform View Dashboard Design

Status: draft for product, UX, SRE, and developer review.

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

Recommended Platform View nav order:

1. Platform Dashboard
2. Service Health
3. Brand Clouds
4. SSO Providers
5. Operations Log
6. Audit Log

`Service Health` remains a dedicated drill-down page. `Platform Dashboard`
summarizes service and metrics health at a higher level and links to deeper
surfaces.

## Page Layout

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

## Required Tests

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

1. Should the visible page label be `Platform Dashboard`, `Platform Overview`,
   or `Operations Dashboard`?
2. Which source should win when Admin BFF readiness counts and
   `video_cloud_devices_*` aggregate metrics disagree?
4. Should SRE-only host detail links point to a future Grafana URL when Grafana
   exists, or remain text-only in this product UI?
