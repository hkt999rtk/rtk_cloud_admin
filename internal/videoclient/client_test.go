package videoclient

import (
	"context"
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
}
