package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"
)

func TestUpdatePlanScopePreviewWithoutConfiguredUpstreams(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("migrate store: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("seed store: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/update-plans/scope-preview", strings.NewReader(`{
		"product_id":"product-1",
		"query":{"status":"active"},
		"excluded_device_ids":["", "device-1", "device-1"],
		"rate_limit_per_minute":100
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("scope preview status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		PreviewID     string         `json:"preview_id"`
		Scope         map[string]any `json:"scope"`
		TargetCount   int            `json:"target_count"`
		MatchedCount  int            `json:"matched_count"`
		ExcludedCount int            `json:"excluded_count"`
		QuotaStatus   string         `json:"quota_status"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode scope preview: %v", err)
	}
	if payload.PreviewID == "" || payload.Scope["scope_hash"] == "" {
		t.Fatalf("scope preview identifiers are missing: %+v", payload)
	}
	if payload.TargetCount != 0 || payload.MatchedCount != 0 || payload.ExcludedCount != 0 {
		t.Fatalf("unexpected scope counts: %+v", payload)
	}
	if payload.QuotaStatus != "available" {
		t.Fatalf("quota status = %q", payload.QuotaStatus)
	}
}

func TestMapVideoCloudFleetHealthSummary(t *testing.T) {
	summary := videoclient.FleetHealthSummary{
		Distribution: videoclient.FleetHealthDistribution{Healthy: 7, Warning: 2, Critical: 1, Unknown: 0},
		Trend7D: []videoclient.FleetHealthTrendPoint{
			{Date: "2026-09-04", Healthy: 7, Warning: 2, Critical: 1},
			{Date: "2026-09-05"},
		},
		Trend30D: []videoclient.FleetHealthTrendPoint{{Date: "2026-08-07", Healthy: 3, Unknown: 1}},
	}
	got := mapVideoCloudFleetHealthSummary(summary, "org-fallback", 7)
	if got.OrgID != "org-fallback" || got.SourceStatus != "available" || len(got.Trend) != 2 {
		t.Fatalf("mapped 7d summary = %+v", got)
	}
	if got.Trend[0].OnlinePct != 100 || got.Trend[0].WarningCount != 2 || got.Trend[0].CriticalCount != 1 {
		t.Fatalf("mapped 7d trend = %+v", got.Trend[0])
	}
	if got.Trend[1].OnlinePct != 0 {
		t.Fatalf("empty trend online percentage = %v", got.Trend[1].OnlinePct)
	}

	got = mapVideoCloudFleetHealthSummary(videoclient.FleetHealthSummary{
		OrgID: "org-upstream", SourceStatus: "stale", SourceMessage: "snapshot", Trend30D: summary.Trend30D,
	}, "org-fallback", 30)
	if got.OrgID != "org-upstream" || got.SourceStatus != "stale" || got.SourceMessage != "snapshot" || len(got.Trend) != 1 {
		t.Fatalf("mapped 30d summary = %+v", got)
	}
}

func TestAccessDeniedHTTPError(t *testing.T) {
	if isAccessDeniedHTTPError(errors.New("network failure")) {
		t.Fatal("plain error must not be treated as access denied")
	}
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		if !isAccessDeniedHTTPError(&accountclient.HTTPError{StatusCode: status}) {
			t.Fatalf("status %d should be access denied", status)
		}
	}
	if isAccessDeniedHTTPError(&accountclient.HTTPError{StatusCode: http.StatusBadRequest}) {
		t.Fatal("bad request must not be treated as access denied")
	}
}

func TestCustomerFleetSourceStatusStaleScenario(t *testing.T) {
	t.Setenv("E2E_SCENARIO_MODE", "stale")
	status, message := (&Server{}).customerFleetSourceStatus()
	if status != "stale" || !strings.Contains(message, "stale") {
		t.Fatalf("source status = %q, message = %q", status, message)
	}
}
