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
