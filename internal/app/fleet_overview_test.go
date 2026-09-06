package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/videoclient"
)

func TestFleetOverviewAndAttentionRoutesUseAuthorizedDeviceScope(t *testing.T) {
	t.Parallel()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{"id": "developer-1", "email": "developer@example.com"},
				"brand_cloud_memberships": []map[string]any{{
					"id": cloudA, "name": "Fleet Cloud", "role": "owner",
					"capabilities": []string{capabilityFleetRead},
				}},
			})
		case "/v1/orgs/" + cloudA + "/fleet/devices":
			if got := r.Header.Get("Authorization"); got != "Bearer access" {
				t.Fatalf("Account Manager Authorization = %q", got)
			}
			if r.URL.Query().Get("limit") != "250" || r.URL.Query().Get("offset") != "0" {
				t.Fatalf("fleet pagination = %q", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "account-1", "organization_id": cloudA, "name": "Front Door", "video_cloud_devid": "vc-1", "status": "online"},
					{"id": "account-2", "organization_id": cloudA, "name": "Garage", "metadata": map[string]any{"video_cloud_devid": "vc-2", "status": "offline"}},
					{"id": "account-disabled", "organization_id": cloudA, "video_cloud_devid": "vc-disabled", "status": "disabled"},
				},
				"pagination": map[string]int{"limit": 250, "offset": 0, "total": 3},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer account.Close()

	video := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if got := r.Header.Get("Authorization"); got != "Bearer fleet-token" {
			t.Fatalf("Video Cloud Authorization = %q", got)
		}
		if r.URL.Query().Get("org_id") != cloudA || r.URL.Query().Get("devices") != "vc-1,vc-2" || r.URL.Query().Get("as_of") == "" {
			t.Fatalf("Video Cloud scope = %q", r.URL.RawQuery)
		}
		switch r.URL.Path {
		case "/api/fleet/presence-summary":
			_, _ = w.Write([]byte(`{"source_status":"available","current":{"online":1,"offline":1,"unknown":0,"total":2},"history":{"online_seconds":7200,"offline_seconds":3600,"known_seconds":10800,"expected_seconds":14400,"trend":[{"date":"2026-09-06","online_seconds":7200,"offline_seconds":3600,"known_seconds":10800,"expected_seconds":14400}]}}`))
		case "/api/fleet/health-summary":
			_, _ = w.Write([]byte(`{"distribution":{"warning":1,"critical":1,"total":2},"trend_7d":[{"date":"2026-09-06","warning":1,"critical":1}]}`))
		case "/api/fleet/stream-stats":
			_, _ = w.Write([]byte(`{"active_sessions":2}`))
		case "/api/fleet/health-attention":
			_, _ = w.Write([]byte(`{"items":[{"device_id":"vc-1","account_device_id":"account-1","device_name":"Front Door","state":"warning","reason":"weak signal","observed_at":"2026-09-06T11:59:00Z"},{"device_id":"vc-2","account_device_id":"account-2","device_name":"Garage","state":"critical","reason":"offline","observed_at":"2026-09-06T11:58:00Z"}],"pagination":{"offset":0,"limit":100,"total":2}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer video.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "developer-1", "developer@example.com", "access", "refresh", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{VideoCloudFleetReadToken: "fleet-token"},
		AccountClient: accountclient.New(account.URL),
		VideoClient:   videoclient.New(video.URL),
	})
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}

	overviewPath := "/api/developer/clouds/" + cloudA + "/fleet/overview"
	attentionPath := "/api/developer/clouds/" + cloudA + "/fleet/attention"
	overviewRecorder := requestWithCookie(t, srv, http.MethodGet, overviewPath, nil, cookie)
	if overviewRecorder.Code != http.StatusOK || overviewRecorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("overview status=%d cache=%q body=%s", overviewRecorder.Code, overviewRecorder.Header().Get("Cache-Control"), overviewRecorder.Body.String())
	}
	var overview contracts.FleetOverview
	if err := json.NewDecoder(overviewRecorder.Body).Decode(&overview); err != nil {
		t.Fatal(err)
	}
	if overview.Scope.DeviceCount != 2 || overview.Presence.Current.Total != 2 || overview.Presence.OnlineRate7dPct == nil || *overview.Presence.OnlineRate7dPct != 66.67 || overview.Presence.Coverage7dPct == nil || *overview.Presence.Coverage7dPct != 75 {
		t.Fatalf("overview presence = %+v", overview)
	}
	if overview.Health.NeedsAttention != 2 || overview.Sessions.ActiveSessions == nil || *overview.Sessions.ActiveSessions != 2 {
		t.Fatalf("overview metrics = %+v", overview)
	}

	attentionRecorder := requestWithCookie(t, srv, http.MethodGet, attentionPath+"?offset=1&limit=1", nil, cookie)
	if attentionRecorder.Code != http.StatusOK || attentionRecorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("attention status=%d cache=%q body=%s", attentionRecorder.Code, attentionRecorder.Header().Get("Cache-Control"), attentionRecorder.Body.String())
	}
	var attention contracts.FleetAttentionPage
	if err := json.NewDecoder(attentionRecorder.Body).Decode(&attention); err != nil {
		t.Fatal(err)
	}
	if attention.Pagination.Total != 2 || len(attention.Items) != 1 || attention.Items[0].DeviceID != "vc-1" {
		t.Fatalf("attention = %+v", attention)
	}

	for _, target := range []string{attentionPath + "?offset=-1", attentionPath + "?limit=101"} {
		if recorder := requestWithCookie(t, srv, http.MethodGet, target, nil, cookie); recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
	}
	if recorder := requestWithCookie(t, srv, http.MethodGet, overviewPath, nil, nil); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated overview status=%d", recorder.Code)
	}
}

func TestAggregateFleetOverviewSumsRawSecondsBeforePercentages(t *testing.T) {
	t.Parallel()
	out := contracts.FleetOverview{}
	batches := []fleetOverviewBatch{
		{
			presence: videoclient.FleetPresenceSummary{SourceStatus: "available", Current: videoclient.FleetPresenceCurrent{Online: 1, Total: 1}, History: videoclient.FleetPresenceHistory{OnlineSeconds: 7200, KnownSeconds: 7200, ExpectedSeconds: 10800}},
			health:   videoclient.FleetHealthSummary{Distribution: videoclient.FleetHealthDistribution{Warning: 1, Total: 1}},
			stream:   videoclient.FleetStreamStats{ActiveSessions: 2},
		},
		{
			presence: videoclient.FleetPresenceSummary{SourceStatus: "available", Current: videoclient.FleetPresenceCurrent{Offline: 1, Total: 1}, History: videoclient.FleetPresenceHistory{OfflineSeconds: 3600, KnownSeconds: 3600, ExpectedSeconds: 3600}},
			health:   videoclient.FleetHealthSummary{Distribution: videoclient.FleetHealthDistribution{Critical: 1, Total: 1}},
			stream:   videoclient.FleetStreamStats{ActiveSessions: 3},
		},
	}
	aggregateFleetOverview(&out, batches)
	if out.Presence.OnlineRate7dPct == nil || *out.Presence.OnlineRate7dPct != 66.67 {
		t.Fatalf("online rate = %v", out.Presence.OnlineRate7dPct)
	}
	if out.Presence.Coverage7dPct == nil || *out.Presence.Coverage7dPct != 75 {
		t.Fatalf("coverage = %v", out.Presence.Coverage7dPct)
	}
	if out.Health.NeedsAttention != 2 || out.Sessions.ActiveSessions == nil || *out.Sessions.ActiveSessions != 5 {
		t.Fatalf("overview = %+v", out)
	}
	degraded := contracts.FleetOverview{}
	aggregateFleetOverview(&degraded, []fleetOverviewBatch{{
		presence: videoclient.FleetPresenceSummary{SourceStatus: "partial"},
		health:   videoclient.FleetHealthSummary{SourceStatus: "stale"},
	}})
	if degraded.Presence.Source.Status != "partial" || degraded.Health.Source.Status != "partial" || !strings.Contains(degraded.Health.Source.Message, "stale") {
		t.Fatalf("degraded sources = %+v", degraded)
	}
}

func TestEligibleFleetAnalyticsDevicesRequiresProvisionedVideoIdentity(t *testing.T) {
	t.Parallel()
	devices := []accountclient.Device{
		{ID: "ok", VideoCloudDevID: "vc-ok", Status: "online"},
		{ID: "metadata", Metadata: map[string]any{"video_cloud_devid": "vc-metadata", "status": "online"}},
		{ID: "disabled", VideoCloudDevID: "vc-disabled", Status: "disabled"},
		{ID: "pending", VideoCloudDevID: "vc-pending", Status: "online", Readiness: "activation_pending"},
		{ID: "missing-video", Status: "online"},
	}
	got := eligibleFleetAnalyticsDevices(devices)
	if len(got) != 2 || got[0].ID != "ok" || got[1].VideoCloudDevID != "vc-metadata" {
		t.Fatalf("eligible = %+v", got)
	}
	chunks := chunkStrings(make([]string, 1001), 500)
	if len(chunks) != 3 || len(chunks[0]) != 500 || len(chunks[2]) != 1 {
		t.Fatalf("chunks = %d/%d/%d", len(chunks), len(chunks[0]), len(chunks[2]))
	}
	if got := chunkStrings([]string{"one"}, 0); len(got) != 1 || got[0][0] != "one" {
		t.Fatalf("default chunks = %+v", got)
	}
	if got := fleetPercent(1, 0); got != nil {
		t.Fatalf("zero denominator percent = %v", got)
	}
	if got := batchSource(2, 2, "partial"); got.Status != "available" {
		t.Fatalf("available source = %+v", got)
	}
	if got := batchSource(1, 2, "partial"); got.Status != "partial" || !strings.Contains(got.Message, "partial") {
		t.Fatalf("partial source = %+v", got)
	}
	if got := batchSource(0, 2, "unavailable"); got.Status != "unavailable" {
		t.Fatalf("unavailable source = %+v", got)
	}
}
