package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
)

func TestAdminPlatformDashboardRequiresPlatformSession(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := New(st)

	unauthenticated := httptest.NewRecorder()
	srv.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/admin/platform-dashboard", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want %d", unauthenticated.Code, http.StatusUnauthorized)
	}

	customer, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	customerReq := httptest.NewRequest(http.MethodGet, "/api/admin/platform-dashboard", nil)
	customerReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: customer.ID})
	customerRec := httptest.NewRecorder()
	srv.ServeHTTP(customerRec, customerReq)
	if customerRec.Code != http.StatusForbidden {
		t.Fatalf("customer status = %d, want %d; body=%s", customerRec.Code, http.StatusForbidden, customerRec.Body.String())
	}
}

func TestAdminPlatformDashboardUnconfiguredPrometheusReturnsSummary(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := New(st)
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	payload := getPlatformDashboard(t, srv, session.ID)
	if payload.Summary.TotalDevices == 0 || payload.Summary.Customers == 0 {
		t.Fatalf("summary did not include BFF data: %+v", payload.Summary)
	}
	source := payload.Sources["prometheus"]
	if source.SourceStatus != "unconfigured" {
		t.Fatalf("prometheus source_status = %q, want unconfigured", source.SourceStatus)
	}
	if len(payload.Prometheus.Queries) == 0 {
		t.Fatalf("prometheus queries are empty")
	}
	if kpiValue(payload.KPIs, "tenants") != float64(payload.Summary.Customers) {
		t.Fatalf("tenants KPI = %v, want %d", kpiValue(payload.KPIs, "tenants"), payload.Summary.Customers)
	}
	if kpiStatus(payload.KPIs, "scrape_targets_down") != "unconfigured" {
		t.Fatalf("scrape_targets_down KPI status = %q, want unconfigured", kpiStatus(payload.KPIs, "scrape_targets_down"))
	}
	if len(payload.ServiceScrapeHealth) != 5 {
		t.Fatalf("service scrape group count = %d, want 5", len(payload.ServiceScrapeHealth))
	}
	for _, group := range payload.ServiceScrapeHealth {
		if group.SourceStatus != "unconfigured" || group.Status != "unconfigured" {
			t.Fatalf("group %s source/status = %s/%s, want unconfigured/unconfigured", group.ID, group.SourceStatus, group.Status)
		}
	}
	if payload.PanelSources["service_scrape_health"].SourceStatus != "unconfigured" {
		t.Fatalf("service_scrape_health panel source = %q, want unconfigured", payload.PanelSources["service_scrape_health"].SourceStatus)
	}
	for _, query := range payload.Prometheus.Queries {
		if query.SourceStatus != "unconfigured" {
			t.Fatalf("%s source_status = %q, want unconfigured", query.ID, query.SourceStatus)
		}
	}
}

func TestAdminPlatformDashboardPrometheusUnavailableIsRedacted(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `upstream_operation_id=op-9 raw_payload={"secret":true}`, http.StatusBadGateway)
	}))
	defer prometheus.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{VideoCloudPrometheusBaseURL: prometheus.URL}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	payload := getPlatformDashboard(t, srv, session.ID)
	if payload.Summary.TotalDevices == 0 {
		t.Fatalf("summary degraded with prometheus failure: %+v", payload.Summary)
	}
	source := payload.Sources["prometheus"]
	if source.SourceStatus != "unavailable" {
		t.Fatalf("prometheus source_status = %q, want unavailable", source.SourceStatus)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"raw_payload", "op-9", "secret", "upstream_operation_id"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("payload leaked %q: %s", leaked, body)
		}
	}
}

func TestAdminPlatformDashboardPrometheusEmptyResponse(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer prometheus.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{VideoCloudPrometheusBaseURL: prometheus.URL}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	payload := getPlatformDashboard(t, srv, session.ID)
	if payload.Sources["prometheus"].SourceStatus != "empty" {
		t.Fatalf("prometheus source_status = %q, want empty", payload.Sources["prometheus"].SourceStatus)
	}
	for _, query := range payload.Prometheus.Queries {
		if query.SourceStatus != "empty" {
			t.Fatalf("%s source_status = %q, want empty", query.ID, query.SourceStatus)
		}
	}
	for _, group := range payload.ServiceScrapeHealth {
		if group.Status != "empty" {
			t.Fatalf("%s status = %q, want empty", group.ID, group.Status)
		}
	}
}

func TestAdminPlatformDashboardAllTargetsUpFixture(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch query := r.URL.Query().Get("query"); {
		case query == `sum by(job, service, role) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"2"]},{"metric":{"job":"node","role":"api"},"value":[1780369304,"1"]},{"metric":{"job":"postgres","role":"infra"},"value":[1780369304,"1"]},{"metric":{"job":"emqx","role":"mqtt"},"value":[1780369304,"1"]},{"metric":{"job":"nginx","role":"gateway"},"value":[1780369304,"1"]}]}}`))
		case query == `sum by(job, service, role) (up == 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"0"]},{"metric":{"job":"node","role":"api"},"value":[1780369304,"0"]},{"metric":{"job":"postgres","role":"infra"},"value":[1780369304,"0"]},{"metric":{"job":"emqx","role":"mqtt"},"value":[1780369304,"0"]},{"metric":{"job":"nginx","role":"gateway"},"value":[1780369304,"0"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"metricsexporter"},"value":[1780369304,"60"]}]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	if payload.Sources["prometheus"].SourceStatus != "configured" {
		t.Fatalf("prometheus source = %q, want configured", payload.Sources["prometheus"].SourceStatus)
	}
	if kpiValue(payload.KPIs, "scrape_targets_down") != 0 {
		t.Fatalf("scrape_targets_down KPI = %v, want 0", kpiValue(payload.KPIs, "scrape_targets_down"))
	}
	wantTotals := map[string]int{"app": 2, "host": 1, "data": 1, "broker": 1, "gateway": 1}
	for _, group := range payload.ServiceScrapeHealth {
		if group.Status != "ok" {
			t.Fatalf("%s status = %q, want ok", group.ID, group.Status)
		}
		if group.TargetsTotal != wantTotals[group.ID] {
			t.Fatalf("%s targets_total = %d, want %d", group.ID, group.TargetsTotal, wantTotals[group.ID])
		}
	}
}

func TestAdminPlatformDashboardOneTargetDownFixture(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch query := r.URL.Query().Get("query"); {
		case query == `sum by(job, service, role) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"1"]},{"metric":{"job":"nginx","role":"gateway"},"value":[1780369304,"1"]}]}}`))
		case query == `sum by(job, service, role) (up == 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"1"]},{"metric":{"job":"nginx","role":"gateway"},"value":[1780369304,"0"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"metricsexporter"},"value":[1780369304,"60"]}]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	if kpiValue(payload.KPIs, "scrape_targets_down") != 1 {
		t.Fatalf("scrape_targets_down KPI = %v, want 1", kpiValue(payload.KPIs, "scrape_targets_down"))
	}
	app := scrapeGroup(payload.ServiceScrapeHealth, "app")
	if app.Status != "degraded" || app.TargetsUp != 1 || app.TargetsDown != 1 || app.TargetsTotal != 2 {
		t.Fatalf("app group = %+v, want degraded 1 up / 1 down / 2 total", app)
	}
	gateway := scrapeGroup(payload.ServiceScrapeHealth, "gateway")
	if gateway.Status != "ok" || gateway.TargetsDown != 0 {
		t.Fatalf("gateway group = %+v, want ok with 0 down", gateway)
	}
}

func TestAdminPlatformDashboardMissingSeriesFixture(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch query := r.URL.Query().Get("query"); {
		case query == `sum by(job, service, role) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"1"]}]}}`))
		case query == `sum by(job, service, role) (up == 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app"},"value":[1780369304,"0"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"metricsexporter"},"value":[1780369304,"60"]}]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	if scrapeGroup(payload.ServiceScrapeHealth, "app").Status != "ok" {
		t.Fatalf("app group = %+v, want ok", scrapeGroup(payload.ServiceScrapeHealth, "app"))
	}
	for _, id := range []string{"host", "data", "broker", "gateway"} {
		group := scrapeGroup(payload.ServiceScrapeHealth, id)
		if group.Status != "empty" || group.TargetsTotal != 0 {
			t.Fatalf("%s group = %+v, want empty with no targets", id, group)
		}
	}
}

func TestAdminPlatformDashboardRepresentativeMetricFamilies(t *testing.T) {
	t.Parallel()

	seen := map[string]bool{}
	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		seen[query] = true
		metric := map[string]any{"job": "video_cloud_app", "service": "api", "role": "app", "device_id": "dev-secret", "instance": "10.0.0.1:9100"}
		value := "1"
		if strings.Contains(query, "node_cpu") || strings.Contains(query, "node_memory") || strings.Contains(query, "node_filesystem") || strings.Contains(query, "blob_capacity") {
			metric = map[string]any{"job": "node", "role": "infra", "instance": "10.0.0.1:9100"}
			value = "42"
		}
		if strings.Contains(query, "consumer_pending") || strings.Contains(query, "dead_letters") || strings.Contains(query, "publish_total") || strings.Contains(query, "consume_total") {
			metric = map[string]any{"job": "video_cloud_app", "service": "crossservice", "consumer": "sensitive-consumer"}
			value = "2"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]any{
				"resultType": "vector",
				"result": []map[string]any{{
					"metric": metric,
					"value":  []any{1780369304, value},
				}},
			},
		})
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	queries := map[string]contracts.PlatformDashboardPrometheusQuery{}
	for _, query := range payload.Prometheus.Queries {
		queries[query.ID] = query
	}
	for _, id := range []string{
		"runtime_request_rate",
		"runtime_5xx_rate",
		"runtime_avg_latency_seconds",
		"app_up",
		"crossservice_consumer_backlog",
		"crossservice_dead_letters",
		"crossservice_publish_errors",
		"crossservice_consume_errors",
		"business_video_devices_online",
		"business_blob_utilization_percent",
		"business_exporter_success",
		"business_quota_requests",
		"business_eval_signups_24h",
		"infra_cpu_utilization_percent",
		"infra_memory_utilization_percent",
		"infra_disk_utilization_percent",
	} {
		if queries[id].SourceStatus != "configured" {
			t.Fatalf("%s source_status = %q, want configured", id, queries[id].SourceStatus)
		}
	}
	if len(seen) != len(platformDashboardPrometheusQueries) {
		t.Fatalf("seen query count = %d, want %d", len(seen), len(platformDashboardPrometheusQueries))
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"device_id", "dev-secret", "instance", "10.0.0.1", "sensitive-consumer"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("payload leaked disallowed label %q: %s", leaked, body)
		}
	}
}

func TestAdminPlatformDashboardBuildsSanitizedServerResources(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		switch {
		case strings.Contains(query, "node_cpu"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"edge","instance":"10.42.1.5:9100"},"value":[1780369304,"71"]},{"metric":{"job":"node","role":"api","instance":"10.42.1.10:9100"},"value":[1780369304,"86"]},{"metric":{"job":"node","role":"infra","instance":"10.42.1.30:9100"},"value":[1780369304,"12"]},{"metric":{"job":"node","role":"mqtt","instance":"10.42.1.40:9100"},"value":[1780369304,"44"]},{"metric":{"job":"node","role":"admin","instance":"10.42.1.60:9100"},"value":[1780369304,"25"]}]}}`))
		case strings.Contains(query, "node_memory"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"edge","instance":"10.42.1.5:9100"},"value":[1780369304,"20"]},{"metric":{"job":"node","role":"api","instance":"10.42.1.10:9100"},"value":[1780369304,"50"]},{"metric":{"job":"node","role":"infra","instance":"10.42.1.30:9100"},"value":[1780369304,"91"]},{"metric":{"job":"node","role":"mqtt","instance":"10.42.1.40:9100"},"value":[1780369304,"76"]},{"metric":{"job":"node","role":"admin","instance":"10.42.1.60:9100"},"value":[1780369304,"30"]}]}}`))
		case strings.Contains(query, "node_filesystem"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"edge","instance":"10.42.1.5:9100"},"value":[1780369304,"10"]},{"metric":{"job":"node","role":"api","instance":"10.42.1.10:9100"},"value":[1780369304,"40"]},{"metric":{"job":"node","role":"infra","instance":"10.42.1.30:9100"},"value":[1780369304,"92"]},{"metric":{"job":"node","role":"mqtt","instance":"10.42.1.40:9100"},"value":[1780369304,"20"]},{"metric":{"job":"node","role":"admin","instance":"10.42.1.60:9100"},"value":[1780369304,"78"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app","instance":"10.42.1.10:18080"},"value":[1780369304,"1"]}]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	if len(payload.ServerResources) != 8 {
		t.Fatalf("server_resources count = %d, want 8: %+v", len(payload.ServerResources), payload.ServerResources)
	}
	edge := serverResource(payload.ServerResources, "edge")
	if edge.Status != "warning" || edge.CPUPercent == nil || *edge.CPUPercent != 71 {
		t.Fatalf("edge resource = %+v, want warning CPU 71", edge)
	}
	api := serverResource(payload.ServerResources, "api")
	if api.Status != "critical" || api.CPUPercent == nil || *api.CPUPercent != 86 {
		t.Fatalf("api resource = %+v, want critical CPU 86", api)
	}
	infra := serverResource(payload.ServerResources, "infra")
	if infra.Status != "critical" || infra.MemoryPercent == nil || *infra.MemoryPercent != 91 || infra.DiskPercent == nil || *infra.DiskPercent != 92 {
		t.Fatalf("infra resource = %+v, want critical memory 91 disk 92", infra)
	}
	mqtt := serverResource(payload.ServerResources, "mqtt")
	if mqtt.Status != "warning" || mqtt.MemoryPercent == nil || *mqtt.MemoryPercent != 76 {
		t.Fatalf("mqtt resource = %+v, want warning memory 76", mqtt)
	}
	coturn := serverResource(payload.ServerResources, "coturn")
	if coturn.Status != "unmonitored" || coturn.SourceStatus != "unmonitored" || coturn.CPUPercent != nil || coturn.MemoryPercent != nil || coturn.DiskPercent != nil {
		t.Fatalf("coturn resource = %+v, want unmonitored with empty metrics", coturn)
	}
	logger := serverResource(payload.ServerResources, "cloud-logger")
	if logger.Status != "unmonitored" || logger.SourceStatus != "unmonitored" {
		t.Fatalf("cloud-logger resource = %+v, want unmonitored", logger)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"instance", "10.42.1.", "device_id", "dev-secret"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("payload leaked disallowed label %q: %s", leaked, body)
		}
	}
}

func TestAdminPlatformDashboardServerResourcesUnavailableWithoutPrometheus(t *testing.T) {
	t.Parallel()

	payload := getPlatformDashboardForPrometheus(t, "http://127.0.0.1:1")
	if len(payload.ServerResources) != 8 {
		t.Fatalf("server_resources count = %d, want 8", len(payload.ServerResources))
	}
	for _, resource := range payload.ServerResources {
		if resource.Status != "unmonitored" || resource.SourceStatus != "unavailable" {
			t.Fatalf("resource %s status/source = %s/%s, want unmonitored/unavailable", resource.ID, resource.Status, resource.SourceStatus)
		}
	}
}

func TestAdminPlatformDashboardPrometheusConfiguredAndStale(t *testing.T) {
	t.Parallel()

	seenQueries := map[string]bool{}
	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		seenQueries[query] = true
		if strings.Contains(query, "exporter_last_collect") {
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"metricsexporter","device_id":"dev-secret","instance":"10.0.0.1:9100"},"value":[1780369304,"900"]}]}}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"video_cloud_app","service":"api","role":"app","device_id":"dev-secret","instance":"10.0.0.1:9100"},"value":[1780369304,"1"]}]}}`))
	}))
	defer prometheus.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{VideoCloudPrometheusBaseURL: prometheus.URL}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	payload := getPlatformDashboard(t, srv, session.ID)
	if payload.Sources["prometheus"].SourceStatus != "stale" {
		t.Fatalf("prometheus source_status = %q, want stale", payload.Sources["prometheus"].SourceStatus)
	}
	for _, want := range []string{
		`sum by(job, service, role) (up)`,
		`sum by(job, service, role) (up == 0)`,
		`time() - video_cloud_exporter_last_collect_timestamp_seconds`,
	} {
		if !seenQueries[want] {
			t.Fatalf("prometheus did not receive allowlisted query %q; got %#v", want, seenQueries)
		}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"device_id", "dev-secret", "instance", "10.0.0.1"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("payload leaked disallowed label %q: %s", leaked, body)
		}
	}
}

func getPlatformDashboard(t *testing.T, srv http.Handler, sessionID string) contracts.PlatformDashboard {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/platform-dashboard", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("platform dashboard status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.PlatformDashboard
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode platform dashboard: %v", err)
	}
	return payload
}

func getPlatformDashboardForPrometheus(t *testing.T, prometheusBaseURL string) contracts.PlatformDashboard {
	t.Helper()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{VideoCloudPrometheusBaseURL: prometheusBaseURL}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	return getPlatformDashboard(t, srv, session.ID)
}

func kpiValue(kpis []contracts.PlatformDashboardKPI, id string) float64 {
	for _, kpi := range kpis {
		if kpi.ID == id {
			return kpi.Value
		}
	}
	return -1
}

func kpiStatus(kpis []contracts.PlatformDashboardKPI, id string) string {
	for _, kpi := range kpis {
		if kpi.ID == id {
			return kpi.SourceStatus
		}
	}
	return ""
}

func scrapeGroup(groups []contracts.PlatformDashboardServiceScrapeHealth, id string) contracts.PlatformDashboardServiceScrapeHealth {
	for _, group := range groups {
		if group.ID == id {
			return group
		}
	}
	return contracts.PlatformDashboardServiceScrapeHealth{}
}

func serverResource(resources []contracts.PlatformDashboardServerResource, id string) contracts.PlatformDashboardServerResource {
	for _, resource := range resources {
		if resource.ID == id {
			return resource
		}
	}
	return contracts.PlatformDashboardServerResource{}
}

func TestPrometheusClientRejectsInvalidBaseURL(t *testing.T) {
	t.Parallel()

	client := newPrometheusClient("://bad-url")
	if _, err := client.query(t.Context(), platformDashboardPrometheusQueries[0]); err == nil {
		t.Fatalf("query returned nil error for invalid URL")
	}
}

func TestPrometheusClientUsesQueryEndpoint(t *testing.T) {
	t.Parallel()

	var gotPath string
	var gotQuery string
	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer prometheus.Close()

	client := newPrometheusClient(strings.TrimRight(prometheus.URL, "/") + "/")
	if _, err := client.query(t.Context(), platformDashboardPrometheusQueries[0]); err != nil {
		t.Fatalf("query returned error: %v", err)
	}
	if gotPath != "/api/v1/query" {
		t.Fatalf("path = %q, want /api/v1/query", gotPath)
	}
	if _, err := url.ParseQuery("query=" + url.QueryEscape(gotQuery)); err != nil || gotQuery != platformDashboardPrometheusQueries[0].Query {
		t.Fatalf("query = %q, want %q", gotQuery, platformDashboardPrometheusQueries[0].Query)
	}
}
