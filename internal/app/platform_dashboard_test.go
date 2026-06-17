package app

import (
	"encoding/json"
	"math"
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

func TestAdminGrafanaStatusRequiresPlatformSession(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := New(st)

	unauthenticated := httptest.NewRecorder()
	srv.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/admin/grafana/status", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want %d", unauthenticated.Code, http.StatusUnauthorized)
	}

	customer, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	customerReq := httptest.NewRequest(http.MethodGet, "/api/admin/grafana/status", nil)
	customerReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: customer.ID})
	customerRec := httptest.NewRecorder()
	srv.ServeHTTP(customerRec, customerReq)
	if customerRec.Code != http.StatusForbidden {
		t.Fatalf("customer status = %d, want %d; body=%s", customerRec.Code, http.StatusForbidden, customerRec.Body.String())
	}
}

func TestAdminGrafanaStatusReturnsSameOriginIframeURL(t *testing.T) {
	t.Parallel()

	grafana := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			_, _ = w.Write([]byte(`{"database":"ok"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer grafana.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{
		GrafanaBaseURL:       grafana.URL,
		GrafanaDashboardPath: "/d/rtk-lke-staging/rtk-lke-staging-overview",
	}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/grafana/status", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var status contracts.PlatformGrafanaStatus
	if err := json.NewDecoder(rec.Body).Decode(&status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !status.Enabled || status.SourceStatus != "configured" {
		t.Fatalf("grafana status = %+v, want enabled configured", status)
	}
	if status.IframeURL != "/api/admin/grafana/d/rtk-lke-staging/rtk-lke-staging-overview?orgId=1&kiosk" {
		t.Fatalf("iframe_url = %q", status.IframeURL)
	}
}

func TestAdminGrafanaProxyInjectsTrustedAuthHeaders(t *testing.T) {
	t.Parallel()

	var upstreamPath string
	var upstreamQuery string
	var upstreamUser string
	var upstreamEmail string
	var upstreamRole string
	grafana := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamPath = r.URL.Path
		upstreamQuery = r.URL.RawQuery
		upstreamUser = r.Header.Get("X-WEBAUTH-USER")
		upstreamEmail = r.Header.Get("X-WEBAUTH-EMAIL")
		upstreamRole = r.Header.Get("X-WEBAUTH-ROLE")
		_, _ = w.Write([]byte("grafana ok"))
	}))
	defer grafana.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{GrafanaBaseURL: grafana.URL}})
	session, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/grafana/d/rtk-lke-staging/overview?orgId=1", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	req.Header.Set("X-WEBAUTH-USER", "spoofed")
	req.Header.Set("X-WEBAUTH-EMAIL", "spoofed@example.com")
	req.Header.Set("X-WEBAUTH-ROLE", "Admin")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "grafana ok" {
		t.Fatalf("proxy response = %d %q", rec.Code, rec.Body.String())
	}
	if upstreamPath != "/d/rtk-lke-staging/overview" || upstreamQuery != "orgId=1" {
		t.Fatalf("upstream target = %s?%s", upstreamPath, upstreamQuery)
	}
	if upstreamUser != "admin-1" || upstreamEmail != "admin@example.com" || upstreamRole != "Viewer" {
		t.Fatalf("trusted headers user/email/role = %q/%q/%q", upstreamUser, upstreamEmail, upstreamRole)
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
		case query == `sum by(job, service, role) (up == bool 0)`:
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
		case query == `sum by(job, service, role) (up == bool 0)`:
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
		case query == `sum by(job, service, role) (up == bool 0)`:
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
		"infra_network_in_bps",
		"infra_network_out_bps",
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
		case strings.Contains(query, "node_network_receive"):
			if strings.Contains(query, "device!~") == false {
				t.Fatalf("network receive query did not filter interfaces: %s", query)
			}
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"edge","instance":"10.42.1.5:9100","device":"eth0"},"value":[1780369304,"18000000"]},{"metric":{"job":"node","role":"api","instance":"10.42.1.10:9100","device":"eth0"},"value":[1780369304,"4800000"]}]}}`))
		case strings.Contains(query, "node_network_transmit"):
			if strings.Contains(query, "device!~") == false {
				t.Fatalf("network transmit query did not filter interfaces: %s", query)
			}
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"edge","instance":"10.42.1.5:9100","device":"eth0"},"value":[1780369304,"6100000"]},{"metric":{"job":"node","role":"api","instance":"10.42.1.10:9100","device":"eth0"},"value":[1780369304,"9400000"]}]}}`))
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
	if edge.NetworkInBPS == nil || *edge.NetworkInBPS != 18000000 || edge.NetworkOutBPS == nil || *edge.NetworkOutBPS != 6100000 {
		t.Fatalf("edge network = in %v out %v, want 18000000/6100000", edge.NetworkInBPS, edge.NetworkOutBPS)
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

func TestAdminPlatformDashboardBuildsServiceExporterStatus(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch query := r.URL.Query().Get("query"); {
		case query == `sum by(job, service, role) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"account_manager_app","service":"account-manager","instance":"10.42.1.50:18081"},"value":[1780369304,"1"]},{"metric":{"job":"cloud_admin_app","service":"cloud-admin","instance":"10.42.1.60:8080"},"value":[1780369304,"1"]},{"metric":{"job":"cloud_logger_app","service":"cloud-logger","instance":"10.42.1.90:18090"},"value":[1780369304,"1"]},{"metric":{"job":"coturn_node","service":"coturn-node","role":"coturn","instance":"10.42.1.80:9100"},"value":[1780369304,"1"]}]}}`))
		case query == `sum by(job, service, role) (up == bool 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"account_manager_app","service":"account-manager","instance":"10.42.1.50:18081"},"value":[1780369304,"0"]},{"metric":{"job":"cloud_admin_app","service":"cloud-admin","instance":"10.42.1.60:8080"},"value":[1780369304,"0"]},{"metric":{"job":"cloud_logger_app","service":"cloud-logger","instance":"10.42.1.90:18090"},"value":[1780369304,"0"]},{"metric":{"job":"coturn_node","service":"coturn-node","role":"coturn","instance":"10.42.1.80:9100"},"value":[1780369304,"0"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"node","role":"infra","instance":"10.42.1.30:9100"},"value":[1780369304,"1"]}]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	for _, id := range []string{"account-manager", "cloud-admin", "cloud-logger", "coturn"} {
		exporter := serviceExporter(payload.ServiceExporters, id)
		if exporter.Status != "ok" || exporter.SourceStatus != "configured" || exporter.TargetsUp != 1 || exporter.TargetsDown != 0 {
			t.Fatalf("%s exporter = %+v, want ok configured 1 up", id, exporter)
		}
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

func TestAdminPlatformDashboardServiceExporterCountsDownOnlyTarget(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch query := r.URL.Query().Get("query"); {
		case query == `sum by(job, service, role) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"cloud_logger_app","service":"cloud-logger","instance":"10.42.1.90:18090"},"value":[1780369304,"0"]}]}}`))
		case query == `sum by(job, service, role) (up == bool 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"cloud_logger_app","service":"cloud-logger","instance":"10.42.1.90:18090"},"value":[1780369304,"1"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	exporter := serviceExporter(payload.ServiceExporters, "cloud-logger")
	if exporter.Status != "degraded" || exporter.TargetsUp != 0 || exporter.TargetsDown != 1 || exporter.TargetsTotal != 1 {
		t.Fatalf("cloud logger exporter = %+v, want degraded 0 up / 1 down / 1 total", exporter)
	}
	if kpiValue(payload.KPIs, "scrape_targets_down") != 1 {
		t.Fatalf("scrape_targets_down KPI = %v, want 1", kpiValue(payload.KPIs, "scrape_targets_down"))
	}
}

func TestAdminPlatformDashboardBuildsK8sServiceWorkloadAndNodeHealth(t *testing.T) {
	t.Parallel()

	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		switch {
		case query == `sum by(job, service, namespace) (up)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"cloud_admin_app","service":"cloud-admin","namespace":"video-cloud-staging","instance":"10.0.0.1:8080"},"value":[1780369304,"1"]}]}}`))
		case query == `sum by(job, service, namespace) (up == bool 0)`:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"job":"cloud_admin_app","service":"cloud-admin","namespace":"video-cloud-staging","instance":"10.0.0.1:8080"},"value":[1780369304,"0"]}]}}`))
		case strings.Contains(query, "http_requests_total"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"service":"cloud-admin","namespace":"video-cloud-staging","pod":"cloud-admin-abc"},"value":[1780369304,"12.5"]}]}}`))
		case strings.Contains(query, `http_status_group_total{status="5xx"}`):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"service":"cloud-admin","namespace":"video-cloud-staging","pod":"cloud-admin-abc"},"value":[1780369304,"0.25"]}]}}`))
		case strings.Contains(query, "http_request_duration_seconds_sum"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"service":"cloud-admin","namespace":"video-cloud-staging","pod":"cloud-admin-abc"},"value":[1780369304,"0.08"]}]}}`))
		case strings.Contains(query, "kube_deployment_spec_replicas"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"namespace":"video-cloud-staging","deployment":"cloud-admin"},"value":[1780369304,"3"]}]}}`))
		case strings.Contains(query, "kube_deployment_status_replicas_available"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"namespace":"video-cloud-staging","deployment":"cloud-admin"},"value":[1780369304,"2"]}]}}`))
		case strings.Contains(query, "kube_pod_status_ready"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"namespace":"video-cloud-staging","pod":"cloud-admin-abc","condition":"true","uid":"pod-secret"},"value":[1780369304,"2"]}]}}`))
		case strings.Contains(query, "kube_pod_container_status_restarts_total"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"namespace":"video-cloud-staging","pod":"cloud-admin-abc","container":"app"},"value":[1780369304,"4"]}]}}`))
		case strings.Contains(query, `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}`):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"namespace":"video-cloud-staging","pod":"cloud-admin-abc","container":"app","reason":"CrashLoopBackOff"},"value":[1780369304,"1"]}]}}`))
		case strings.Contains(query, "kube_node_status_condition"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"node":"lke-node-1","condition":"Ready","status":"true","instance":"10.0.0.2"},"value":[1780369304,"1"]}]}}`))
		case strings.Contains(query, "container_cpu_usage_seconds_total"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"node":"lke-node-1","container":"app"},"value":[1780369304,"37"]}]}}`))
		case strings.Contains(query, "container_memory_working_set_bytes"):
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"node":"lke-node-1","container":"app"},"value":[1780369304,"64"]}]}}`))
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
		}
	}))
	defer prometheus.Close()

	payload := getPlatformDashboardForPrometheus(t, prometheus.URL)
	service := serviceMetric(payload.ServiceMetrics, "cloud-admin")
	if service.Status != "warning" || service.TargetsUp != 1 || service.RequestRate == nil || *service.RequestRate != 12.5 || service.ErrorRate5xx == nil || *service.ErrorRate5xx != 0.25 {
		t.Fatalf("cloud-admin service metric = %+v, want warning with request and 5xx rates", service)
	}
	workload := workloadHealth(payload.WorkloadHealth, "video-cloud-staging", "cloud-admin")
	if workload.Status != "crashloop" || workload.DesiredReplicas != 3 || workload.AvailableReplicas != 2 || workload.ReadyPods != 2 || workload.RestartCount != 4 || workload.CrashLoopPods != 1 {
		t.Fatalf("cloud-admin workload = %+v, want degraded crashloop k8s status", workload)
	}
	node := clusterNode(payload.ClusterNodes, "lke-node-1")
	if node.Status != "ok" || node.Ready != true || node.CPUPercent == nil || *node.CPUPercent != 37 || node.MemoryPercent == nil || *node.MemoryPercent != 64 {
		t.Fatalf("cluster node = %+v, want ready with CPU/memory snapshot", node)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"instance", "10.0.0.", "uid", "pod-secret", "container"} {
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

func TestPrometheusValuesRejectNonFiniteSamples(t *testing.T) {
	t.Parallel()

	for _, sample := range []any{"NaN", "+Inf", "-Inf", math.NaN(), math.Inf(1), math.Inf(-1)} {
		if value, ok := prometheusSampleValue(sample); ok {
			t.Fatalf("prometheusSampleValue(%v) = %v, true; want rejected", sample, value)
		}
	}
	item := prometheusVectorItem{Value: []any{float64(1780369304), "NaN"}}
	if value, ok := item.floatValue(); ok {
		t.Fatalf("floatValue NaN = %v, true; want rejected", value)
	}
}

func TestAdminPlatformResourceTrendsBuildsSanitizedSeriesAndSummaries(t *testing.T) {
	t.Parallel()

	seen := map[string]url.Values{}
	prometheus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/query_range" {
			t.Fatalf("path = %q, want /api/v1/query_range", r.URL.Path)
		}
		query := r.URL.Query().Get("query")
		seen[query] = r.URL.Query()
		metric := map[string]any{"job": "node", "role": "edge", "instance": "10.42.1.5:9100", "device": "eth0"}
		values := []any{[]any{1780369200, "10"}, []any{1780369500, "20"}, []any{1780369800, "30"}}
		if strings.Contains(query, "node_network_receive") {
			values = []any{[]any{1780369200, "1000"}, []any{1780369500, "2000"}, []any{1780369800, "3000"}}
		}
		if strings.Contains(query, "node_network_transmit") {
			values = []any{[]any{1780369200, "4000"}, []any{1780369500, "5000"}, []any{1780369800, "6000"}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]any{
				"resultType": "matrix",
				"result": []map[string]any{{
					"metric": metric,
					"values": values,
				}},
			},
		})
	}))
	defer prometheus.Close()

	payload := getPlatformResourceTrendsForPrometheus(t, prometheus.URL, "7d")
	if payload.Range != "7d" || payload.StepSeconds != 3600 {
		t.Fatalf("range/step = %s/%d, want 7d/3600", payload.Range, payload.StepSeconds)
	}
	if payload.Source.SourceStatus != "configured" {
		t.Fatalf("source = %q, want configured", payload.Source.SourceStatus)
	}
	if len(payload.Summaries) != 8 {
		t.Fatalf("summary count = %d, want 8", len(payload.Summaries))
	}
	edge := resourceTrendSummary(payload.Summaries, "edge")
	if edge.CPUPercent.Current == nil || *edge.CPUPercent.Current != 30 || edge.CPUPercent.P95 == nil || *edge.CPUPercent.P95 == 0 {
		t.Fatalf("edge CPU summary = %+v, want current 30 and p95", edge.CPUPercent)
	}
	if edge.NetworkInBPS.Max == nil || *edge.NetworkInBPS.Max != 3000 || edge.NetworkOutBPS.Max == nil || *edge.NetworkOutBPS.Max != 6000 {
		t.Fatalf("edge network summary = in %+v out %+v, want max 3000/6000", edge.NetworkInBPS, edge.NetworkOutBPS)
	}
	coturn := resourceTrendSummary(payload.Summaries, "coturn")
	if coturn.SourceStatus != "unmonitored" {
		t.Fatalf("coturn source status = %q, want unmonitored", coturn.SourceStatus)
	}
	if len(seen) != len(platformResourceTrendQueries) {
		t.Fatalf("query_range count = %d, want %d", len(seen), len(platformResourceTrendQueries))
	}
	for query, values := range seen {
		if values.Get("step") != "3600" {
			t.Fatalf("%s step = %q, want 3600", query, values.Get("step"))
		}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	for _, leaked := range []string{"instance", "10.42.1.", "device", "eth0"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("payload leaked disallowed label %q: %s", leaked, body)
		}
	}
}

func TestAdminPlatformResourceTrendsUnavailablePrometheusKeepsRows(t *testing.T) {
	t.Parallel()

	payload := getPlatformResourceTrendsForPrometheus(t, "http://127.0.0.1:1", "90d")
	if payload.Range != "90d" || payload.StepSeconds != 86400 {
		t.Fatalf("range/step = %s/%d, want 90d/86400", payload.Range, payload.StepSeconds)
	}
	if payload.Source.SourceStatus != "unavailable" {
		t.Fatalf("source = %q, want unavailable", payload.Source.SourceStatus)
	}
	if len(payload.Summaries) != 8 {
		t.Fatalf("summary count = %d, want 8", len(payload.Summaries))
	}
	if len(payload.Series) != len(platformResourceTrendQueries)*len(platformDashboardServerResources) {
		t.Fatalf("series count = %d, want per metric/server unavailable series", len(payload.Series))
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
		`sum by(job, service, role) (up == bool 0)`,
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

func getPlatformResourceTrends(t *testing.T, srv http.Handler, sessionID string, trendRange string) contracts.PlatformResourceTrends {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/platform-resource-trends?range="+url.QueryEscape(trendRange), nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("platform resource trends status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.PlatformResourceTrends
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode platform resource trends: %v", err)
	}
	return payload
}

func getPlatformResourceTrendsForPrometheus(t *testing.T, prometheusBaseURL string, trendRange string) contracts.PlatformResourceTrends {
	t.Helper()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{VideoCloudPrometheusBaseURL: prometheusBaseURL}})
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	return getPlatformResourceTrends(t, srv, session.ID, trendRange)
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

func serviceExporter(exporters []contracts.PlatformDashboardServiceExporter, id string) contracts.PlatformDashboardServiceExporter {
	for _, exporter := range exporters {
		if exporter.ID == id {
			return exporter
		}
	}
	return contracts.PlatformDashboardServiceExporter{}
}

func serviceMetric(metrics []contracts.PlatformDashboardServiceMetric, service string) contracts.PlatformDashboardServiceMetric {
	for _, metric := range metrics {
		if metric.Service == service {
			return metric
		}
	}
	return contracts.PlatformDashboardServiceMetric{}
}

func workloadHealth(workloads []contracts.PlatformDashboardWorkloadHealth, namespace string, name string) contracts.PlatformDashboardWorkloadHealth {
	for _, workload := range workloads {
		if workload.Namespace == namespace && workload.Name == name {
			return workload
		}
	}
	return contracts.PlatformDashboardWorkloadHealth{}
}

func clusterNode(nodes []contracts.PlatformDashboardClusterNode, name string) contracts.PlatformDashboardClusterNode {
	for _, node := range nodes {
		if node.Name == name {
			return node
		}
	}
	return contracts.PlatformDashboardClusterNode{}
}

func resourceTrendSummary(summaries []contracts.PlatformResourceTrendSummary, id string) contracts.PlatformResourceTrendSummary {
	for _, summary := range summaries {
		if summary.ServerID == id {
			return summary
		}
	}
	return contracts.PlatformResourceTrendSummary{}
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
