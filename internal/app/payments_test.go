package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
)

func TestPaymentBFFUsesActiveOrganizationAndForwardsControlHeaders(t *testing.T) {
	t.Parallel()

	var sawPolicyWrite bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/me":
			if r.Header.Get("Authorization") != "Bearer customer-access" {
				t.Fatalf("me authorization = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"owner@example.com"},"organizations":[{"id":"org-safe","name":"Safe Org","role":"owner","permissions":["billing_account.read","billing_ledger.read","payment_method.read","payment_method.manage","payment_intent.read","payment_intent.create","auto_topup.read","auto_topup.manage"]},{"id":"org-other","name":"Other Org","role":"owner"}]}`))
		case "/v1/orgs/org-safe/billing/account":
			_, _ = w.Write([]byte(`{"account":{"id":"acct-1","organization_id":"org-safe","currency":"TWD","available_balance_minor":125000,"state":"active","version":3,"created_at":"2026-08-01T00:00:00Z","updated_at":"2026-08-01T00:00:00Z"},"auto_topup":null}`))
		case "/v1/orgs/org-safe/auto-topup":
			if r.Method != http.MethodPut {
				t.Fatalf("auto-topup method = %s", r.Method)
			}
			if r.Header.Get("If-Match") != `"3"` {
				t.Fatalf("If-Match = %q", r.Header.Get("If-Match"))
			}
			if r.Header.Get("X-Request-Id") != "request-payment-1" {
				t.Fatalf("X-Request-Id = %q", r.Header.Get("X-Request-Id"))
			}
			body, _ := io.ReadAll(r.Body)
			if strings.Contains(string(body), "card_number") || strings.Contains(string(body), "cvv") {
				t.Fatalf("payment policy leaked card credentials: %s", body)
			}
			sawPolicyWrite = true
			w.Header().Set("ETag", `"4"`)
			_, _ = w.Write([]byte(`{"auto_topup":{"id":"policy-1","enabled":true,"threshold_minor":50000,"top_up_amount_minor":100000,"currency":"TWD","payment_method_id":"method-1","daily_attempt_limit":3,"daily_amount_limit_minor":300000,"cooldown_seconds":3600,"generation":2,"version":4,"armed":true,"limit_timezone":"UTC","limit_reset_at":"2026-08-16T00:00:00Z","created_at":"2026-08-01T00:00:00Z","updated_at":"2026-08-15T00:00:00Z"}}`))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "owner@example.com", "customer-access", "customer-refresh", "org-safe", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	srv := NewWithOptions(st, Options{Config: config.Config{AccountManagerBaseURL: upstream.URL}, AccountClient: accountclient.New(upstream.URL)})

	accountRequest := httptest.NewRequest(http.MethodGet, "/api/billing/account?organization_id=org-other", nil)
	accountRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	accountResponse := httptest.NewRecorder()
	srv.ServeHTTP(accountResponse, accountRequest)
	if accountResponse.Code != http.StatusOK || !strings.Contains(accountResponse.Body.String(), `"organization_id":"org-safe"`) {
		t.Fatalf("billing account status=%d body=%s", accountResponse.Code, accountResponse.Body.String())
	}

	policyBody := `{"enabled":true,"threshold_minor":50000,"top_up_amount_minor":100000,"currency":"TWD","payment_method_id":"method-1","daily_attempt_limit":3,"daily_amount_limit_minor":300000,"cooldown_seconds":3600,"consent":{"accepted":true,"text_version":"v1","text_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","locale":"zh-TW"}}`
	policyRequest := httptest.NewRequest(http.MethodPut, "/api/billing/auto-topup", strings.NewReader(policyBody))
	policyRequest.Header.Set("If-Match", `"3"`)
	policyRequest.Header.Set("X-Request-Id", "request-payment-1")
	policyRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	policyResponse := httptest.NewRecorder()
	srv.ServeHTTP(policyResponse, policyRequest)
	if policyResponse.Code != http.StatusOK || policyResponse.Header().Get("ETag") != `"4"` || !sawPolicyWrite {
		t.Fatalf("policy status=%d etag=%q body=%s", policyResponse.Code, policyResponse.Header().Get("ETag"), policyResponse.Body.String())
	}
}

func TestPaymentBFFRejectsCardFieldsAndRedactsUpstreamFailure(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1"},"organizations":[{"id":"org-safe","name":"Safe Org","role":"owner","permissions":["payment_method.manage"]}]}`))
		case "/v1/orgs/org-safe/payment-methods/setup":
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "PAYMENT_CAPABILITY_UNSUPPORTED", "message": "Provider-hosted setup is not qualified.", "provider_secret": "must-not-leak"}})
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "owner@example.com", "customer-access", "customer-refresh", "org-safe", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	srv := NewWithOptions(st, Options{Config: config.Config{AccountManagerBaseURL: upstream.URL}, AccountClient: accountclient.New(upstream.URL)})

	unsafeRequest := httptest.NewRequest(http.MethodPost, "/api/billing/payment-methods/setup", strings.NewReader(`{"provider":"newebpay","card_number":"4111111111111111","cvv":"123"}`))
	unsafeRequest.Header.Set("Idempotency-Key", "setup-unsafe")
	unsafeRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	unsafeResponse := httptest.NewRecorder()
	srv.ServeHTTP(unsafeResponse, unsafeRequest)
	if unsafeResponse.Code != http.StatusBadRequest {
		t.Fatalf("unsafe setup status=%d body=%s", unsafeResponse.Code, unsafeResponse.Body.String())
	}

	safeRequest := httptest.NewRequest(http.MethodPost, "/api/billing/payment-methods/setup", strings.NewReader(`{"provider":"newebpay"}`))
	safeRequest.Header.Set("Idempotency-Key", "setup-safe")
	safeRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	safeResponse := httptest.NewRecorder()
	srv.ServeHTTP(safeResponse, safeRequest)
	if safeResponse.Code != http.StatusConflict || !strings.Contains(safeResponse.Body.String(), "PAYMENT_CAPABILITY_UNSUPPORTED") {
		t.Fatalf("safe setup status=%d body=%s", safeResponse.Code, safeResponse.Body.String())
	}
	if strings.Contains(safeResponse.Body.String(), "must-not-leak") || strings.Contains(safeResponse.Body.String(), "provider_secret") {
		t.Fatalf("safe setup leaked upstream details: %s", safeResponse.Body.String())
	}

	unauthenticated := httptest.NewRecorder()
	srv.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/billing/account", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", unauthenticated.Code)
	}
}
