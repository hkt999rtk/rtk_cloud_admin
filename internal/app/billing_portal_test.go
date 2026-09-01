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
			if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("b", 32) || r.Header.Get("X-Billing-Actor-ID") != "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" {
				t.Fatalf("billing service identity headers are missing")
			}
		}
		switch r.URL.EscapedPath() {
		case "/v1/developer/brand-clouds/11111111-1111-4111-8111-111111111111":
			_, _ = w.Write([]byte(`{"brand_cloud":{"id":"11111111-1111-4111-8111-111111111111","owner_user_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","my_role":"owner","ownership_version":7,"capabilities":["` + permissions + `"]}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/summary":
			_, _ = w.Write([]byte(`{"account":{"currency":"TWD","available_balance_minor":1250},"generated_at":"2026-08-17T00:00:00Z"}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/usage":
			_, _ = w.Write([]byte(`{"usage":[{"service_code":"video"}]}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/invoices":
			if r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("secret") != "" {
				t.Fatalf("invoice query=%s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"invoices":[{"id":"invoice-1"}],"pagination":{"limit":20,"offset":0,"total":1}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/invoices/invoice%2F1":
			_, _ = w.Write([]byte(`{"invoice":{"id":"invoice/1"}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/invoices/invoice%2F1/pdf":
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("ETag", `"digest"`)
			_, _ = w.Write([]byte("%PDF-test"))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/activity":
			_, _ = w.Write([]byte(`{"activities":[{"id":"activity-1"}],"summary":{},"pagination":{}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/activity/activity%2F1":
			_, _ = w.Write([]byte(`{"activity":{"id":"activity/1"}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/profile":
			if r.Method == http.MethodPut && r.Header.Get("If-Match") != `"3"` {
				t.Fatalf("profile If-Match=%q", r.Header.Get("If-Match"))
			}
			_, _ = w.Write([]byte(`{"billing_profile":{"legal_name":"ACME","version":3}}`))
		case "/v1/orgs/11111111-1111-4111-8111-111111111111/billing/statements":
			w.Header().Set("Content-Type", "text/csv")
			_, _ = w.Write([]byte("invoice,total\nINV-1,100\n"))
		default:
			t.Fatalf("unexpected upstream path %s", r.URL.EscapedPath())
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "owner@example.com", "access", "refresh", "11111111-1111-4111-8111-111111111111", time.Hour)
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
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Cloud-Ownership-Version", "7")
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		return res
	}
	for _, path := range []string{"/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/summary", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/usage", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/invoices?limit=20&secret=redacted", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/invoices/invoice%2F1", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/activity", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/activity/activity%2F1", "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/profile"} {
		if response := request(http.MethodGet, path, ""); response.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, response.Code, response.Body.String())
		}
	}
	if response := request(http.MethodPut, "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/profile", `{"legal_name":"ACME","locale":"zh-TW","timezone":"Asia/Taipei","delivery_preference":"portal","version":3}`); response.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPut, "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/profile", `{"legal_name":"","version":0}`); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid profile: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/invoices/invoice%2F1/pdf", ""); response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/pdf" || !strings.HasPrefix(response.Body.String(), "%PDF") {
		t.Fatalf("pdf: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/developer/brand-clouds/11111111-1111-4111-8111-111111111111/billing/statements", ""); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "INV-1") {
		t.Fatalf("statement: %d %s", response.Code, response.Body.String())
	}
}

func TestServerBuildsBillingClientFromConfiguration(t *testing.T) {
	server := NewWithOptions(mustOpenStore(t), Options{Config: config.Config{
		BillingServiceBaseURL: "https://billing.example.test",
		BillingServiceToken:   strings.Repeat("b", 32),
	}})
	if server.billingClient == nil || !server.billingClient.Enabled() {
		t.Fatal("configured Billing service did not create a client")
	}
}

func TestBillingPortalCapabilitiesCoverOwnerCompatibilityFallback(t *testing.T) {
	required := []string{
		capabilityBillingSummaryRead,
		capabilityBillingUsageRead,
		capabilityInvoiceRead,
		capabilityInvoiceDocumentRead,
		capabilityBillingActivityRead,
		capabilityBillingProfileRead,
		capabilityBillingProfileManage,
		capabilityBillingStatementExport,
	}
	ownerCapabilities := capabilitiesForOrganization(accountclient.Organization{Role: "owner"})
	for _, capability := range required {
		if !hasCapability(ownerCapabilities, capability) {
			t.Fatalf("owner compatibility capabilities missing %q", capability)
		}
	}
	viewerCapabilities := capabilitiesForOrganization(accountclient.Organization{Role: "viewer"})
	for _, capability := range required {
		if hasCapability(viewerCapabilities, capability) {
			t.Fatalf("read-only compatibility capabilities unexpectedly include %q", capability)
		}
	}
}
