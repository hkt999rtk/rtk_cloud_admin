package billingclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBillingClientRequiresCloudActorVersionForReadsAndDownloads(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("invalid ownership reached Billing")
		w.WriteHeader(500)
	}))
	defer upstream.Close()
	c := New(upstream.URL, strings.Repeat("b", 32))
	for _, ctx := range []context.Context{context.Background(), testOwnerContext(t)} {
		if _, err := c.BillingSummary(ctx, "forged", "11111111-1111-4111-8111-111111111111"); err == nil {
			t.Fatal("actor mismatch accepted")
		}
		if _, err := c.BillingDownload(ctx, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "22222222-2222-4222-8222-222222222222", "/billing/statements"); err == nil {
			t.Fatal("cross-cloud export accepted")
		}
	}
}
