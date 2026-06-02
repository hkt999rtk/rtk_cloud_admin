package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrometheusMetrics(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics/prometheus", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/plain") {
		t.Fatalf("content type = %q, want text/plain", got)
	}
	if !strings.Contains(rec.Body.String(), "rtk_cloud_admin_up 1") {
		t.Fatalf("metrics body missing up metric:\n%s", rec.Body.String())
	}
}
