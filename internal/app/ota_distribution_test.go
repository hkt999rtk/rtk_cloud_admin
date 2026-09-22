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
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"
)

func TestProductOTADistributionNeverHidesUpstreamFailures(t *testing.T) {
	paths := []string{"/v1/ota/products/product-1/campaigns", "/v1/ota/products/product-1/releases", "/v1/ota/campaigns/c/summary", "/v1/ota/campaigns/c/deployments"}
	for _, failedPath := range append([]string{""}, paths...) {
		t.Run(failedPath, func(t *testing.T) {
			calls := map[string]int{}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls[r.URL.Path]++
				if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/v1/ota/") {
					t.Errorf("legacy/model request: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
					return
				}
				if r.Header.Get("X-Brand-Cloud-ID") != "org-acme" {
					t.Errorf("lost trusted scope: %v", r.Header)
				}
				if failedPath != "" && r.URL.Path == failedPath {
					http.Error(w, "fixture unavailable", http.StatusServiceUnavailable)
					return
				}
				switch r.URL.Path {
				case paths[0]:
					w.Write([]byte(`{"items":[{"campaign_id":"c","release_id":"r","state":"active","target_snapshot_count":1}]}`))
				case paths[1]:
					w.Write([]byte(`{"items":[{"release_id":"r","version":"2.0","state":"published"}]}`))
				case paths[2]:
					w.Write([]byte(`{"campaign_id":"c","total":1,"by_status":{"downloading":1}}`))
				case paths[3]:
					w.Write([]byte(`{"items":[{"deployment_id":"d","device_id":"device","status":"downloading","current_version":"1.0","target_version":"2.0"}]}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			st, err := store.Open(t.TempDir() + "/admin.db")
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			if err = st.Migrate(); err != nil {
				t.Fatal(err)
			}
			if err = st.SeedDemoData(); err != nil {
				t.Fatal(err)
			}
			session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			server := NewWithOptions(st, Options{Config: config.Config{VideoCloudBaseURL: upstream.URL, VideoCloudAdminToken: "fixture"}, VideoClient: videoclient.New(upstream.URL)})
			req := httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution?product_id=product-1", nil)
			req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			rec := httptest.NewRecorder()
			server.ServeHTTP(rec, req)
			var result contracts.FirmwareDistribution
			if err = json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
				t.Fatalf("response %s: %v", rec.Body.String(), err)
			}
			if failedPath != "" {
				if result.SourceStatus != "unavailable" || len(result.Campaigns) != 0 {
					t.Fatalf("failed query shown as valid data: %+v", result)
				}
			} else {
				if result.SourceStatus != "available" || len(result.Campaigns) != 1 || result.Campaigns[0].TargetVersion != "2.0" {
					t.Fatalf("canonical result: %+v", result)
				}
				for _, path := range paths {
					if calls[path] != 1 {
						t.Fatalf("selected product without devices did not load %s: %v", path, calls)
					}
				}
				// Current inventory versions must never be replaced by deployment targets.
				dist, _, err := server.proxyFirmwareDistribution(t.Context(), []contracts.Device{{ID: "device", Product: "product-1", FirmwareVersion: "1.0"}}, "org-acme", "product-1")
				if err != nil || len(dist.Versions) != 1 || dist.Versions[0].Version != "1.0" || dist.Versions[0].IsLatest {
					t.Fatalf("current version confused with target: %+v %v", dist, err)
				}
			}
		})
	}
}

func TestCanonicalOTASummaryPreservesTerminalOutcomesAndFallbacks(t *testing.T) {
	campaign := videoclient.OTACampaignRecord{ID: "campaign", State: "canceled", TargetSnapshotCount: 6, CreatedAt: "2026-01-01T00:00:00Z"}
	deployments := []videoclient.OTADeploymentRecord{
		{DeviceID: "b", Status: "succeeded", TargetVersion: "2.0", UpdatedAt: "2026-01-02T00:00:00Z"},
		{DeviceID: "a", Status: "rolled_back", UpdatedAt: "2026-01-02T00:00:00Z", ErrorReason: "health check"},
		{DeviceID: "c", Status: "canceled", UpdatedAt: "2026-01-01T00:00:00Z"},
	}
	summary := videoclient.OTACampaignSummary{ByStatus: map[string]int{"succeeded": 1, "rolled_back": 1, "canceled": 2, "offered": 1, "queued": 1}}
	got := summarizeCanonicalFirmwareCampaign(campaign, "", deployments, summary, map[string]contracts.Device{"b": {Name: "Beta", FirmwareVersion: "1.0"}, "a": {Name: "Alpha"}})
	if got.Total != 6 || got.Applied != 1 || got.Failed != 1 || got.Skipped != 2 || got.Pending != 2 || got.TargetVersion != "2.0" {
		t.Fatalf("terminal progress: %+v", got)
	}
	if got.Rollouts[0].DeviceID != "a" || got.Rollouts[0].FailureReason != "health check" || got.Rollouts[1].CurrentVersion != "1.0" || got.Rollouts[2].RolloutStatus != "canceled" || got.UpdatedAt != "2026-01-02T00:00:00Z" {
		t.Fatalf("deployment detail or ordering: %+v", got)
	}
	campaign.TargetSnapshotCount = 0
	got = summarizeCanonicalFirmwareCampaign(campaign, "2.0", deployments, videoclient.OTACampaignSummary{}, nil)
	if got.Total != 3 || got.Pending != 3 {
		t.Fatalf("missing summary fallback: %+v", got)
	}
	for _, status := range []string{"offered", "queued", "skipped", "timed_out", "rebooting"} {
		want := map[string]string{"offered": "eligible", "queued": "pending", "skipped": "skipped", "timed_out": "failed", "rebooting": "downloading"}[status]
		got := summarizeCanonicalFirmwareCampaign(campaign, "2.0", []videoclient.OTADeploymentRecord{{DeviceID: "d", Status: status}}, videoclient.OTACampaignSummary{}, nil)
		if got.Rollouts[0].RolloutStatus != want {
			t.Fatalf("%s rendered as %s", status, got.Rollouts[0].RolloutStatus)
		}
	}
}

func TestOTADistributionInventoryFailuresRemainErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	server := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	if _, err := server.firmwareDistributionDevices(t.Context(), store.Session{AccessToken: "fixture", ActiveOrgID: "org"}, "org"); err == nil {
		t.Fatal("unavailable account inventory became empty inventory")
	}
	st.Close()
	server = NewWithOptions(st, Options{})
	if _, err := server.firmwareDistributionDevices(t.Context(), store.Session{}, "org"); err == nil {
		t.Fatal("closed local inventory became empty inventory")
	}
}

func TestOTADistributionUsesPublishedReleasesAndVisibleCampaigns(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/ota/products/p/campaigns":
			w.Write([]byte(`{"items":[{"campaign_id":"future","state":"unsupported"}]}`))
		case "/v1/ota/products/p/releases":
			w.Write([]byte(`{"items":[{"release_id":"r1","version":"1.0","state":"published"},{"release_id":"r2","version":"2.0","state":"published"},{"release_id":"r3","version":"3.0","state":"revoked"}]}`))
		default:
			t.Errorf("unexpected campaign detail query: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	server := NewWithOptions(mustOpenStore(t), Options{Config: config.Config{VideoCloudAdminToken: "fixture"}, VideoClient: videoclient.New(upstream.URL)})
	got, enabled, err := server.proxyFirmwareDistribution(t.Context(), []contracts.Device{{ID: "a", Product: "p", FirmwareVersion: "2.0"}, {ID: "b", Product: "p"}}, "org", "p")
	if err != nil || !enabled || len(got.Campaigns) != 0 || len(got.Versions) != 2 || !got.Versions[0].IsLatest || got.Versions[0].Version != "2.0" || got.Versions[1].Version != "unknown" {
		t.Fatalf("release visibility: %+v %t %v", got, enabled, err)
	}
}
