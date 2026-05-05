package videoclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	if _, err := client.EnumFirmware(t.Context(), "tok", "cam-a"); err == nil {
		t.Fatal("expected disabled EnumFirmware error")
	}
	if _, err := client.QueryFirmwareRollout(t.Context(), "tok", "cam-a", ""); err == nil {
		t.Fatal("expected disabled QueryFirmwareRollout error")
	}
	if _, err := client.QueryFirmwareCampaigns(t.Context(), "tok", "cam-a", false); err == nil {
		t.Fatal("expected disabled QueryFirmwareCampaigns error")
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

func TestFirmwareDistributionQueries(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/enum_firmware":
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("Authorization = %q, want Bearer secret", got)
			}
			var body struct {
				Model string `json:"model"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode enum body: %v", err)
			}
			if body.Model != "cam-a" {
				t.Fatalf("model = %q, want cam-a", body.Model)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":   "ok",
				"versions": []string{"v1.2.3", "v1.2.4"},
			})
		case "/query_firmware_rollout":
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("Authorization = %q, want Bearer secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"model":  "cam-a",
				"rollouts": []map[string]any{
					{
						"device_id":       "device-1",
						"device_name":     "cam-a-001",
						"campaign_id":     "campaign-1",
						"target_version":  "v1.2.4",
						"current_version": "v1.2.4",
						"rollout_status":  "applied",
					},
				},
			})
		case "/query_firmware_campaign":
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("Authorization = %q, want Bearer secret", got)
			}
			var body struct {
				Model           string `json:"model"`
				IncludeArchived bool   `json:"include_archived"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode campaign body: %v", err)
			}
			if body.Model != "cam-a" || body.IncludeArchived {
				t.Fatalf("campaign body = %+v, want model cam-a include_archived false", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"campaigns": []map[string]any{
					{
						"id":             "campaign-1",
						"model":          "cam-a",
						"target_version": "v1.2.4",
						"policy":         map[string]any{"name": "normal"},
						"state":          "active",
						"created_at":     "2026-05-01T00:00:00Z",
						"updated_at":     "2026-05-01T00:00:00Z",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	enum, err := client.EnumFirmware(t.Context(), "secret", "cam-a")
	if err != nil {
		t.Fatalf("EnumFirmware error: %v", err)
	}
	if len(enum.Versions) != 2 || enum.Versions[1] != "v1.2.4" {
		t.Fatalf("EnumFirmware = %+v, want versions [v1.2.3 v1.2.4]", enum)
	}

	rollouts, err := client.QueryFirmwareRollout(t.Context(), "secret", "cam-a", "")
	if err != nil {
		t.Fatalf("QueryFirmwareRollout error: %v", err)
	}
	if len(rollouts.Rollouts) != 1 || rollouts.Rollouts[0].DeviceName != "cam-a-001" {
		t.Fatalf("QueryFirmwareRollout = %+v, want one rollout", rollouts)
	}

	campaigns, err := client.QueryFirmwareCampaigns(t.Context(), "secret", "cam-a", false)
	if err != nil {
		t.Fatalf("QueryFirmwareCampaigns error: %v", err)
	}
	if len(campaigns) != 1 || campaigns[0].ID != "campaign-1" {
		t.Fatalf("QueryFirmwareCampaigns = %+v, want campaign-1", campaigns)
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
