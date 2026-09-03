package reportstorage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPresignGetIsBoundToObjectAndExpiry(t *testing.T) {
	store := Store{Endpoint: "https://minio.example.test", Bucket: "reports", Region: "us-east-1", AccessKey: "access", SecretKey: "secret"}
	got, err := store.PresignGet("reports/dev/cloud-1/report-1/result.json", 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "/reports/reports/dev/cloud-1/report-1/result.json") || !strings.Contains(got, "X-Amz-Expires=10") || !strings.Contains(got, "X-Amz-Signature=") {
		t.Fatalf("unexpected signed URL: %s", got)
	}
}

func TestPutSignsS3CompatibleRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/reports/reports/dev/cloud-1/report-1/result.json" {
			t.Fatalf("request=%s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") == "" || r.Header.Get("X-Amz-Date") == "" {
			t.Fatal("missing AWS signature headers")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	store := Store{Endpoint: server.URL, Bucket: "reports", Region: "us-east-1", AccessKey: "access", SecretKey: "secret"}
	if err := store.Put(context.Background(), "reports/dev/cloud-1/report-1/result.json", []byte(`{"ok":true}`), "application/json"); err != nil {
		t.Fatal(err)
	}
}
