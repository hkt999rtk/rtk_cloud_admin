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
	"rtk_cloud_admin/internal/billingclient"
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
		case "/v1/orgs/org-safe/billing/ledger":
			if r.URL.Query().Get("limit") != "25" || r.URL.Query().Get("ignored") != "" {
				t.Fatalf("ledger query=%s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"ledger_entries":[],"pagination":{"limit":25,"offset":0,"total":0}}`))
		case "/v1/orgs/org-safe/payment-methods":
			_, _ = w.Write([]byte(`{"payment_methods":[{"id":"method-1","provider":"newebpay","status":"active","last_four":"4242","capabilities":{}}],"pagination":{"limit":25,"offset":0,"total":1}}`))
		case "/v1/orgs/org-safe/payment-methods/method-1":
			if r.Method != http.MethodDelete {
				t.Fatalf("payment method method=%s", r.Method)
			}
			_, _ = w.Write([]byte(`{"payment_method":{"id":"method-1","status":"revoked"},"policy_disabled":true,"duplicate":false}`))
		case "/v1/orgs/org-safe/auto-topup":
			switch r.Method {
			case http.MethodGet:
				w.Header().Set("ETag", `"3"`)
				_, _ = w.Write([]byte(`{"auto_topup":null}`))
			case http.MethodPut:
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
			case http.MethodDelete:
				if r.Header.Get("If-Match") != `"4"` {
					t.Fatalf("delete If-Match = %q", r.Header.Get("If-Match"))
				}
				w.Header().Set("ETag", `"5"`)
				_, _ = w.Write([]byte(`{"auto_topup":{"id":"policy-1","enabled":false,"version":5}}`))
			default:
				t.Fatalf("auto-topup method = %s", r.Method)
			}
		case "/v1/orgs/org-safe/topups":
			if r.Header.Get("Idempotency-Key") != "topup-bff-1" {
				t.Fatalf("topup idempotency=%q", r.Header.Get("Idempotency-Key"))
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"payment_intent":{"id":"intent-1","state":"created"},"duplicate":false}`))
		case "/v1/orgs/org-safe/payment-intents":
			_, _ = w.Write([]byte(`{"payment_intents":[{"id":"intent-1","state":"created"}],"pagination":{"limit":25,"offset":0,"total":1}}`))
		case "/v1/orgs/org-safe/payment-intents/intent-1":
			_, _ = w.Write([]byte(`{"payment_intent":{"id":"intent-1","state":"created"},"attempts":[]}`))
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
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL, BillingServiceBaseURL: upstream.URL, BillingServiceToken: strings.Repeat("b", 32)},
		AccountClient: accountclient.New(upstream.URL), BillingClient: billingclient.New(upstream.URL, strings.Repeat("b", 32)),
	})

	accountRequest := httptest.NewRequest(http.MethodGet, "/api/billing/account?organization_id=org-other", nil)
	accountRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	accountResponse := httptest.NewRecorder()
	srv.ServeHTTP(accountResponse, accountRequest)
	if accountResponse.Code != http.StatusOK || !strings.Contains(accountResponse.Body.String(), `"organization_id":"org-safe"`) {
		t.Fatalf("billing account status=%d body=%s", accountResponse.Code, accountResponse.Body.String())
	}
	request := func(method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		var reader io.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, target, reader)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		response := httptest.NewRecorder()
		srv.ServeHTTP(response, req)
		return response
	}
	if response := request(http.MethodGet, "/api/billing/ledger?limit=25&offset=0&ignored=secret", "", nil); response.Code != http.StatusOK {
		t.Fatalf("ledger status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/summary", "", nil); response.Code != http.StatusForbidden {
		t.Fatalf("missing summary capability status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/payment-methods", "", nil); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "4242") {
		t.Fatalf("methods status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/auto-topup", "", nil); response.Code != http.StatusOK || response.Header().Get("ETag") != `"3"` {
		t.Fatalf("auto-topup status/body/etag=%d/%s/%q", response.Code, response.Body.String(), response.Header().Get("ETag"))
	}
	if response := request(http.MethodPut, "/api/billing/auto-topup", `{}`, nil); response.Code != http.StatusPreconditionRequired || !strings.Contains(response.Body.String(), "AUTO_TOPUP_POLICY_CONFLICT") {
		t.Fatalf("missing If-Match status/body=%d/%s", response.Code, response.Body.String())
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
	if response := request(http.MethodDelete, "/api/billing/auto-topup", `{"reason":"customer paused"}`, map[string]string{"If-Match": `"4"`}); response.Code != http.StatusOK || response.Header().Get("ETag") != `"5"` {
		t.Fatalf("disable status/body/etag=%d/%s/%q", response.Code, response.Body.String(), response.Header().Get("ETag"))
	}
	if response := request(http.MethodDelete, "/api/billing/payment-methods/method-1", `{"reason":"customer revoked method"}`, nil); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"policy_disabled":true`) {
		t.Fatalf("revoke status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodDelete, "/api/billing/payment-methods/method-1", `{"reason":"x"}`, nil); response.Code != http.StatusBadRequest {
		t.Fatalf("short revoke reason status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodDelete, "/api/billing/auto-topup", `{"reason":"x"}`, map[string]string{"If-Match": `"5"`}); response.Code != http.StatusBadRequest {
		t.Fatalf("short disable reason status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, "/api/billing/topups", `{"amount_minor":`, map[string]string{"Idempotency-Key": "topup-malformed"}); response.Code != http.StatusBadRequest {
		t.Fatalf("malformed topup status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, "/api/billing/topups", `{"amount_minor":10000,"currency":"TWD","payment_method_id":"method-1"}`, map[string]string{"Idempotency-Key": "topup-bff-1"}); response.Code != http.StatusAccepted {
		t.Fatalf("topup status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/payment-intents?limit=25", "", nil); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "intent-1") {
		t.Fatalf("intents status/body=%d/%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, "/api/billing/payment-intents/intent-1", "", nil); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "intent-1") {
		t.Fatalf("intent status/body=%d/%s", response.Code, response.Body.String())
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
			var request struct {
				Provider string `json:"provider"`
				Consent  struct {
					Accepted   bool   `json:"accepted"`
					TextSHA256 string `json:"text_sha256"`
				} `json:"consent"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Provider != "newebpay" || !request.Consent.Accepted || len(request.Consent.TextSHA256) != 64 {
				t.Fatalf("unexpected setup request: %+v err=%v", request, err)
			}
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
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL, BillingServiceBaseURL: upstream.URL, BillingServiceToken: strings.Repeat("b", 32)},
		AccountClient: accountclient.New(upstream.URL), BillingClient: billingclient.New(upstream.URL, strings.Repeat("b", 32)),
	})

	missingKeyRequest := httptest.NewRequest(http.MethodPost, "/api/billing/payment-methods/setup", strings.NewReader(`{"provider":"newebpay","consent":{"accepted":true,"text_version":"payment-method-v1","text_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","locale":"zh-TW"}}`))
	missingKeyRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	missingKeyResponse := httptest.NewRecorder()
	srv.ServeHTTP(missingKeyResponse, missingKeyRequest)
	if missingKeyResponse.Code != http.StatusPreconditionRequired || !strings.Contains(missingKeyResponse.Body.String(), "IDEMPOTENCY_KEY_REQUIRED") {
		t.Fatalf("missing idempotency key status=%d body=%s", missingKeyResponse.Code, missingKeyResponse.Body.String())
	}

	unsafeRequest := httptest.NewRequest(http.MethodPost, "/api/billing/payment-methods/setup", strings.NewReader(`{"provider":"newebpay","card_number":"4111111111111111","cvv":"123"}`))
	unsafeRequest.Header.Set("Idempotency-Key", "setup-unsafe")
	unsafeRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	unsafeResponse := httptest.NewRecorder()
	srv.ServeHTTP(unsafeResponse, unsafeRequest)
	if unsafeResponse.Code != http.StatusBadRequest {
		t.Fatalf("unsafe setup status=%d body=%s", unsafeResponse.Code, unsafeResponse.Body.String())
	}

	safeRequest := httptest.NewRequest(http.MethodPost, "/api/billing/payment-methods/setup", strings.NewReader(`{"provider":"newebpay","consent":{"accepted":true,"text_version":"payment-method-v1","text_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","locale":"zh-TW"}}`))
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

func TestPaymentBFFValidationAndStableErrors(t *testing.T) {
	t.Parallel()

	validDigest := strings.Repeat("A", 64)
	for _, test := range []struct {
		name  string
		value string
		valid bool
	}{
		{name: "uppercase digest", value: validDigest, valid: true},
		{name: "short digest", value: "abcd", valid: false},
		{name: "non hexadecimal", value: strings.Repeat("g", 64), valid: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validPaymentSHA256(test.value); got != test.valid {
				t.Fatalf("validPaymentSHA256(%q) = %t, want %t", test.value, got, test.valid)
			}
		})
	}

	queryRequest := httptest.NewRequest(http.MethodGet, "/api/billing/ledger?limit=%2025%20&offset=0&provider_secret=hidden", nil)
	if got := boundedPaymentQuery(queryRequest).Encode(); got != "limit=25&offset=0" {
		t.Fatalf("bounded query = %q", got)
	}

	for _, test := range []struct {
		name string
		body string
		ok   bool
	}{
		{name: "valid", body: `{"reason":"customer request"}`, ok: true},
		{name: "unknown field", body: `{"reason":"customer request","card_number":"4111111111111111"}`, ok: false},
		{name: "multiple documents", body: `{"reason":"customer request"}{"reason":"second"}`, ok: false},
		{name: "malformed", body: `{"reason":`, ok: false},
	} {
		t.Run("decode "+test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			var destination struct {
				Reason string `json:"reason"`
			}
			if got := decodePaymentRequest(response, request, &destination); got != test.ok {
				t.Fatalf("decodePaymentRequest() = %t, want %t", got, test.ok)
			}
			if !test.ok && response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}
		})
	}

	for _, code := range []string{
		"PAYMENT_METHOD_SETUP_CONFLICT",
		"PAYMENT_PROVIDER_RESPONSE_INVALID",
		"PAYMENT_REFERENCE_PROTECTION_UNCONFIGURED",
		"PAYMENT_REFERENCE_PROTECTION_FAILED",
	} {
		if !paymentErrorCodeAllowed(code) {
			t.Fatalf("safe payment error code %q is not allowed", code)
		}
	}
	if paymentErrorCodeAllowed("PROVIDER_SECRET_LEAK") {
		t.Fatal("unknown provider error code must not be allowed")
	}

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u-disabled", "disabled@example.com", "access", "refresh", "org-disabled", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	srv := NewWithOptions(st, Options{})
	disabledRequest := httptest.NewRequest(http.MethodGet, "/api/billing/account", nil)
	disabledRequest.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	disabledResponse := httptest.NewRecorder()
	srv.ServeHTTP(disabledResponse, disabledRequest)
	if disabledResponse.Code != http.StatusServiceUnavailable || !strings.Contains(disabledResponse.Body.String(), "not configured") {
		t.Fatalf("disabled billing status/body=%d/%s", disabledResponse.Code, disabledResponse.Body.String())
	}

	response := httptest.NewRecorder()
	srv.writePaymentBFFError(response, "missing-session", &billingclient.HTTPError{
		Method:     http.MethodPost,
		Path:       "/v1/orgs/org-safe/payment-methods/setup",
		StatusCode: http.StatusServiceUnavailable,
		Body:       `{"code":"PAYMENT_REFERENCE_PROTECTION_UNCONFIGURED","message":"Payment reference protection is unavailable.","provider_secret":"must-not-leak"}`,
	})
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "PAYMENT_REFERENCE_PROTECTION_UNCONFIGURED") {
		t.Fatalf("stable error status/body=%d/%s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "provider_secret") || strings.Contains(response.Body.String(), "must-not-leak") {
		t.Fatalf("stable error leaked upstream details: %s", response.Body.String())
	}
}
