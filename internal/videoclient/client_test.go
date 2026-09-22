package videoclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthSucceedsWithoutBearerToken(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Fatalf("path = %q, want /healthz", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("Authorization = %q, want empty", got)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	}))
	defer upstream.Close()

	if err := New(upstream.URL + "/").Health(t.Context()); err != nil {
		t.Fatalf("Health returned error: %v", err)
	}
}

func TestHealthRejectsUpstreamError(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "failed", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	if err := New(upstream.URL).Health(t.Context()); err == nil {
		t.Fatal("expected health error")
	}
}

func TestHealthHonorsContextTimeout(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(50 * time.Millisecond)
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Millisecond)
	defer cancel()
	if err := New(upstream.URL).Health(ctx); err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestDisabledClient(t *testing.T) {
	t.Parallel()

	client := New("")
	if client.Enabled() {
		t.Fatal("client should be disabled")
	}
	if err := client.Health(t.Context()); err == nil {
		t.Fatal("expected disabled health error")
	}
	if _, err := client.QueryActivation(t.Context(), "tok", []string{"d1"}); err == nil {
		t.Fatal("expected disabled QueryActivation error")
	}
	if _, err := client.GetCameraInfo(t.Context(), "tok", "d1"); err == nil {
		t.Fatal("expected disabled GetCameraInfo error")
	}
	if _, err := client.ListOTAReleases(t.Context(), "tok", "brand", "product"); err == nil {
		t.Fatal("expected disabled ListOTAReleases error")
	}
	if _, err := client.ListOTADeployments(t.Context(), "tok", "brand", "campaign"); err == nil {
		t.Fatal("expected disabled ListOTADeployments error")
	}
	if _, err := client.ListOTACampaigns(t.Context(), "tok", "brand", "product"); err == nil {
		t.Fatal("expected disabled ListOTACampaigns error")
	}
	if _, err := client.DeviceTelemetry(t.Context(), "tok", "d1", "org-1"); err == nil {
		t.Fatal("expected disabled DeviceTelemetry error")
	}
	if _, err := client.FleetStreamStats(t.Context(), "tok", "org-1", "7d", []string{"d1"}); err == nil {
		t.Fatal("expected disabled FleetStreamStats error")
	}
	if _, err := client.FleetHealthSummary(t.Context(), "tok", "org-1"); err == nil {
		t.Fatal("expected disabled FleetHealthSummary error")
	}
}

func TestFleetScopeAlwaysSendsExplicitDevicesIncludingEmpty(t *testing.T) {
	t.Parallel()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		values, present := r.URL.Query()["devices"]
		if !present || len(values) != 1 || values[0] != "" {
			t.Fatalf("devices scope = %#v, present=%v; empty scope must be explicit", values, present)
		}
		switch r.URL.Path {
		case "/api/fleet/presence-summary":
			_ = json.NewEncoder(w).Encode(FleetPresenceSummary{SourceStatus: "available"})
		case "/api/fleet/health-summary":
			_ = json.NewEncoder(w).Encode(FleetHealthSummary{SourceStatus: "available"})
		case "/api/fleet/health-attention":
			_ = json.NewEncoder(w).Encode(FleetAttentionPage{})
		default:
			t.Fatalf("path = %q", r.URL.Path)
		}
	}))
	defer upstream.Close()
	client := New(upstream.URL)
	_, err := client.FleetPresenceSummaryAt(t.Context(), "fleet-token", "org-1", []string{}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.FleetPresenceSummary(t.Context(), "fleet-token", "org-1", []string{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.FleetHealthSummaryScoped(t.Context(), "fleet-token", "org-1", []string{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.FleetHealthSummaryScopedAt(t.Context(), "fleet-token", "org-1", []string{}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.FleetHealthAttention(t.Context(), "fleet-token", "org-1", []string{}, 0, 50); err != nil {
		t.Fatal(err)
	}
	if _, err := client.FleetHealthAttentionAt(t.Context(), "fleet-token", "org-1", []string{}, 0, 50, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
}

func TestOTAConfigSuccessAndErrors(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/ota/config" || r.Header.Get("X-Brand-Cloud-ID") != "cloud-a" {
			http.NotFound(w, r)
			return
		}
		switch r.Header.Get("Authorization") {
		case "Bearer good":
			_ = json.NewEncoder(w).Encode(map[string]any{"system_max_rate_limit_per_minute": 250})
		case "Bearer malformed":
			_, _ = w.Write([]byte(`{`))
		default:
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	config, err := client.OTAConfig(t.Context(), "good", "cloud-a")
	if err != nil || config.SystemMaxRateLimitPerMinute != 250 {
		t.Fatalf("config=%+v err=%v", config, err)
	}
	if _, err := client.OTAConfig(t.Context(), "rejected", "cloud-a"); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("status error=%v", err)
	}
	if _, err := client.OTAConfig(t.Context(), "malformed", "cloud-a"); err == nil {
		t.Fatal("malformed OTA config succeeded")
	}
	if got := (HTTPStatusError{StatusCode: 409, Body: "scope drift"}).Error(); !strings.Contains(got, "409") || !strings.Contains(got, "scope drift") {
		t.Fatalf("HTTPStatusError.Error()=%q", got)
	}
}

func TestFleetHealthSummary(t *testing.T) {
	t.Parallel()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fleet/health-summary" || r.URL.Query().Get("org_id") != "org-1" {
			t.Fatalf("request = %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"org_id": "org-1", "source_status": "stale", "source_freshness": "2026-09-03T01:02:03Z", "source_message": "Last safe snapshot.",
			"distribution": map[string]int{"healthy": 2, "warning": 1, "critical": 0, "unknown": 1},
			"trend_7d":     []map[string]any{{"date": "2026-09-03", "healthy": 2, "warning": 1, "critical": 0, "unknown": 1}},
			"trend_30d":    []map[string]any{},
		})
	}))
	defer upstream.Close()

	summary, err := New(upstream.URL).FleetHealthSummary(t.Context(), "secret", "org-1")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Distribution.Healthy != 2 || summary.SourceStatus != "stale" || summary.SourceMessage != "Last safe snapshot." || summary.SourceFreshness == "" || len(summary.Trend7D) != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestFleetStreamStats(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fleet/stream-stats" {
			t.Fatalf("path = %q, want /api/fleet/stream-stats", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		q := r.URL.Query()
		if got := q.Get("org_id"); got != "org-1" {
			t.Fatalf("org_id query = %q, want org-1", got)
		}
		if got := q.Get("window"); got != "30d" {
			t.Fatalf("window query = %q, want 30d", got)
		}
		if got := q.Get("devices"); got != "dev-a,dev-b" {
			t.Fatalf("devices query = %q, want dev-a,dev-b", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"org_id":               "org-1",
			"window":               "30d",
			"success_rate_pct":     91.5,
			"avg_duration_seconds": 42.25,
			"active_sessions":      3,
			"never_streamed_count": 1,
			"by_mode": map[string]any{
				"webrtc": map[string]any{"requests": 12, "success_rate_pct": 91.5},
			},
			"trend": []map[string]any{
				{"date": "2026-05-11", "requests": 12, "success_rate_pct": 91.5},
			},
			"trend_by_mode": []map[string]any{
				{"mode": "webrtc", "points": []map[string]any{{"date": "2026-05-11", "requests": 12, "success_rate_pct": 91.5}}},
			},
			"worst_devices": []map[string]any{
				{"device_id": "dev-a", "device_name": "Lobby", "mode_used": "webrtc", "readiness": "online", "success_rate_pct": 80, "requests": 5, "last_stream_at": "2026-05-11T00:00:00Z"},
			},
		})
	}))
	defer upstream.Close()

	stats, err := New(upstream.URL).FleetStreamStats(t.Context(), "secret", "org-1", "30d", []string{"dev-a", "dev-b"})
	if err != nil {
		t.Fatalf("FleetStreamStats returned error: %v", err)
	}
	if stats.OrgID != "org-1" || stats.Window != "30d" || stats.SuccessRatePct != 91.5 || stats.ActiveSessions != 3 {
		t.Fatalf("stats = %#v", stats)
	}
	if stats.ByMode["webrtc"].Requests != 12 {
		t.Fatalf("by_mode = %#v", stats.ByMode)
	}
}

func TestQueryActivation(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/query_camera_activate" {
			t.Fatalf("path = %q, want /query_camera_activate", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		var body struct {
			Devices []string `json:"devices"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if len(body.Devices) != 2 {
			t.Fatalf("devices len = %d, want 2", len(body.Devices))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "ok",
			"devices": []string{"1", "0"},
		})
	}))
	defer upstream.Close()

	result, err := New(upstream.URL).QueryActivation(t.Context(), "secret", []string{"dev-a", "dev-b"})
	if err != nil {
		t.Fatalf("QueryActivation error: %v", err)
	}
	if !result["dev-a"] {
		t.Fatalf("dev-a should be activated")
	}
	if result["dev-b"] {
		t.Fatalf("dev-b should not be activated")
	}
}

func TestQueryActivationUpstreamError(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	if _, err := New(upstream.URL).QueryActivation(t.Context(), "tok", []string{"d1"}); err == nil {
		t.Fatal("expected error on 5xx response")
	}
}

func TestGetCameraInfo(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/get_camera_info" {
			t.Fatalf("path = %q, want /get_camera_info", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		var body struct {
			DevID string `json:"devid"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.DevID != "cam-1" {
			t.Fatalf("devid = %q, want cam-1", body.DevID)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"info":   map[string]string{"current_transport": "websocket"},
		})
	}))
	defer upstream.Close()

	transport, err := New(upstream.URL).GetCameraInfo(t.Context(), "secret", "cam-1")
	if err != nil {
		t.Fatalf("GetCameraInfo error: %v", err)
	}
	if transport != "websocket" {
		t.Fatalf("transport = %q, want websocket", transport)
	}
}

func TestGetDeviceInfo(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/get_camera_info" {
			t.Fatalf("path = %q, want /get_camera_info", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		var body struct {
			DevID string `json:"devid"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.DevID != "cam-1" {
			t.Fatalf("devid = %q, want cam-1", body.DevID)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"info": map[string]any{
				"current_transport": "websocket",
				"firmware_version":  "v1.2.3",
			},
		})
	}))
	defer upstream.Close()

	info, err := New(upstream.URL).GetDeviceInfo(t.Context(), "secret", "cam-1")
	if err != nil {
		t.Fatalf("GetDeviceInfo error: %v", err)
	}
	if info.CurrentTransport != "websocket" {
		t.Fatalf("CurrentTransport = %q, want websocket", info.CurrentTransport)
	}
	if info.FirmwareVersion != "v1.2.3" {
		t.Fatalf("FirmwareVersion = %q, want v1.2.3", info.FirmwareVersion)
	}
}

func TestGetDeviceInfoMissingInfoReturnsEmptyValues(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/get_camera_info" {
			t.Fatalf("path = %q, want /get_camera_info", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer upstream.Close()

	info, err := New(upstream.URL).GetDeviceInfo(t.Context(), "secret", "cam-1")
	if err != nil {
		t.Fatalf("GetDeviceInfo error: %v", err)
	}
	if info.CurrentTransport != "" || info.FirmwareVersion != "" {
		t.Fatalf("info = %+v, want empty values", info)
	}
}

func TestDoOTAInjectsTrustedBrandAndIdempotencyHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/ota/products/product-1/releases" || r.Method != http.MethodPost {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer admin-token" || r.Header.Get("X-Brand-Cloud-ID") != "brand-1" || r.Header.Get("Idempotency-Key") != "idem-key" {
			t.Fatalf("headers = %#v", r.Header)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"release_id":"rel-1"}`))
	}))
	defer upstream.Close()
	response, err := New(upstream.URL).DoOTA(t.Context(), http.MethodPost, "/v1/ota/products/product-1/releases", "admin-token", "brand-1", "idem-key", []byte(`{"version":"1"}`))
	if err != nil || response.StatusCode != http.StatusCreated || !strings.Contains(string(response.Body), "rel-1") {
		t.Fatalf("DoOTA = %#v, %v", response, err)
	}
	if _, err := New(upstream.URL).DoOTA(t.Context(), http.MethodPost, "/download_firmware", "admin-token", "brand-1", "idem", nil); err == nil {
		t.Fatal("expected non-canonical path rejection")
	}
}

func TestDoBrandWebhookRoutesTrustedRequestsAndRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-token" || r.Header.Get("X-Brand-Cloud-ID") != "brand-1" {
			t.Fatalf("trusted brand webhook headers = %#v", r.Header)
		}
		switch {
		case r.Method == http.MethodPut && r.URL.Path == "/v1/brand/webhook/subscription":
			if r.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("Content-Type = %q", r.Header.Get("Content-Type"))
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["url"] != "https://brand.example/hook" {
				t.Fatalf("subscription body = %#v, %v", body, err)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"status":"active"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/brand/webhook/events/event-1/receipts":
			if r.Header.Get("Content-Type") != "" {
				t.Fatalf("unexpected Content-Type = %q", r.Header.Get("Content-Type"))
			}
			_, _ = w.Write([]byte(`{"items":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	response, err := client.DoBrandWebhook(t.Context(), http.MethodPut, "", "service-token", "brand-1", []byte(`{"url":"https://brand.example/hook"}`))
	if err != nil || response.StatusCode != http.StatusCreated || !strings.Contains(string(response.Body), "active") {
		t.Fatalf("subscription response = %#v, %v", response, err)
	}
	response, err = client.DoBrandWebhook(t.Context(), http.MethodGet, "event-1", "service-token", "brand-1", nil)
	if err != nil || response.StatusCode != http.StatusOK || string(response.Body) != `{"items":[]}` {
		t.Fatalf("receipt response = %#v, %v", response, err)
	}

	invalid := []struct {
		name    string
		client  *Client
		method  string
		eventID string
		token   string
		cloudID string
	}{
		{name: "disabled", client: New(""), method: http.MethodGet, token: "token", cloudID: "brand"},
		{name: "missing token", client: client, method: http.MethodGet, cloudID: "brand"},
		{name: "missing cloud", client: client, method: http.MethodGet, token: "token"},
		{name: "subscription method", client: client, method: http.MethodPost, token: "token", cloudID: "brand"},
		{name: "receipt method", client: client, method: http.MethodDelete, eventID: "event", token: "token", cloudID: "brand"},
		{name: "receipt length", client: client, method: http.MethodGet, eventID: strings.Repeat("x", 129), token: "token", cloudID: "brand"},
		{name: "receipt delimiter", client: client, method: http.MethodGet, eventID: "event/1", token: "token", cloudID: "brand"},
		{name: "invalid base URL", client: New("://invalid"), method: http.MethodGet, token: "token", cloudID: "brand"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.client.DoBrandWebhook(t.Context(), tc.method, tc.eventID, tc.token, tc.cloudID, nil); err == nil {
				t.Fatal("invalid brand webhook request succeeded")
			}
		})
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := client.DoBrandWebhook(canceled, http.MethodGet, "", "service-token", "brand-1", nil); err == nil {
		t.Fatal("canceled brand webhook request succeeded")
	}
}

func TestCanonicalOTAReadMethodsFollowPagesAndDecodeStatus(t *testing.T) {
	t.Parallel()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Brand-Cloud-ID") != "brand-1" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("trusted OTA headers = %#v", r.Header)
		}
		switch r.URL.Path {
		case "/v1/ota/products/product-1/campaigns":
			if r.URL.Query().Get("cursor") == "1" {
				_, _ = w.Write([]byte(`{"items":[{"campaign_id":"campaign-2","product_id":"product-1","release_id":"release-1","state":"completed"}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"items":[{"campaign_id":"campaign-1","product_id":"product-1","release_id":"release-1","state":"active"}],"next_cursor":"1"}`))
		case "/v1/ota/products/product-1/releases":
			_, _ = w.Write([]byte(`{"items":[{"release_id":"release-1","version":"v1.2.4"}]}`))
		case "/v1/ota/campaigns/campaign-1/deployments":
			_, _ = w.Write([]byte(`{"items":[{"device_id":"device-1","status":"failed","current_version":"v1.2.3","target_version":"v1.2.4","error_reason":"checksum","updated_at":"2026-08-28T01:05:00Z"}]}`))
		case "/v1/ota/campaigns/campaign-1/summary":
			_, _ = w.Write([]byte(`{"campaign_id":"campaign-1","state":"active","total":2,"by_status":{"failed":1,"pending":1},"updated_at":"2026-08-28T01:05:00Z"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	client := New(upstream.URL)
	campaigns, err := client.ListOTACampaigns(t.Context(), "secret", "brand-1", "product-1")
	if err != nil || len(campaigns) != 2 || campaigns[1].State != "completed" {
		t.Fatalf("ListOTACampaigns = %#v, %v", campaigns, err)
	}
	releases, err := client.ListOTAReleases(t.Context(), "secret", "brand-1", "product-1")
	if err != nil || len(releases) != 1 || releases[0].Version != "v1.2.4" {
		t.Fatalf("ListOTAReleases = %#v, %v", releases, err)
	}
	deployments, err := client.ListOTADeployments(t.Context(), "secret", "brand-1", "campaign-1")
	if err != nil || len(deployments) != 1 || deployments[0].ErrorReason != "checksum" {
		t.Fatalf("ListOTADeployments = %#v, %v", deployments, err)
	}
	summary, err := client.GetOTACampaignSummary(t.Context(), "secret", "brand-1", "campaign-1")
	if err != nil || summary.Total != 2 || summary.ByStatus["failed"] != 1 {
		t.Fatalf("GetOTACampaignSummary = %#v, %v", summary, err)
	}
}

func TestGetOTACampaignSummaryRejectsBadResponses(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		statusCode int
		body       string
		wantStatus bool
	}{
		{name: "upstream status", statusCode: http.StatusBadGateway, body: `upstream unavailable`, wantStatus: true},
		{name: "invalid JSON", statusCode: http.StatusOK, body: `{`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			_, err := New(upstream.URL).GetOTACampaignSummary(t.Context(), "secret", "brand-1", "campaign-1")
			if err == nil {
				t.Fatal("GetOTACampaignSummary returned nil error")
			}
			if _, ok := err.(HTTPStatusError); ok != tc.wantStatus {
				t.Fatalf("HTTPStatusError = %v, want %v: %v", ok, tc.wantStatus, err)
			}
		})
	}
}

func TestDeviceTelemetry(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/devices/cam-1/telemetry" {
			t.Fatalf("path = %q, want /api/devices/cam-1/telemetry", r.URL.Path)
		}
		if got := r.URL.Query().Get("org_id"); got != "org-1" {
			t.Fatalf("org_id = %q, want org-1", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":            "ok",
			"org_id":            "org-1",
			"device_id":         "cam-1",
			"account_device_id": "acct-1",
			"device_name":       "Front Door",
			"latest_health": map[string]any{
				"state":       "warning",
				"occurred_at": "2026-05-04T12:00:00Z",
				"payload": map[string]any{
					"signals": []string{"low_rssi"},
				},
			},
			"rssi_history": []map[string]any{
				{"occurred_at": "2026-05-04T11:00:00Z", "rssi_dbm": -67, "quality": "fair"},
			},
			"uptime_history": []map[string]any{
				{"occurred_at": "2026-05-04T11:00:00Z", "uptime_seconds": 3600},
			},
			"recent_events": []map[string]any{
				{
					"event_id":    "evt-1",
					"event_type":  "device.health.summary",
					"occurred_at": "2026-05-04T12:00:00Z",
					"source":      "video_cloud",
					"payload": map[string]any{
						"summary": "Device health summary updated",
					},
				},
			},
		})
	}))
	defer upstream.Close()

	response, err := New(upstream.URL).DeviceTelemetry(t.Context(), "secret", "cam-1", "org-1")
	if err != nil {
		t.Fatalf("DeviceTelemetry error: %v", err)
	}
	if response.DeviceID != "cam-1" {
		t.Fatalf("DeviceID = %q, want cam-1", response.DeviceID)
	}
	if response.LatestHealth == nil || response.LatestHealth.State != "warning" {
		t.Fatalf("LatestHealth = %+v, want warning", response.LatestHealth)
	}
	if len(response.RSSIHistory) != 1 || len(response.UptimeHistory) != 1 || len(response.RecentEvents) != 1 {
		t.Fatalf("unexpected telemetry lengths: rssi=%d uptime=%d events=%d", len(response.RSSIHistory), len(response.UptimeHistory), len(response.RecentEvents))
	}
}

func TestDeviceTelemetryOmitsEmptyOrgQuery(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/devices/cam-1/telemetry" {
			t.Fatalf("path = %q, want /api/devices/cam-1/telemetry", r.URL.Path)
		}
		if got := r.URL.RawQuery; got != "" {
			t.Fatalf("raw query = %q, want empty", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("Authorization = %q, want Bearer secret", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":      "ok",
			"device_id":   "cam-1",
			"device_name": "Front Door",
		})
	}))
	defer upstream.Close()

	response, err := New(upstream.URL).DeviceTelemetry(t.Context(), "secret", "cam-1", "")
	if err != nil {
		t.Fatalf("DeviceTelemetry error: %v", err)
	}
	if response.DeviceID != "cam-1" {
		t.Fatalf("DeviceID = %q, want cam-1", response.DeviceID)
	}
}

func TestGetCameraInfoUpstreamError(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer upstream.Close()

	if _, err := New(upstream.URL).GetCameraInfo(t.Context(), "tok", "cam-1"); err == nil {
		t.Fatal("expected error on 4xx response")
	}
}

func TestJSONHelpersHandleEmptyInvalidAndErrorResponses(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/ota/products/product/releases":
			w.WriteHeader(http.StatusNoContent)
		case "/v1/ota/campaigns/campaign/deployments":
			_, _ = w.Write([]byte(`{`))
		case "/v1/ota/products/product/campaigns":
			http.Error(w, "forbidden", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	if _, err := client.ListOTAReleases(t.Context(), "tok", "brand", "product"); err == nil {
		t.Fatal("empty OTA response must not be displayed as an empty release list")
	}
	if _, err := client.ListOTADeployments(t.Context(), "tok", "brand", "campaign"); err == nil {
		t.Fatal("expected invalid JSON error")
	}
	if _, err := client.ListOTACampaigns(t.Context(), "tok", "brand", "product"); err == nil {
		t.Fatal("expected status error")
	}
}

func TestDeviceTelemetryRejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/devices/dev-1/telemetry" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{`))
	}))
	defer upstream.Close()

	if _, err := New(upstream.URL).DeviceTelemetry(t.Context(), "tok", "dev-1", ""); err == nil {
		t.Fatal("expected invalid JSON telemetry error")
	}
}
