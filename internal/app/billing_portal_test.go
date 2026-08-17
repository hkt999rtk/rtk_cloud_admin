package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/billingclient"
	"rtk_cloud_admin/internal/config"
)

func TestBillingPortalBFFScopesAndProxiesContractResources(t *testing.T) {
	permissions := strings.Join([]string{"billing_summary.read", "billing_usage.read", "invoice.read", "invoice_document.read", "billing_activity.read", "billing_profile.read", "billing_profile.manage", "billing_statement.export"}, `","`)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/billing/") && r.URL.Path != "/v1/me" {
			if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("b", 32) || r.Header.Get("X-Billing-Actor-ID") != "u1" {
				t.Fatalf("billing service identity headers are missing")
			}
		}
		switch r.URL.EscapedPath() {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1"},"organizations":[{"id":"org-safe","role":"owner","permissions":["` + permissions + `"]}]}`))
		case "/v1/orgs/org-safe/billing/summary":
			_, _ = w.Write([]byte(`{"account":{"currency":"TWD","available_balance_minor":1250},"generated_at":"2026-08-17T00:00:00Z"}`))
		case "/v1/orgs/org-safe/billing/usage":
			_, _ = w.Write([]byte(`{"usage":[{"service_code":"video"}]}`))
		case "/v1/orgs/org-safe/billing/invoices":
			if r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("secret") != "" {
				t.Fatalf("invoice query=%s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"invoices":[{"id":"invoice-1"}],"pagination":{"limit":20,"offset":0,"total":1}}`))
		case "/v1/orgs/org-safe/billing/invoices/invoice%2F1":
			_, _ = w.Write([]byte(`{"invoice":{"id":"invoice/1"}}`))
		case "/v1/orgs/org-safe/billing/invoices/invoice%2F1/pdf":
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("ETag", `"digest"`)
			_, _ = w.Write([]byte("%PDF-test"))
		case "/v1/orgs/org-safe/billing/activity":
			_, _ = w.Write([]byte(`{"activities":[{"id":"activity-1"}],"summary":{},"pagination":{}}`))
		case "/v1/orgs/org-safe/billing/activity/activity%2F1":
			_, _ = w.Write([]byte(`{"activity":{"id":"activity/1"}}`))
		case "/v1/orgs/org-safe/billing/profile":
			if r.Method == http.MethodPut && r.Header.Get("If-Match") != `"3"` {
				t.Fatalf("profile If-Match=%q", r.Header.Get("If-Match"))
			}
			_, _ = w.Write([]byte(`{"billing_profile":{"legal_name":"ACME","version":3}}`))
		case "/v1/orgs/org-safe/billing/statements":
			w.Header().Set("Content-Type", "text/csv")
			_, _ = w.Write([]byte("invoice,total\nINV-1,100\n"))
		default:
			t.Fatalf("unexpected upstream path %s", r.URL.EscapedPath())
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "owner@example.com", "access", "refresh", "org-safe", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL, BillingServiceBaseURL: upstream.URL, BillingServiceToken: strings.Repeat("b", 32)},
		AccountClient: accountclient.New(upstream.URL), BillingClient: billingclient.New(upstream.URL, strings.Repeat("b", 32)),
	})
	request := func(method, path, body string) *httptest.ResponseRecorder {
		var reader io.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, reader)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		return res
	}
	for _, path := range []string{"/api/billing/summary", "/api/billing/usage", "/api/billing/invoices?limit=20&secret=redacted", "/api/billing/invoices/invoice%2F1", "/api/billing/activity", "/api/billing/activity/activity%2F1", "/api/billing/profile"} {
		if response := request(http.MethodGet, path, ""); response.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, response.Code, response.Body.String())
		}
	}
	if response := request(http.MethodPut, "/api/billing/profile", `{"legal_name":"ACME","locale":"zh-TW","timezone":"Asia/Taipei","delivery_preference":"portal","version":3}`); response.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/invoices/invoice%2F1/pdf", ""); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/pdf" || !strings.HasPrefix(response.Body.String(), "%PDF") {
		t.Fatalf("pdf: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/statements", ""); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "INV-1") {
		t.Fatalf("statement: %d %s", response.Code, response.Body.String())
	}
}
