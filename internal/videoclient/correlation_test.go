package videoclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"rtk_cloud_admin/internal/correlation"
)

func TestClientPropagatesCorrelationHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Request-Id"); got != "req-1" {
			t.Fatalf("X-Request-Id = %q, want req-1", got)
		}
		if got := r.Header.Get("X-Trace-Id"); got != "trace-1" {
			t.Fatalf("X-Trace-Id = %q, want trace-1", got)
		}
		if got := r.Header.Get("X-Operation-Id"); got != "op-1" {
			t.Fatalf("X-Operation-Id = %q, want op-1", got)
		}
		_, _ = w.Write([]byte(`{"status":"ok","versions":[],"releases":[]}`))
	}))
	defer upstream.Close()

	ctx := correlation.With(context.Background(), correlation.Values{
		RequestID:   "req-1",
		TraceID:     "trace-1",
		OperationID: "op-1",
	})
	if _, err := New(upstream.URL).EnumFirmware(ctx, "admin-token", "model-a"); err != nil {
		t.Fatalf("EnumFirmware: %v", err)
	}
}
