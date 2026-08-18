package billingclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBillingClientUsesDedicatedServiceIdentityAndExactPermission(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/orgs/org-1/billing/summary" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("b", 32) {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Billing-Actor-ID") != "user-1" || r.Header.Get("X-Billing-Permissions") != "billing_summary.read" {
			t.Fatalf("identity headers=%v", r.Header)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()
	client := New(server.URL, strings.Repeat("b", 32))
	result, err := client.BillingSummary(context.Background(), "user-1", "org-1")
	if err != nil || result["status"] != "ok" {
		t.Fatalf("result=%v err=%v", result, err)
	}
}

func TestBillingClientFailsClosedWithoutCredential(t *testing.T) {
	client := New("https://billing.example", "short")
	if client.Enabled() {
		t.Fatal("short service credential enabled client")
	}
}
