package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"
	"strings"
	"testing"
	"time"
)

func TestServerHealthAndHomeRedirect(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	health := httptest.NewRecorder()
	srv.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", health.Code, http.StatusOK)
	}
	if strings.TrimSpace(health.Body.String()) != "ok" {
		t.Fatalf("health body = %q, want ok", health.Body.String())
	}

	home := httptest.NewRecorder()
	srv.ServeHTTP(home, httptest.NewRequest(http.MethodGet, "/", nil))
	if home.Code != http.StatusFound {
		t.Fatalf("home status = %d, want %d", home.Code, http.StatusFound)
	}
	if got := home.Header().Get("Location"); got != "/console" {
		t.Fatalf("home redirect = %q, want /console", got)
	}

	for _, path := range []string{
		"/console",
		"/console/overview",
		"/console/devices",
		"/console/firmware-ota",
		"/console/stream-health",
		"/console/groups",
		"/console/customers",
		"/console/operations",
		"/console/audit",
		"/admin",
		"/admin/ops",
		"/admin/operations",
		"/admin/audit",
		"/admin/sso",
	} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d; body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
		}
	}
}

func TestPublicSignupVerifyAndQuotaRaiseFlow(t *testing.T) {
	t.Parallel()

	var quotaRaiseBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/signup":
			_, _ = w.Write([]byte(`{"user":{"id":"u-signup","email":"signup@example.com","name":"Signup User"},"organization":{"id":"org-1","name":"Acme Eval","role":"owner","tier":"evaluation","evaluation_device_quota":5}}`))
		case "/v1/auth/verify-email":
			_, _ = w.Write([]byte(`{"user":{"id":"u-signup","email":"signup@example.com","name":"Signup User"},"tokens":{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600}}`))
		case "/v1/auth/resend-verification":
			w.WriteHeader(http.StatusAccepted)
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u-signup","email":"signup@example.com","name":"Signup User"},"organizations":[{"id":"org-1","name":"Acme Eval","role":"owner","tier":"evaluation","evaluation_device_quota":5}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-1","name":"Acme Eval","role":"owner","tier":"evaluation","evaluation_device_quota":5}]}`))
		case "/v1/orgs/org-1/quota-raise-requests":
			if got := r.Header.Get("Authorization"); got != "Bearer access-1" {
				t.Fatalf("Authorization = %q, want Bearer access-1", got)
			}
			body, _ := io.ReadAll(r.Body)
			quotaRaiseBody = string(body)
			_, _ = w.Write([]byte(`{"quota_raise_request":{"id":"req-1","organization_id":"org-1","requested_by":"u-signup","requested_quota":25,"use_case":"growth","contact_info":{"email":"owner@example.com"},"status":"pending","created_at":"2026-05-05T00:00:00Z","updated_at":"2026-05-05T00:00:00Z"},"organization":{"id":"org-1","name":"Acme Eval","role":"owner","tier":"evaluation","evaluation_device_quota":5}}`))
		default:
			t.Fatalf("unexpected upstream request path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	srv := NewWithOptions(mustOpenStore(t), Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})

	for _, path := range []string{"/signup", "/signup/check-email", "/verify"} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
	}

	signupRec := httptest.NewRecorder()
	srv.ServeHTTP(signupRec, httptest.NewRequest(http.MethodPost, "/api/auth/customer/signup", strings.NewReader(`{"email":"signup@example.com","password":"password123","organization_name":"Acme Eval","display_name":"Signup User"}`)))
	if signupRec.Code != http.StatusAccepted {
		t.Fatalf("signup status = %d, body=%s", signupRec.Code, signupRec.Body.String())
	}
	if !strings.Contains(signupRec.Body.String(), `"tier":"evaluation"`) {
		t.Fatalf("signup body = %s", signupRec.Body.String())
	}

	resendRec := httptest.NewRecorder()
	srv.ServeHTTP(resendRec, httptest.NewRequest(http.MethodPost, "/api/auth/customer/resend-verification", strings.NewReader(`{"email":"signup@example.com"}`)))
	if resendRec.Code != http.StatusAccepted {
		t.Fatalf("resend status = %d, body=%s", resendRec.Code, resendRec.Body.String())
	}

	verifyRec := httptest.NewRecorder()
	srv.ServeHTTP(verifyRec, httptest.NewRequest(http.MethodPost, "/api/auth/customer/verify-email", strings.NewReader(`{"token":"token-1"}`)))
	if verifyRec.Code != http.StatusOK {
		t.Fatalf("verify status = %d, body=%s", verifyRec.Code, verifyRec.Body.String())
	}
	if len(verifyRec.Result().Cookies()) != 1 {
		t.Fatalf("verify did not set a session cookie")
	}
	sessionCookie := verifyRec.Result().Cookies()[0]

	meRec := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(sessionCookie)
	srv.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK {
		t.Fatalf("me status = %d, body=%s", meRec.Code, meRec.Body.String())
	}
	if !strings.Contains(meRec.Body.String(), `"evaluation_device_quota":5`) {
		t.Fatalf("me body = %s", meRec.Body.String())
	}

	quotaRec := httptest.NewRecorder()
	quotaReq := httptest.NewRequest(http.MethodPost, "/api/orgs/org-1/quota-raise-requests", strings.NewReader(`{"requested_quota":25,"use_case":"growth","contact_info":{"email":"owner@example.com"}}`))
	quotaReq.AddCookie(sessionCookie)
	srv.ServeHTTP(quotaRec, quotaReq)
	if quotaRec.Code != http.StatusCreated {
		t.Fatalf("quota raise status = %d, body=%s", quotaRec.Code, quotaRec.Body.String())
	}
	if !strings.Contains(quotaRaiseBody, `"requested_quota":25`) {
		t.Fatalf("quota raise body = %s", quotaRaiseBody)
	}
}

func TestSSOStartAndCallbackCreateSessions(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/sso/start":
			var body accountclient.SSOStartRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso start: %v", err)
			}
			if body.Email != "owner@example.com" {
				t.Fatalf("sso start email = %q", body.Email)
			}
			_ = json.NewEncoder(w).Encode(accountclient.SSOStartResult{
				RedirectURL:    "https://idp.example.com/authorize?state=state-1",
				State:          "state-1",
				ProviderID:     "provider-1",
				OrganizationID: "org-1",
				Organization:   "Acme",
			})
		case "/v1/auth/sso/callback":
			var body accountclient.SSOCallbackRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso callback: %v", err)
			}
			switch body.Code {
			case "customer-code":
				_ = json.NewEncoder(w).Encode(accountclient.SSOCallbackResult{
					User:          accountclient.User{ID: "u-customer", Email: "owner@example.com", Name: "Owner"},
					Kind:          "customer",
					ActiveOrgID:   "org-1",
					Organizations: []accountclient.Organization{{ID: "org-1", Name: "Acme", Role: "owner", Tier: "evaluation", EvaluationDeviceQuota: 5}},
					Tokens:        accountclient.Tokens{AccessToken: "customer-access", RefreshToken: "customer-refresh", ExpiresIn: 3600},
				})
			case "admin-code":
				_ = json.NewEncoder(w).Encode(accountclient.SSOCallbackResult{
					User:   accountclient.User{ID: "admin-1", Email: "admin@example.com", Name: "Admin"},
					Kind:   "platform_admin",
					Tokens: accountclient.Tokens{AccessToken: "admin-access", RefreshToken: "admin-refresh", ExpiresIn: 3600},
				})
			default:
				http.Error(w, "invalid callback", http.StatusUnauthorized)
			}
		case "/v1/me":
			if r.Header.Get("Authorization") != "Bearer customer-access" {
				t.Fatalf("me Authorization = %q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(accountclient.MeResult{
				User:          accountclient.User{ID: "u-customer", Email: "owner@example.com", Name: "Owner"},
				Organizations: []accountclient.Organization{{ID: "org-1", Name: "Acme", Role: "owner", Tier: "evaluation", EvaluationDeviceQuota: 5}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	start := httptest.NewRecorder()
	srv.ServeHTTP(start, httptest.NewRequest(http.MethodPost, "/api/auth/sso/start", strings.NewReader(`{"email":"owner@example.com","return_url":"https://admin.example.com/console"}`)))
	if start.Code != http.StatusOK {
		t.Fatalf("sso start status = %d, body=%s", start.Code, start.Body.String())
	}
	if !strings.Contains(start.Body.String(), `"redirect_url":"https://idp.example.com/authorize?state=state-1"`) {
		t.Fatalf("sso start body = %s", start.Body.String())
	}

	customerCallback := httptest.NewRecorder()
	srv.ServeHTTP(customerCallback, httptest.NewRequest(http.MethodGet, "/api/auth/sso/callback?code=customer-code&state=state-1&redirect_uri=https%3A%2F%2Fadmin.example.com%2Fapi%2Fauth%2Fsso%2Fcallback", nil))
	if customerCallback.Code != http.StatusFound {
		t.Fatalf("customer callback status = %d, body=%s", customerCallback.Code, customerCallback.Body.String())
	}
	if got := customerCallback.Header().Get("Location"); got != "/console" {
		t.Fatalf("customer callback location = %q", got)
	}
	if len(customerCallback.Result().Cookies()) != 1 {
		t.Fatalf("customer callback did not set session cookie")
	}
	customerSession, err := st.GetSession(customerCallback.Result().Cookies()[0].Value)
	if err != nil {
		t.Fatalf("GetSession customer returned error: %v", err)
	}
	if customerSession.Kind != "customer" || customerSession.Subject != "u-customer" || customerSession.ActiveOrgID != "org-1" || customerSession.AccessToken != "customer-access" {
		t.Fatalf("customer session = %#v", customerSession)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(customerCallback.Result().Cookies()[0])
	meRec := httptest.NewRecorder()
	srv.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK {
		t.Fatalf("me status = %d, body=%s", meRec.Code, meRec.Body.String())
	}
	var customerMe contracts.Me
	if err := json.NewDecoder(meRec.Body).Decode(&customerMe); err != nil {
		t.Fatalf("decode customer me: %v", err)
	}
	if customerMe.Kind != "customer" || customerMe.ActiveOrgID != "org-1" || !customerMe.Authenticated || customerMe.DemoMode || len(customerMe.Memberships) != 1 {
		t.Fatalf("customer me = %#v", customerMe)
	}

	adminCallback := httptest.NewRecorder()
	srv.ServeHTTP(adminCallback, httptest.NewRequest(http.MethodGet, "/api/auth/sso/callback?code=admin-code&state=state-2", nil))
	if adminCallback.Code != http.StatusFound {
		t.Fatalf("admin callback status = %d, body=%s", adminCallback.Code, adminCallback.Body.String())
	}
	if got := adminCallback.Header().Get("Location"); got != "/admin" {
		t.Fatalf("admin callback location = %q", got)
	}
	adminSession, err := st.GetSession(adminCallback.Result().Cookies()[0].Value)
	if err != nil {
		t.Fatalf("GetSession admin returned error: %v", err)
	}
	if adminSession.Kind != "platform_admin" || adminSession.Subject != "admin-1" || adminSession.AccessToken != "admin-access" {
		t.Fatalf("admin session = %#v", adminSession)
	}

	adminMeReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	adminMeReq.AddCookie(adminCallback.Result().Cookies()[0])
	adminMeRec := httptest.NewRecorder()
	srv.ServeHTTP(adminMeRec, adminMeReq)
	if adminMeRec.Code != http.StatusOK {
		t.Fatalf("admin me status = %d, body=%s", adminMeRec.Code, adminMeRec.Body.String())
	}
	var adminMe contracts.Me
	if err := json.NewDecoder(adminMeRec.Body).Decode(&adminMe); err != nil {
		t.Fatalf("decode admin me: %v", err)
	}
	if adminMe.Kind != "platform_admin" || !adminMe.Authenticated || adminMe.DemoMode || adminMe.Memberships == nil || len(adminMe.Memberships) != 0 {
		t.Fatalf("admin me = %#v", adminMe)
	}

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(customerCallback.Result().Cookies()[0])
	srv.ServeHTTP(logout, logoutReq)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body=%s", logout.Code, logout.Body.String())
	}
	events, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	assertAuditEvent(t, events, "SSOLogin", "owner@example.com", "customer", "accepted")
	assertAuditEvent(t, events, "SSOLogin", "admin@example.com", "platform_admin", "accepted")
	assertAuditEvent(t, events, "SessionLogout", "owner@example.com", "customer", "accepted")
}

func TestSSOEndpointsMapStableErrors(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/sso/start":
			var body accountclient.SSOStartRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso start: %v", err)
			}
			switch body.Email {
			case "unknown@example.com":
				http.Error(w, "unknown domain", http.StatusNotFound)
			case "disabled@example.com":
				http.Error(w, "provider disabled", http.StatusForbidden)
			default:
				http.Error(w, "upstream down", http.StatusInternalServerError)
			}
		case "/v1/auth/sso/callback":
			switch r.URL.Query().Get("case") {
			default:
				_ = json.NewEncoder(w).Encode(accountclient.SSOCallbackResult{
					User:   accountclient.User{ID: "u1", Email: "bad@example.com"},
					Kind:   "super_admin",
					Tokens: accountclient.Tokens{AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600},
				})
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	srv := NewWithOptions(mustOpenStore(t), Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})

	for _, tc := range []struct {
		name   string
		email  string
		status int
		want   string
	}{
		{"unknown domain", "unknown@example.com", http.StatusNotFound, "SSO provider was not found"},
		{"disabled provider", "disabled@example.com", http.StatusForbidden, "SSO provider is disabled"},
		{"upstream failure", "owner@example.com", http.StatusBadGateway, "Account Manager SSO request failed"},
	} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/sso/start", strings.NewReader(fmt.Sprintf(`{"email":%q}`, tc.email))))
		if rec.Code != tc.status {
			t.Fatalf("%s status = %d, want %d; body=%s", tc.name, rec.Code, tc.status, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Fatalf("%s body = %s", tc.name, rec.Body.String())
		}
	}

	invalid := httptest.NewRecorder()
	srv.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/api/auth/sso/callback?code=bad&state=state", nil))
	if invalid.Code != http.StatusBadGateway {
		t.Fatalf("invalid kind status = %d, body=%s", invalid.Code, invalid.Body.String())
	}
	if !strings.Contains(invalid.Body.String(), "unsupported SSO session kind") {
		t.Fatalf("invalid kind body = %s", invalid.Body.String())
	}

	missing := httptest.NewRecorder()
	srv.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/api/auth/sso/callback?state=state", nil))
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("missing callback status = %d, body=%s", missing.Code, missing.Body.String())
	}

	disabled := httptest.NewRecorder()
	NewWithOptions(mustOpenStore(t), Options{}).ServeHTTP(disabled, httptest.NewRequest(http.MethodPost, "/api/auth/sso/start", strings.NewReader(`{"email":"owner@example.com"}`)))
	if disabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled sso start status = %d, body=%s", disabled.Code, disabled.Body.String())
	}

	invalidStart := httptest.NewRecorder()
	srv.ServeHTTP(invalidStart, httptest.NewRequest(http.MethodPost, "/api/auth/sso/start", strings.NewReader(`{`)))
	if invalidStart.Code != http.StatusBadRequest {
		t.Fatalf("invalid sso start status = %d, body=%s", invalidStart.Code, invalidStart.Body.String())
	}

	missingEmail := httptest.NewRecorder()
	srv.ServeHTTP(missingEmail, httptest.NewRequest(http.MethodPost, "/api/auth/sso/start", strings.NewReader(`{"email":" "}`)))
	if missingEmail.Code != http.StatusBadRequest {
		t.Fatalf("missing email status = %d, body=%s", missingEmail.Code, missingEmail.Body.String())
	}
}

func TestLegacyCustomerPasswordLoginDisabledByDefault(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("legacy customer login should not call upstream when disabled: %s", r.URL.Path)
	}))
	defer upstream.Close()

	srv := NewWithOptions(mustOpenStore(t), Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("customer login status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "customer password login is disabled") {
		t.Fatalf("customer login body = %s", rec.Body.String())
	}
}

func TestSSOCustomerMeAllowsMissingMemberships(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/sso/callback":
			_ = json.NewEncoder(w).Encode(accountclient.SSOCallbackResult{
				User:   accountclient.User{ID: "u-empty", Email: "empty@example.com", Name: "Empty"},
				Kind:   "customer",
				Tokens: accountclient.Tokens{AccessToken: "empty-access", RefreshToken: "empty-refresh", ExpiresIn: 3600},
			})
		case "/v1/me":
			if got := r.Header.Get("Authorization"); got != "Bearer empty-access" {
				t.Fatalf("me Authorization = %q", got)
			}
			_ = json.NewEncoder(w).Encode(accountclient.MeResult{
				User:          accountclient.User{ID: "u-empty", Email: "empty@example.com", Name: "Empty"},
				Organizations: []accountclient.Organization{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})
	callback := httptest.NewRecorder()
	srv.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/api/auth/sso/callback?code=no-org-code&state=state-1", nil))
	if callback.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", callback.Code, callback.Body.String())
	}
	session, err := st.GetSession(callback.Result().Cookies()[0].Value)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if session.ActiveOrgID != "" {
		t.Fatalf("active org = %q, want empty", session.ActiveOrgID)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	meReq.AddCookie(callback.Result().Cookies()[0])
	meRec := httptest.NewRecorder()
	srv.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK {
		t.Fatalf("me status = %d, body=%s", meRec.Code, meRec.Body.String())
	}
	var me contracts.Me
	if err := json.NewDecoder(meRec.Body).Decode(&me); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if me.Kind != "customer" || me.ActiveOrgID != "" || me.Memberships == nil || len(me.Memberships) != 0 {
		t.Fatalf("me missing memberships contract = %#v", me)
	}
}

func TestAdminSSOProviderRoutesProxyAndRedactSecrets(t *testing.T) {
	t.Parallel()

	var receivedConfig accountclient.SSOProviderConfigRequest
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
			t.Fatalf("%s Authorization = %q", r.URL.Path, got)
		}
		switch r.URL.Path {
		case "/v1/admin/sso/providers/status":
			if r.Method != http.MethodGet {
				t.Fatalf("providers method = %s", r.Method)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"providers": []map[string]any{{
					"organization_id":   "org-acme",
					"organization":      "Acme Smart Camera",
					"provider_id":       "provider-1",
					"issuer":            "https://idp.example.com",
					"client_id":         "client-1",
					"verified_domains":  []string{"example.com"},
					"enabled":           true,
					"configured":        true,
					"status":            "ready",
					"last_validated_at": "2026-05-11T00:00:00Z",
				}},
			})
		case "/v1/admin/orgs/org-acme/sso-provider":
			switch r.Method {
			case http.MethodGet:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"provider": map[string]any{
						"organization_id":  "org-acme",
						"organization":     "Acme Smart Camera",
						"provider_id":      "provider-1",
						"issuer":           "https://idp.example.com",
						"client_id":        "client-1",
						"verified_domains": []string{"example.com"},
						"enabled":          true,
						"configured":       true,
						"status":           "ready",
					},
				})
			case http.MethodPut:
				if err := json.NewDecoder(r.Body).Decode(&receivedConfig); err != nil {
					t.Fatalf("decode provider config: %v", err)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"provider": map[string]any{
						"organization_id":  "org-acme",
						"organization":     "Acme Smart Camera",
						"provider_id":      "provider-1",
						"issuer":           receivedConfig.Issuer,
						"client_id":        receivedConfig.ClientID,
						"verified_domains": receivedConfig.VerifiedDomains,
						"enabled":          receivedConfig.Enabled,
						"configured":       true,
						"status":           "ready",
					},
				})
			default:
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	adminSession, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession admin returned error: %v", err)
	}
	customerSession, err := st.CreateSession("customer", "u1", "owner@example.com", "customer-access", "customer-refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})

	unauth := httptest.NewRecorder()
	srv.ServeHTTP(unauth, httptest.NewRequest(http.MethodGet, "/api/admin/sso/providers", nil))
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauth providers status = %d", unauth.Code)
	}

	blocked := httptest.NewRecorder()
	blockedReq := httptest.NewRequest(http.MethodGet, "/api/admin/sso/providers", nil)
	blockedReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: customerSession.ID})
	srv.ServeHTTP(blocked, blockedReq)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("customer providers status = %d", blocked.Code)
	}

	adminCookie := &http.Cookie{Name: "rtk_admin_session", Value: adminSession.ID}
	providers := httptest.NewRecorder()
	providersReq := httptest.NewRequest(http.MethodGet, "/api/admin/sso/providers", nil)
	providersReq.AddCookie(adminCookie)
	srv.ServeHTTP(providers, providersReq)
	if providers.Code != http.StatusOK {
		t.Fatalf("providers status = %d, body=%s", providers.Code, providers.Body.String())
	}
	if strings.Contains(providers.Body.String(), "client_secret") {
		t.Fatalf("provider list leaked client_secret: %s", providers.Body.String())
	}

	provider := httptest.NewRecorder()
	providerReq := httptest.NewRequest(http.MethodGet, "/api/admin/orgs/org-acme/sso-provider", nil)
	providerReq.AddCookie(adminCookie)
	srv.ServeHTTP(provider, providerReq)
	if provider.Code != http.StatusOK {
		t.Fatalf("provider status = %d, body=%s", provider.Code, provider.Body.String())
	}
	if strings.Contains(provider.Body.String(), "client_secret") {
		t.Fatalf("provider detail leaked client_secret: %s", provider.Body.String())
	}

	badPayload := httptest.NewRecorder()
	badPayloadReq := httptest.NewRequest(http.MethodPut, "/api/admin/orgs/org-acme/sso-provider", strings.NewReader(`{`))
	badPayloadReq.AddCookie(adminCookie)
	srv.ServeHTTP(badPayload, badPayloadReq)
	if badPayload.Code != http.StatusBadRequest {
		t.Fatalf("bad payload status = %d, body=%s", badPayload.Code, badPayload.Body.String())
	}

	updateBody := `{"issuer":" https://idp.example.com ","client_id":"client-1","client_secret":"secret-1","verified_domains":[" Example.COM ","example.com",""],"enabled":true}`
	update := httptest.NewRecorder()
	updateReq := httptest.NewRequest(http.MethodPut, "/api/admin/orgs/org-acme/sso-provider", strings.NewReader(updateBody))
	updateReq.AddCookie(adminCookie)
	srv.ServeHTTP(update, updateReq)
	if update.Code != http.StatusOK {
		t.Fatalf("update status = %d, body=%s", update.Code, update.Body.String())
	}
	if receivedConfig.ClientSecret != "secret-1" {
		t.Fatalf("upstream did not receive client secret: %#v", receivedConfig)
	}
	if receivedConfig.Issuer != "https://idp.example.com" || len(receivedConfig.VerifiedDomains) != 1 || receivedConfig.VerifiedDomains[0] != "example.com" {
		t.Fatalf("normalized config = %#v", receivedConfig)
	}
	if strings.Contains(update.Body.String(), "secret-1") || strings.Contains(update.Body.String(), "client_secret") {
		t.Fatalf("update response leaked secret: %s", update.Body.String())
	}

	auditEvents, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	for _, event := range auditEvents {
		eventJSON, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("marshal audit event: %v", err)
		}
		if strings.Contains(string(eventJSON), "secret-1") || strings.Contains(string(eventJSON), "client_secret") {
			t.Fatalf("audit leaked secret: %#v", event)
		}
	}

	disabledServer := NewWithOptions(st, Options{})
	disabled := httptest.NewRecorder()
	disabledReq := httptest.NewRequest(http.MethodGet, "/api/admin/sso/providers", nil)
	disabledReq.AddCookie(adminCookie)
	disabledServer.ServeHTTP(disabled, disabledReq)
	if disabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled providers status = %d, body=%s", disabled.Code, disabled.Body.String())
	}
}

func TestPlatformBreakGlassLoginPolicyAndAudit(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	if err := st.BootstrapPlatformAdmin("admin@example.com", "secret"); err != nil {
		t.Fatalf("BootstrapPlatformAdmin returned error: %v", err)
	}

	disabledSrv := NewWithOptions(st, Options{Config: config.Config{}})
	disabled := httptest.NewRecorder()
	disabledSrv.ServeHTTP(disabled, httptest.NewRequest(http.MethodPost, "/api/auth/platform/login", strings.NewReader(`{"email":"admin@example.com","password":"secret"}`)))
	if disabled.Code != http.StatusForbidden {
		t.Fatalf("disabled break-glass status = %d, body=%s", disabled.Code, disabled.Body.String())
	}

	failed := httptest.NewRecorder()
	enabledSrv := NewWithOptions(st, Options{Config: config.Config{AdminBreakGlassEnabled: true}})
	enabledSrv.ServeHTTP(failed, httptest.NewRequest(http.MethodPost, "/api/auth/platform/login", strings.NewReader(`{"email":"admin@example.com","password":"wrong"}`)))
	if failed.Code != http.StatusUnauthorized {
		t.Fatalf("failed break-glass status = %d, body=%s", failed.Code, failed.Body.String())
	}

	success := httptest.NewRecorder()
	enabledSrv.ServeHTTP(success, httptest.NewRequest(http.MethodPost, "/api/auth/platform/login", strings.NewReader(`{"email":"admin@example.com","password":"secret"}`)))
	if success.Code != http.StatusOK {
		t.Fatalf("break-glass success status = %d, body=%s", success.Code, success.Body.String())
	}
	if len(success.Result().Cookies()) == 0 {
		t.Fatalf("break-glass success did not set session cookie")
	}
	session, err := st.GetSession(success.Result().Cookies()[0].Value)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if session.Kind != "platform_admin" {
		t.Fatalf("session kind = %q, want platform_admin", session.Kind)
	}

	events, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	results := map[string]bool{}
	for _, event := range events {
		if event.Action == "PlatformBreakGlassLogin" && event.Actor == "admin@example.com" && event.ActorKind == "platform_admin" {
			results[event.Result] = true
		}
	}
	for _, want := range []string{"disabled", "failed", "accepted"} {
		if !results[want] {
			t.Fatalf("missing break-glass audit result %q in %#v", want, events)
		}
	}
}

func mustOpenStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = st.Close()
	})
	return st
}

func legacyCustomerLoginConfig(baseURL string) config.Config {
	return config.Config{
		AccountManagerBaseURL:              baseURL,
		LegacyCustomerPasswordLoginEnabled: true,
	}
}

func assertAuditEvent(t *testing.T, events []contracts.AuditEvent, action, actor, actorKind, result string) {
	t.Helper()
	for _, event := range events {
		if event.Action == action && event.Actor == actor && event.ActorKind == actorKind && event.Result == result {
			return
		}
	}
	t.Fatalf("missing audit event action=%q actor=%q actorKind=%q result=%q in %#v", action, actor, actorKind, result, events)
}

func TestProvisionActionPublishesOperation(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil))
	if rec.Code != http.StatusCreated {
		t.Fatalf("provision status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var op contracts.Operation
	if err := json.NewDecoder(rec.Body).Decode(&op); err != nil {
		t.Fatalf("decode operation: %v", err)
	}
	if op.Type != "DeviceProvisionRequested" {
		t.Fatalf("operation type = %q, want DeviceProvisionRequested", op.Type)
	}
	if op.State != contracts.OperationPublished {
		t.Fatalf("operation state = %q, want published", op.State)
	}

	audit := httptest.NewRecorder()
	srv.ServeHTTP(audit, httptest.NewRequest(http.MethodGet, "/api/audit", nil))
	if audit.Code != http.StatusOK {
		t.Fatalf("audit status = %d, want %d; body=%s", audit.Code, http.StatusOK, audit.Body.String())
	}
	if !strings.Contains(audit.Body.String(), "DeviceProvisionRequested") {
		t.Fatalf("audit body does not contain DeviceProvisionRequested: %s", audit.Body.String())
	}
}

func TestCustomersAPI(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/customers", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("customers status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Acme Smart Camera") {
		t.Fatalf("customers body does not contain Acme Smart Camera: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Nova Home Labs") {
		t.Fatalf("customers body does not contain Nova Home Labs: %s", rec.Body.String())
	}
}

func TestServiceHealthReportsVideoCloudOK(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Fatalf("path = %q, want /healthz", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("Authorization = %q, want empty", got)
		}
		_, _ = w.Write([]byte("ok\n"))
	}))
	defer upstream.Close()

	srv := newSeededTestServer(t, config.Config{VideoCloudBaseURL: upstream.URL})
	health := requestJSON[[]contracts.ServiceHealth](t, srv, http.MethodGet, "/api/service-health", nil)

	video := findServiceHealth(t, health, "Video Cloud")
	if video.Status != "ok" {
		t.Fatalf("Video Cloud status = %q, want ok; detail=%s", video.Status, video.Detail)
	}
	if video.LastCheckedAt == "" {
		t.Fatal("Video Cloud last_checked_at is empty")
	}
}

func TestServiceHealthReportsAccountManagerOK(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/health" {
			t.Fatalf("path = %q, want /v1/health", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("Authorization = %q, want empty", got)
		}
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer accountUpstream.Close()

	srv := newSeededTestServer(t, config.Config{AccountManagerBaseURL: accountUpstream.URL})
	health := requestJSON[[]contracts.ServiceHealth](t, srv, http.MethodGet, "/api/service-health", nil)

	account := findServiceHealth(t, health, "Account Manager")
	if account.Status != "ok" {
		t.Fatalf("Account Manager status = %q, want ok; detail=%s", account.Status, account.Detail)
	}
	if account.LastCheckedAt == "" {
		t.Fatal("Account Manager last_checked_at is empty")
	}
}

func TestServiceHealthReportsVideoCloudDown(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "failed", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	srv := newSeededTestServer(t, config.Config{VideoCloudBaseURL: upstream.URL})
	health := requestJSON[[]contracts.ServiceHealth](t, srv, http.MethodGet, "/api/service-health", nil)

	video := findServiceHealth(t, health, "Video Cloud")
	if video.Status != "down" {
		t.Fatalf("Video Cloud status = %q, want down", video.Status)
	}
	if !strings.Contains(video.Detail, "status 500") {
		t.Fatalf("Video Cloud detail = %q, want status 500", video.Detail)
	}
}
func TestCustomerLoginRefreshesAndProxyMode(t *testing.T) {
	t.Parallel()

	var refreshCalls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"expired-access","refresh_token":"refresh-1","expires_in":3600}}`))
		case "/v1/me":
			switch r.Header.Get("Authorization") {
			case "Bearer expired-access":
				http.Error(w, "expired", http.StatusUnauthorized)
			case "Bearer refreshed-access":
				_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
			default:
				http.Error(w, fmt.Sprintf("unexpected bearer token %q", r.Header.Get("Authorization")), http.StatusUnauthorized)
			}
		case "/v1/auth/refresh":
			refreshCalls++
			if refreshCalls > 1 {
				t.Fatalf("unexpected extra refresh call")
			}
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"refreshed-access","refresh_token":"refresh-2","expires_in":1800}}`))
		case "/v1/orgs":
			if r.Header.Get("Authorization") != "Bearer refreshed-access" {
				http.Error(w, "unexpected bearer token", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"offline","metadata":{"video_cloud_devid":"device-2"}}]}`))
		case "/v1/orgs/org-up/devices/dev-up/provision":
			fallthrough
		case "/v1/orgs/org-up/devices/dev-002/provision":
			_, _ = w.Write([]byte(`{"operation":{"id":"op-up","state":"published","message":"accepted"}}`))
		case "/v1/orgs/org-up/devices/dev-up/deactivate":
			fallthrough
		case "/v1/orgs/org-up/devices/dev-002/deactivate":
			if r.Header.Get("Authorization") != "Bearer refreshed-access" {
				http.Error(w, "unexpected bearer token", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"operation":{"id":"op-down","state":"published","message":"accepted"}}`))
		default:
			t.Fatalf("unexpected request path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	if len(login.Result().Cookies()) != 1 {
		t.Fatalf("login did not set cookie")
	}
	cookie := login.Result().Cookies()[0]

	session, err := st.GetSession(cookie.Value)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if session.AccessToken != "refreshed-access" || session.RefreshToken != "refresh-2" {
		t.Fatalf("session tokens = %#v, want refreshed tokens", session)
	}
	if session.ActiveOrgID != "org-up" {
		t.Fatalf("session active org = %q, want org-up", session.ActiveOrgID)
	}

	me := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(me, req)
	if me.Code != http.StatusOK {
		t.Fatalf("me status = %d, body=%s", me.Code, me.Body.String())
	}
	if !strings.Contains(me.Body.String(), "user@example.com") || !strings.Contains(me.Body.String(), "org-up") {
		t.Fatalf("me body should include upstream profile and membership: %s", me.Body.String())
	}

	switchOrg := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/me/active-org", strings.NewReader(`{"organization_id":"org-bad"}`))
	req.AddCookie(cookie)
	srv.ServeHTTP(switchOrg, req)
	if switchOrg.Code != http.StatusForbidden {
		t.Fatalf("switch org status = %d, body=%s", switchOrg.Code, switchOrg.Body.String())
	}

	validSwitch := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/me/active-org", strings.NewReader(`{"organization_id":"org-up"}`))
	req.AddCookie(cookie)
	srv.ServeHTTP(validSwitch, req)
	if validSwitch.Code != http.StatusOK {
		t.Fatalf("valid switch status = %d, body=%s", validSwitch.Code, validSwitch.Body.String())
	}

	devices := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(devices, req)
	if devices.Code != http.StatusOK {
		t.Fatalf("devices status = %d, body=%s", devices.Code, devices.Body.String())
	}
	if !strings.Contains(devices.Body.String(), "dev-002") || strings.Contains(devices.Body.String(), "cam-a-001") {
		t.Fatalf("devices should use upstream projection, got %s", devices.Body.String())
	}
	if !strings.Contains(devices.Body.String(), "source_facts") {
		t.Fatalf("devices response does not include source_facts: %s", devices.Body.String())
	}
	var projectedDevices []contracts.Device
	if err := json.NewDecoder(devices.Body).Decode(&projectedDevices); err != nil {
		t.Fatalf("decode devices response: %v", err)
	}
	if len(projectedDevices) != 1 {
		t.Fatalf("devices length = %d, want 1", len(projectedDevices))
	}
	if projectedDevices[0].FirmwareVersion != "v1.2.2" {
		t.Fatalf("projected firmware_version = %q, want v1.2.2", projectedDevices[0].FirmwareVersion)
	}

	provision := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(provision, req)
	if provision.Code != http.StatusOK {
		t.Fatalf("provision status = %d, body=%s", provision.Code, provision.Body.String())
	}
	if !strings.Contains(provision.Body.String(), "op-up") {
		t.Fatalf("provision body = %s", provision.Body.String())
	}

	deactivate := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/deactivate", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(deactivate, req)
	if deactivate.Code != http.StatusOK {
		t.Fatalf("deactivate status = %d, body=%s", deactivate.Code, deactivate.Body.String())
	}
}

func TestCustomerDevicesReportVideoCloudActivationFailures(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs/org-acme/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"}]}`))
		default:
			t.Fatalf("unexpected account path: %s", r.URL.Path)
		}
	}))
	defer accountUpstream.Close()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/query_camera_activate" {
			http.Error(w, "activation gateway down", http.StatusInternalServerError)
			return
		}
		t.Fatalf("unexpected video path: %s", r.URL.Path)
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL:              accountUpstream.URL,
			LegacyCustomerPasswordLoginEnabled: true,
			VideoCloudBaseURL:                  videoUpstream.URL,
			VideoCloudAdminToken:               "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"customer@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]

	devices := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(devices, req)
	if devices.Code != http.StatusBadGateway {
		t.Fatalf("devices status = %d, body=%s", devices.Code, devices.Body.String())
	}
	if !strings.Contains(devices.Body.String(), "Video Cloud request failed") {
		t.Fatalf("devices body = %s", devices.Body.String())
	}
}

func TestCustomerLoginSurvivesProfileRetryFailure(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"expired-access","refresh_token":"refresh-1","expires_in":3600}}`))
		case "/v1/me":
			switch r.Header.Get("Authorization") {
			case "Bearer expired-access":
				http.Error(w, "expired", http.StatusUnauthorized)
			case "Bearer refreshed-access":
				http.Error(w, "profile unavailable", http.StatusInternalServerError)
			default:
				http.Error(w, fmt.Sprintf("unexpected bearer token %q", r.Header.Get("Authorization")), http.StatusUnauthorized)
			}
		case "/v1/auth/refresh":
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"refreshed-access","refresh_token":"refresh-2","expires_in":1800}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	if len(login.Result().Cookies()) != 1 {
		t.Fatalf("login did not set cookie")
	}

	session, err := st.GetSession(login.Result().Cookies()[0].Value)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if session.AccessToken != "refreshed-access" || session.RefreshToken != "refresh-2" {
		t.Fatalf("session tokens = %#v, want refreshed tokens", session)
	}
	if session.ActiveOrgID != "" {
		t.Fatalf("session active org = %q, want empty", session.ActiveOrgID)
	}
}

func TestCustomerSessionInvalidRefreshClearsStoredSession(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			if r.Header.Get("Authorization") == "Bearer expired-access" {
				http.Error(w, "expired", http.StatusUnauthorized)
				return
			}
			http.NotFound(w, r)
		case "/v1/auth/refresh":
			http.Error(w, "refresh expired", http.StatusUnauthorized)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "user@example.com", "expired-access", "refresh-1", "org-up", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("me status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if _, err := st.GetSession(session.ID); err != sql.ErrNoRows {
		t.Fatalf("session should be cleared, got %v", err)
	}
}

func TestDevicesEndpointIncludesFirmwareVersion(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	devices := requestJSON[[]contracts.Device](t, srv, http.MethodGet, "/api/devices", nil)
	if len(devices) == 0 {
		t.Fatal("devices response is empty")
	}
	if devices[0].FirmwareVersion == "" {
		t.Fatalf("device %q firmware_version is empty", devices[0].ID)
	}
	if devices[0].FirmwareVersion != "v1.2.1" {
		t.Fatalf("device %q firmware_version = %q, want v1.2.1", devices[0].ID, devices[0].FirmwareVersion)
	}
	if devices[0].Health == "" {
		t.Fatalf("device %q health is empty", devices[0].ID)
	}
	if devices[0].SignalQuality == "" {
		t.Fatalf("device %q signal_quality is empty", devices[0].ID)
	}
}

func TestCustomerDevicesInvalidSessionRefreshClearsStoredSession(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			if r.Header.Get("Authorization") == "Bearer expired-access" {
				http.Error(w, "expired", http.StatusUnauthorized)
				return
			}
			http.NotFound(w, r)
		case "/v1/auth/refresh":
			http.Error(w, "refresh expired", http.StatusUnauthorized)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "user@example.com", "expired-access", "refresh-1", "org-up", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("devices status = %d, body=%s", rec.Code, rec.Body.String())
	}

	if _, err := st.GetSession(session.ID); err != sql.ErrNoRows {
		t.Fatalf("session should be cleared, got %v", err)
	}
}

func TestCustomerMePersistsRotatedTokensOnRetryFailure(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			switch r.Header.Get("Authorization") {
			case "Bearer expired-access":
				http.Error(w, "expired", http.StatusUnauthorized)
			case "Bearer refreshed-access":
				http.Error(w, "profile unavailable", http.StatusInternalServerError)
			default:
				http.Error(w, fmt.Sprintf("unexpected bearer token %q", r.Header.Get("Authorization")), http.StatusUnauthorized)
			}
		case "/v1/auth/refresh":
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"refreshed-access","refresh_token":"refresh-2","expires_in":1800}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "user@example.com", "expired-access", "refresh-1", "org-up", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("me status = %d, body=%s", rec.Code, rec.Body.String())
	}

	updated, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if updated.AccessToken != "refreshed-access" || updated.RefreshToken != "refresh-2" {
		t.Fatalf("session tokens = %#v, want refreshed tokens", updated)
	}
}

func TestCustomerLoginMapsUpstreamFailures(t *testing.T) {
	t.Parallel()

	t.Run("unauthorized", func(t *testing.T) {
		t.Parallel()

		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
		}))
		defer upstream.Close()

		st, err := store.Open(t.TempDir() + "/admin.db")
		if err != nil {
			t.Fatalf("Open returned error: %v", err)
		}
		defer st.Close()
		if err := st.Migrate(); err != nil {
			t.Fatalf("Migrate returned error: %v", err)
		}
		srv := NewWithOptions(st, Options{
			Config:        legacyCustomerLoginConfig(upstream.URL),
			AccountClient: accountclient.New(upstream.URL),
		})

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`))
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("login status = %d, body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("server error", func(t *testing.T) {
		t.Parallel()

		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "upstream failure", http.StatusInternalServerError)
		}))
		defer upstream.Close()

		st, err := store.Open(t.TempDir() + "/admin.db")
		if err != nil {
			t.Fatalf("Open returned error: %v", err)
		}
		defer st.Close()
		if err := st.Migrate(); err != nil {
			t.Fatalf("Migrate returned error: %v", err)
		}
		srv := NewWithOptions(st, Options{
			Config:        legacyCustomerLoginConfig(upstream.URL),
			AccountClient: accountclient.New(upstream.URL),
		})

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`))
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("login status = %d, body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "Account Manager request failed") {
			t.Fatalf("login body = %s", rec.Body.String())
		}
	})

	t.Run("timeout", func(t *testing.T) {
		t.Parallel()

		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(200 * time.Millisecond)
			_, _ = w.Write([]byte("too slow"))
		}))
		defer upstream.Close()

		st, err := store.Open(t.TempDir() + "/admin.db")
		if err != nil {
			t.Fatalf("Open returned error: %v", err)
		}
		defer st.Close()
		if err := st.Migrate(); err != nil {
			t.Fatalf("Migrate returned error: %v", err)
		}
		srv := NewWithOptions(st, Options{
			Config:        legacyCustomerLoginConfig(upstream.URL),
			AccountClient: accountclient.NewWithHTTPClient(upstream.URL, &http.Client{Timeout: 40 * time.Millisecond}),
		})

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`))
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusGatewayTimeout {
			t.Fatalf("login status = %d, body=%s", rec.Code, rec.Body.String())
		}
	})
}

func TestCustomerDevicesRefreshesExpiredAccessAndRejectsInvalidActiveOrg(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			switch r.Header.Get("Authorization") {
			case "Bearer access":
				http.Error(w, "expired", http.StatusUnauthorized)
			case "Bearer refreshed-access":
				_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
			default:
				http.Error(w, fmt.Sprintf("unexpected bearer token %q", r.Header.Get("Authorization")), http.StatusUnauthorized)
			}
		case "/v1/auth/refresh":
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"refreshed-access","refresh_token":"refresh-2","expires_in":1800}}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-up","name":"cam-up","readiness":"activated","status":"offline","metadata":{"video_cloud_devid":"device-up"}}]}`))
		default:
			http.Error(w, "unexpected request", http.StatusNotFound)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "user@example.com", "access", "refresh", "org-up", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	reqCookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}

	devices := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(reqCookie)
	srv.ServeHTTP(devices, req)
	if devices.Code != http.StatusOK {
		t.Fatalf("devices status = %d, body=%s", devices.Code, devices.Body.String())
	}
	updated, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if updated.AccessToken != "refreshed-access" || updated.RefreshToken != "refresh-2" {
		t.Fatalf("session tokens = %#v, want refreshed tokens", updated)
	}

	badOrgSession, err := st.CreateSession("customer", "u1", "user@example.com", "access", "refresh-2", "org-bad", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	bad := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: badOrgSession.ID})
	srv.ServeHTTP(bad, req)
	if bad.Code != http.StatusForbidden {
		t.Fatalf("bad active org status = %d, body=%s", bad.Code, bad.Body.String())
	}
}

func TestCustomerUpstreamErrorsMapDeterministically(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			http.Error(w, "upstream failure", http.StatusInternalServerError)
		case "/v1/orgs/org-up/devices/dev-up/provision":
			time.Sleep(200 * time.Millisecond)
			_, _ = w.Write([]byte(`{"operation":{"id":"op-up","state":"published","message":"accepted"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.NewWithHTTPClient(upstream.URL, &http.Client{Timeout: 50 * time.Millisecond}),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]

	devices := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(devices, req)
	if devices.Code != http.StatusBadGateway {
		t.Fatalf("devices status = %d, body=%s", devices.Code, devices.Body.String())
	}

	provision := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-up/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(provision, req)
	if provision.Code != http.StatusGatewayTimeout {
		t.Fatalf("provision status = %d, body=%s", provision.Code, provision.Body.String())
	}
}

func TestDeviceAPIIncludesSourceFacts(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/devices/dev-004", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("device status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "\"source_facts\"") {
		t.Fatalf("device body does not include source_facts: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "\"failed\"") {
		t.Fatalf("device body does not include failed source fact: %s", rec.Body.String())
	}

	var device contracts.Device
	if err := json.NewDecoder(rec.Body).Decode(&device); err != nil {
		t.Fatalf("decode device: %v", err)
	}
	if device.ID == "" || device.Name == "" || device.SerialNumber == "" || device.Model == "" || device.OrganizationID == "" || device.Organization == "" {
		t.Fatalf("device identity is incomplete: %#v", device)
	}
	if device.Readiness == "" || device.FirmwareVersion == "" || device.LastSeenAt == "" || device.UpdatedAt == "" {
		t.Fatalf("device runtime fields are incomplete: %#v", device)
	}
	if device.Health == "" || device.SignalQuality == "" {
		t.Fatalf("device health/signal fields are incomplete: %#v", device)
	}
	if len(device.SourceFacts) == 0 {
		t.Fatalf("device source_facts is empty: %#v", device)
	}
	for _, fact := range device.SourceFacts {
		if fact.Layer == "" || fact.State == "" || fact.Detail == "" || fact.UpdatedAt == "" {
			t.Fatalf("source fact is incomplete: %#v", fact)
		}
	}
}

func TestCustomerDeviceDetailRejectsOutOfOrgDevice(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "user@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := New(st)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-003", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("out-of-org device status = %d, want %d; body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestDeviceTelemetryAPIRequiresCustomerSession(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/devices/dev-001/telemetry", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("telemetry status = %d, want %d; body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestDeviceTelemetryDemoReturns404ForOutOfOrgDevice(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-003/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("out-of-org telemetry status = %d, want %d; body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestDeviceTelemetryDemoPayload(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-001/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("telemetry status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "video_cloud_devid") {
		t.Fatalf("telemetry response should not expose video_cloud_devid: %s", rec.Body.String())
	}

	var payload contracts.DeviceTelemetry
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode telemetry payload: %v", err)
	}
	if payload.DeviceID != "dev-001" {
		t.Fatalf("device_id = %q, want %q", payload.DeviceID, "dev-001")
	}
	if payload.DeviceName != "cam-a-001" {
		t.Fatalf("device_name = %q, want cam-a-001", payload.DeviceName)
	}
	if payload.Organization != "Acme Smart Camera" {
		t.Fatalf("organization = %q, want Acme Smart Camera", payload.Organization)
	}
	if payload.SerialNumber != "ACME-A-001" {
		t.Fatalf("serial_number = %q, want ACME-A-001", payload.SerialNumber)
	}
	if payload.Model != "RTK-CAM-A" {
		t.Fatalf("model = %q, want RTK-CAM-A", payload.Model)
	}
	if payload.LastSeenAt == "" {
		t.Fatal("last_seen_at is empty")
	}
	if payload.Health != "healthy" && payload.Health != "warning" && payload.Health != "critical" {
		t.Fatalf("health = %q, want healthy|warning|critical", payload.Health)
	}
	if payload.TelemetryStatus != "not_configured" {
		t.Fatalf("telemetry_status = %q, want not_configured", payload.TelemetryStatus)
	}
	if payload.ActiveStreamStatus != "unavailable" {
		t.Fatalf("active_stream_status = %q, want unavailable", payload.ActiveStreamStatus)
	}
	if payload.UnavailableReason == "" {
		t.Fatalf("unavailable_reason is empty")
	}
	if len(payload.RSSI7D) != 0 || len(payload.Uptime7D) != 0 || len(payload.RecentEvents) != 0 {
		t.Fatalf("unconfigured telemetry should not include demo samples: %+v", payload)
	}
	if payload.FirmwareVersion == "" {
		t.Fatalf("firmware_version is empty")
	}
}

func TestCustomerDevicePayloadHidesPlatformFields(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	for _, path := range []string{"/api/devices", "/api/devices/dev-001"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d; body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
		}
		body := rec.Body.String()
		for _, hidden := range []string{"video_cloud_devid", "operation_id", "upstream_operation_id", "dead_lettered"} {
			if strings.Contains(body, hidden) {
				t.Fatalf("%s customer response leaked %q: %s", path, hidden, body)
			}
		}
	}
}

func TestPlatformAdminDevicePayloadKeepsPlatformFields(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := New(st)
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/devices", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin devices status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "video_cloud_devid") {
		t.Fatalf("admin devices response should keep platform fields: %s", rec.Body.String())
	}
}

func TestFleetHealthSummaryRequiresCustomerSession(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fleet/health-summary", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("fleet health summary status = %d, want %d; body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestFleetHealthSummaryDemoDefaultsTo7d(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/health-summary", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("fleet health summary status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetHealthSummary
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode fleet health summary: %v", err)
	}
	if payload.OrgID != "org-acme" {
		t.Fatalf("org_id = %q, want %q", payload.OrgID, "org-acme")
	}
	if payload.SourceStatus != "not_configured" {
		t.Fatalf("source_status = %q, want not_configured", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
	if payload.Current.Healthy+payload.Current.Warning+payload.Current.Critical+payload.Current.Unknown != 0 {
		t.Fatalf("current count sum = %d, want 0", payload.Current.Healthy+payload.Current.Warning+payload.Current.Critical+payload.Current.Unknown)
	}
	if len(payload.Trend) != 0 {
		t.Fatalf("trend length = %d, want 0", len(payload.Trend))
	}
}

func TestFleetHealthSummaryWindow30dAndOrgScope(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/health-summary?window=30d", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("fleet health summary status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetHealthSummary
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode fleet health summary: %v", err)
	}
	if payload.SourceStatus != "not_configured" {
		t.Fatalf("source_status = %q, want not_configured", payload.SourceStatus)
	}
	if len(payload.Trend) != 0 {
		t.Fatalf("trend length = %d, want 0", len(payload.Trend))
	}
}

func TestFleetHealthSummaryEmptyOrgReturnsFullWindow(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-empty", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	for _, tt := range []struct {
		name    string
		path    string
		wantLen int
	}{
		{name: "default", path: "/api/fleet/health-summary", wantLen: 7},
		{name: "30d", path: "/api/fleet/health-summary?window=30d", wantLen: 30},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d; body=%s", tt.name, rec.Code, http.StatusOK, rec.Body.String())
		}
		var payload contracts.FleetHealthSummary
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("%s decode fleet health summary: %v", tt.name, err)
		}
		if payload.SourceStatus != "not_configured" {
			t.Fatalf("%s source_status = %q, want not_configured", tt.name, payload.SourceStatus)
		}
		if len(payload.Trend) != 0 {
			t.Fatalf("%s trend length = %d, want 0", tt.name, len(payload.Trend))
		}
		if payload.OnlineRate7dPct != 0 {
			t.Fatalf("%s online_rate_7d_pct = %f, want 0", tt.name, payload.OnlineRate7dPct)
		}
		for i, point := range payload.Trend {
			if point.OnlinePct != 0 || point.WarningCount != 0 || point.CriticalCount != 0 {
				t.Fatalf("%s trend point %d = %+v, want zeroed point", tt.name, i, point)
			}
		}
	}
}

func TestFleetStreamStatsAPIRequiresCustomerSession(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestFleetStreamStatsDemoDefaultsTo7d(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if payload.OrgID != "org-acme" {
		t.Fatalf("org_id = %q, want %q", payload.OrgID, "org-acme")
	}
	if payload.Window != "7d" {
		t.Fatalf("window = %q, want %q", payload.Window, "7d")
	}
	if payload.SourceStatus != "not_configured" {
		t.Fatalf("source_status = %q, want not_configured", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
	if len(payload.Trend) != 0 {
		t.Fatalf("trend length = %d, want 0", len(payload.Trend))
	}
	if len(payload.ByMode) != 1 {
		t.Fatalf("by_mode length = %d, want only webrtc: %+v", len(payload.ByMode), payload.ByMode)
	}
	stats, ok := payload.ByMode["webrtc"]
	if !ok {
		t.Fatalf("by_mode is missing webrtc: %+v", payload.ByMode)
	}
	if stats.Requests < 0 {
		t.Fatalf("by_mode.webrtc.requests = %d, want >=0", stats.Requests)
	}
	if stats.SuccessRatePct < 0 || stats.SuccessRatePct > 100 {
		t.Fatalf("by_mode.webrtc.success_rate_pct = %f, want 0..100", stats.SuccessRatePct)
	}
	if len(payload.TrendByMode) != 0 {
		t.Fatalf("trend_by_mode length = %d, want 0", len(payload.TrendByMode))
	}
	if payload.SuccessRatePct < 0 || payload.SuccessRatePct > 100 {
		t.Fatalf("success_rate_pct = %f, want 0..100", payload.SuccessRatePct)
	}
	if payload.NeverStreamedCount < 0 {
		t.Fatalf("never_streamed_count = %d, want >=0", payload.NeverStreamedCount)
	}
	if len(payload.WorstDevices) > 10 {
		t.Fatalf("worst_devices length = %d, want <=10", len(payload.WorstDevices))
	}
	for _, dev := range payload.WorstDevices {
		if dev.ModeUsed == "" {
			t.Fatalf("worst device %q missing mode_used", dev.DeviceID)
		}
		if dev.Readiness == "" {
			t.Fatalf("worst device %q missing readiness", dev.DeviceID)
		}
		if dev.Requests > 0 && dev.LastStreamAt == "" {
			t.Fatalf("worst device %q missing last_stream_at", dev.DeviceID)
		}
	}
}

func TestFleetStreamStatsWindow30dAndOrgScope(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats?window=30d", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if payload.Window != "30d" {
		t.Fatalf("window = %q, want %q", payload.Window, "30d")
	}
	if payload.SourceStatus != "not_configured" {
		t.Fatalf("source_status = %q, want not_configured", payload.SourceStatus)
	}
	if len(payload.Trend) != 0 {
		t.Fatalf("trend length = %d, want 0", len(payload.Trend))
	}
	if len(payload.TrendByMode) != 0 {
		t.Fatalf("trend_by_mode length = %d, want 0", len(payload.TrendByMode))
	}
	for _, dev := range payload.WorstDevices {
		if dev.DeviceID == "dev-003" || dev.DeviceID == "dev-004" {
			t.Fatalf("worst_devices includes out-of-org device %q", dev.DeviceID)
		}
		if dev.ModeUsed != "webrtc" {
			t.Fatalf("worst device %q mode_used = %q, want webrtc", dev.DeviceID, dev.ModeUsed)
		}
	}
}

func TestFleetStreamStatsProxyModeUsesVideoCloudAndActiveOrg(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if got := r.Header.Get("Authorization"); got != "Bearer access" {
			t.Fatalf("%s Authorization = %q, want Bearer access", r.URL.Path, got)
		}
		switch r.URL.Path {
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{"id": "u1", "email": "customer@example.com", "name": "Customer"},
				"organizations": []map[string]any{
					{"id": "org-acme", "name": "Acme", "role": "owner"},
					{"id": "org-nova", "name": "Nova", "role": "viewer"},
				},
			})
		case "/v1/orgs/org-acme/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "dev-acme", "organization_id": "org-acme", "organization": "Acme", "name": "Acme Cam", "category": "ip_camera", "model": "RTK-CAM-A", "serial_number": "ACME-001", "video_cloud_devid": "vc-acme", "status": "online", "readiness": "online", "last_seen_at": "2026-05-11T00:00:00Z", "updated_at": "2026-05-11T00:00:00Z"},
				},
			})
		case "/v1/orgs/org-nova/devices":
			t.Fatalf("inactive organization devices endpoint should not be called")
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	var streamStatsCalls int
	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
			t.Fatalf("%s Authorization = %q, want Bearer vc-secret", r.URL.Path, got)
		}
		switch r.URL.Path {
		case "/api/fleet/stream-stats":
			streamStatsCalls++
			q := r.URL.Query()
			if q.Get("org_id") != "org-acme" || q.Get("window") != "30d" || q.Get("devices") != "vc-acme" {
				t.Fatalf("stream stats query = %s, want org_id=org-acme window=30d devices=vc-acme", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"org_id":               "org-acme",
				"window":               "30d",
				"success_rate_pct":     88.5,
				"avg_duration_seconds": 14.5,
				"active_sessions":      7,
				"never_streamed_count": 2,
				"by_mode": map[string]any{
					"webrtc": map[string]any{"requests": 16, "success_rate_pct": 88.5},
				},
				"trend": []map[string]any{
					{"date": "2026-05-11", "requests": 16, "success_rate_pct": 88.5},
				},
				"trend_by_mode": []map[string]any{
					{"mode": "webrtc", "points": []map[string]any{{"date": "2026-05-11", "requests": 16, "success_rate_pct": 88.5}}},
				},
				"worst_devices": []map[string]any{
					{"device_id": "dev-acme", "device_name": "Acme Cam", "mode_used": "webrtc", "readiness": "online", "success_rate_pct": 88.5, "requests": 16, "last_stream_at": "2026-05-11T00:00:00Z"},
				},
			})
		default:
			t.Fatalf("stream stats proxy should not call unrelated Video Cloud path: %s", r.URL.Path)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL: accountUpstream.URL,
			VideoCloudBaseURL:     videoUpstream.URL,
			VideoCloudAdminToken:  "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats?window=30d", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if payload.SuccessRatePct != 88.5 || payload.ActiveSessions != 7 || payload.ByMode["webrtc"].Requests != 16 {
		t.Fatalf("payload = %#v", payload)
	}
	if streamStatsCalls != 1 {
		t.Fatalf("stream stats calls = %d, want 1", streamStatsCalls)
	}
}

func TestFleetStreamStatsProxyFailureDoesNotFallback(t *testing.T) {
	t.Parallel()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fleet/stream-stats" {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "stream backend unavailable", http.StatusInternalServerError)
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:      config.Config{VideoCloudBaseURL: videoUpstream.URL, VideoCloudAdminToken: "vc-secret"},
		VideoClient: videoclient.New(videoUpstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if payload.SourceStatus != "unavailable" {
		t.Fatalf("source_status = %q, want unavailable", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
	if len(payload.Trend) != 0 || len(payload.WorstDevices) != 0 {
		t.Fatalf("unavailable stream source should not include partial data: %+v", payload)
	}
}

func TestFleetStreamStatsProxyTimeoutReturnsGatewayTimeout(t *testing.T) {
	t.Parallel()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fleet/stream-stats" {
			http.NotFound(w, r)
			return
		}
		time.Sleep(50 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{"org_id": "org-acme", "window": "7d"})
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:      config.Config{VideoCloudBaseURL: videoUpstream.URL, VideoCloudAdminToken: "vc-secret"},
		VideoClient: videoclient.NewWithHTTPClient(videoUpstream.URL, &http.Client{Timeout: 5 * time.Millisecond}),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if payload.SourceStatus != "unavailable" {
		t.Fatalf("source_status = %q, want unavailable", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
}

func TestFleetStreamStatsWorstDevicesSortedAsc(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/stream-stats?window=7d", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream stats status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FleetStreamStats
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode stream stats payload: %v", err)
	}
	if len(payload.WorstDevices) > 10 {
		t.Fatalf("worst_devices length = %d, want <=10", len(payload.WorstDevices))
	}
	for i := 1; i < len(payload.WorstDevices); i++ {
		if payload.WorstDevices[i-1].SuccessRatePct > payload.WorstDevices[i].SuccessRatePct {
			t.Fatalf("worst_devices not sorted asc at index %d: %f > %f", i, payload.WorstDevices[i-1].SuccessRatePct, payload.WorstDevices[i].SuccessRatePct)
		}
	}
	for _, dev := range payload.WorstDevices {
		if dev.ModeUsed != "webrtc" {
			t.Fatalf("worst device %q mode_used = %q, want webrtc", dev.DeviceID, dev.ModeUsed)
		}
	}
}

func TestFleetFirmwareDistributionRequiresCustomerSession(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("firmware distribution status = %d, want %d; body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestFleetFirmwareDistributionDemoPayload(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := New(st)
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("firmware distribution status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload contracts.FirmwareDistribution
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode firmware distribution payload: %v", err)
	}
	if payload.OrgID != "org-acme" {
		t.Fatalf("org_id = %q, want org-acme", payload.OrgID)
	}
	if payload.SourceStatus != "not_configured" {
		t.Fatalf("source_status = %q, want not_configured", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
	if len(payload.Versions) != 0 || len(payload.Campaigns) != 0 {
		t.Fatalf("unconfigured firmware source should not include demo data: %+v", payload)
	}
}

func TestFleetFirmwareDistributionProxyMode(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs/org-acme/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"},{"id":"dev-001","name":"cam-a-001","model":"RTK-CAM-A","serial_number":"ACME-A-001","readiness":"online","status":"online","video_cloud_devid":"device-1"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/query_camera_activate":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("query activation Authorization = %q, want Bearer vc-secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"devices": []string{"1", "1"},
			})
		case "/get_camera_info":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("camera info Authorization = %q, want Bearer vc-secret", got)
			}
			var body struct {
				DevID string `json:"devid"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode camera info body: %v", err)
			}
			version := "v1.2.4"
			if body.DevID == "device-1" {
				version = "v1.2.3"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"info": map[string]any{
					"firmware_version":  version,
					"current_transport": "websocket",
				},
			})
		case "/enum_firmware":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("enum firmware Authorization = %q, want Bearer vc-secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":   "ok",
				"versions": []string{"v1.2.3", "v1.2.4"},
			})
		case "/query_firmware_rollout":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("query rollout Authorization = %q, want Bearer vc-secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"model":  "RTK-CAM-A",
				"rollouts": []map[string]any{
					{
						"device_id":       "device-2",
						"device_name":     "cam-a-002",
						"campaign_id":     "campaign-2026-04",
						"target_version":  "v1.2.4",
						"current_version": "v1.2.4",
						"rollout_status":  "applied",
						"updated_at":      "2026-04-01T00:00:00Z",
					},
					{
						"device_id":       "device-1",
						"device_name":     "cam-a-001",
						"campaign_id":     "campaign-2026-04",
						"target_version":  "v1.2.4",
						"current_version": "v1.2.3",
						"rollout_status":  "pending",
						"reason":          "waiting for maintenance window",
						"updated_at":      "2026-04-01T01:00:00Z",
					},
				},
			})
		case "/query_firmware_campaign":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("query campaign Authorization = %q, want Bearer vc-secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"campaigns": []map[string]any{
					{
						"id":             "campaign-2026-04",
						"model":          "RTK-CAM-A",
						"target_version": "v1.2.4",
						"policy":         map[string]any{"name": "normal"},
						"state":          "active",
						"created_at":     "2026-04-01T00:00:00Z",
						"updated_at":     "2026-04-01T00:00:00Z",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL:              accountUpstream.URL,
			LegacyCustomerPasswordLoginEnabled: true,
			VideoCloudBaseURL:                  videoUpstream.URL,
			VideoCloudAdminToken:               "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("firmware distribution status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload contracts.FirmwareDistribution
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode firmware distribution payload: %v", err)
	}
	if payload.OrgID != "org-acme" {
		t.Fatalf("org_id = %q, want org-acme", payload.OrgID)
	}
	if len(payload.Versions) != 2 {
		t.Fatalf("versions length = %d, want 2", len(payload.Versions))
	}
	if payload.Versions[0].Version != "v1.2.4" || !payload.Versions[0].IsLatest {
		t.Fatalf("first version = %+v, want latest v1.2.4", payload.Versions[0])
	}
	if len(payload.Campaigns) != 1 {
		t.Fatalf("campaigns length = %d, want 1", len(payload.Campaigns))
	}
	campaign := payload.Campaigns[0]
	if campaign.Applied != 1 || campaign.Pending != 1 || campaign.Total != 2 {
		t.Fatalf("campaign summary = %+v, want applied=1 pending=1 total=2", campaign)
	}
	if len(campaign.Rollouts) != 2 {
		t.Fatalf("campaign rollouts length = %d, want 2", len(campaign.Rollouts))
	}
	foundPending := false
	for _, rollout := range campaign.Rollouts {
		if rollout.DeviceID == "device-1" {
			foundPending = rollout.RolloutStatus == "pending" && rollout.FailureReason == "waiting for maintenance window"
		}
	}
	if !foundPending {
		t.Fatalf("pending rollout not summarized correctly: %+v", campaign.Rollouts)
	}
}

func TestFleetFirmwareDistributionProxyModeUsesAlternateRolloutKeys(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs/org-acme/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"},{"id":"dev-001","name":"cam-a-001","model":"RTK-CAM-A","serial_number":"ACME-A-001","readiness":"online","status":"online","video_cloud_devid":"device-1"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/query_camera_activate":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"devices": []string{"1", "1"},
			})
		case "/get_camera_info":
			var body struct {
				DevID string `json:"devid"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode camera info body: %v", err)
			}
			version := "v1.2.4"
			if body.DevID == "device-2" {
				version = "v1.2.3"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"info": map[string]any{
					"firmware_version":  version,
					"current_transport": "websocket",
				},
			})
		case "/enum_firmware":
			_, _ = w.Write([]byte(`{"status":"ok","versions":["v1.2.3","v1.2.4"],"releases":[{"version":"v1.2.3"},{"version":"v1.2.4"}]}`))
		case "/query_firmware_campaign":
			_, _ = w.Write([]byte(`{"status":"ok","campaigns":[{"campaign_id":"campaign-2026-04","model":"RTK-CAM-A","target_version":"v1.2.4","policy":{"name":"normal"},"state":"active","created_at":"2026-04-01T00:00:00Z","updated_at":"2026-04-01T00:00:00Z"}]}`))
		case "/query_firmware_rollout":
			_, _ = w.Write([]byte(`{"status":"ok","model":"RTK-CAM-A","target":"v1.2.4","rollouts":[{"account_device_id":"device-1","device_name":"cam-a-001","campaign_id":"campaign-2026-04","target_version":"v1.2.4","current_version":"v1.2.4","rollout_status":"applied","updated_at":"2026-04-01T00:00:00Z"},{"device_id":"device-2","device_name":"cam-a-002","campaign_id":"campaign-2026-04","target_version":"v1.2.4","current_version":"v1.2.3","rollout_status":"pending","updated_at":"2026-04-01T01:00:00Z"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL:              accountUpstream.URL,
			LegacyCustomerPasswordLoginEnabled: true,
			VideoCloudBaseURL:                  videoUpstream.URL,
			VideoCloudAdminToken:               "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("firmware distribution status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload contracts.FirmwareDistribution
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode firmware distribution payload: %v", err)
	}
	if len(payload.Versions) != 2 {
		t.Fatalf("versions length = %d, want 2", len(payload.Versions))
	}
	if payload.Versions[0].Version != "v1.2.4" || !payload.Versions[0].IsLatest {
		t.Fatalf("first version = %+v, want latest v1.2.4", payload.Versions[0])
	}
	if len(payload.Campaigns) != 1 {
		t.Fatalf("campaigns length = %d, want 1", len(payload.Campaigns))
	}
	campaign := payload.Campaigns[0]
	if campaign.CampaignID != "campaign-2026-04" {
		t.Fatalf("campaign id = %q, want campaign-2026-04", campaign.CampaignID)
	}
	if campaign.Applied != 1 || campaign.Pending != 1 || campaign.Total != 2 {
		t.Fatalf("campaign summary = %+v, want applied=1 pending=1 total=2", campaign)
	}
}

func TestFleetFirmwareDistributionProxyFailureReturnsSourceStatus(t *testing.T) {
	t.Parallel()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/get_camera_info":
			http.Error(w, "firmware backend unavailable", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:      config.Config{VideoCloudBaseURL: videoUpstream.URL, VideoCloudAdminToken: "vc-secret"},
		VideoClient: videoclient.New(videoUpstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/fleet/firmware-distribution", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("firmware distribution status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.FirmwareDistribution
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode firmware distribution payload: %v", err)
	}
	if payload.SourceStatus != "unavailable" {
		t.Fatalf("source_status = %q, want unavailable", payload.SourceStatus)
	}
	if payload.SourceMessage == "" {
		t.Fatalf("source_message is empty")
	}
	if len(payload.Versions) != 0 || len(payload.Campaigns) != 0 {
		t.Fatalf("unavailable firmware source should not include partial data: %+v", payload)
	}
}

func TestDeviceTelemetryProxyModeUsesVideoCloud(t *testing.T) {
	t.Parallel()

	today := time.Now().UTC().Truncate(24 * time.Hour)
	uptimeSampleDay1 := today.AddDate(0, 0, -2)
	uptimeSampleDay2 := today.AddDate(0, 0, -1)
	uptimeSampleDate1 := uptimeSampleDay1.Format("2006-01-02")
	uptimeSampleDate2 := uptimeSampleDay2.Format("2006-01-02")

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			if got := r.Header.Get("Authorization"); got != "Bearer access" {
				t.Fatalf("account Authorization = %q, want Bearer access", got)
			}
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs/org-acme/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"}]}`))
		default:
			t.Fatalf("unexpected account path: %s", r.URL.Path)
		}
	}))
	defer accountUpstream.Close()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/query_camera_activate":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("query activation Authorization = %q, want Bearer vc-secret", got)
			}
			var body struct {
				Devices []string `json:"devices"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode query activation body: %v", err)
			}
			if len(body.Devices) != 1 || body.Devices[0] != "device-2" {
				t.Fatalf("query activation devices = %+v, want [device-2]", body.Devices)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"devices": []string{"1"},
			})
		case "/api/devices/device-2/telemetry":
			if got := r.URL.Query().Get("org_id"); got != "org-acme" {
				t.Fatalf("telemetry org_id = %q, want org-acme", got)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("telemetry Authorization = %q, want Bearer vc-secret", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":            "ok",
				"org_id":            "org-acme",
				"device_id":         "device-2",
				"account_device_id": "dev-002",
				"device_name":       "cam-a-002",
				"latest_health": map[string]any{
					"state":          "warning",
					"occurred_at":    "2026-05-04T12:00:00Z",
					"uptime_seconds": 7200,
					"payload": map[string]any{
						"health":  "warning",
						"signals": []string{"low_rssi", "recent_reboot"},
					},
				},
				"rssi_history": []map[string]any{
					{"occurred_at": uptimeSampleDay1.Add(10 * time.Hour).Format(time.RFC3339), "rssi_dbm": -68, "quality": "fair"},
					{"occurred_at": uptimeSampleDay2.Add(10 * time.Hour).Format(time.RFC3339), "rssi_dbm": -72, "quality": "fair"},
				},
				"uptime_history": []map[string]any{
					{"occurred_at": uptimeSampleDay1.Add(10 * time.Hour).Format(time.RFC3339), "uptime_seconds": 3600},
					{"occurred_at": uptimeSampleDay2.Add(10 * time.Hour).Format(time.RFC3339), "uptime_seconds": 7200},
				},
				"recent_events": []map[string]any{
					{
						"event_id":    "evt-2",
						"event_type":  "device.reboot.reported",
						"occurred_at": "2026-05-04T14:00:00Z",
						"source":      "device",
						"payload": map[string]any{
							"reason":  "watchdog",
							"summary": "Device reboot reported",
						},
					},
					{
						"event_id":    "evt-1",
						"event_type":  "device.health.rssi_sample",
						"occurred_at": "2026-05-04T13:00:00Z",
						"source":      "device",
						"payload": map[string]any{
							"rssi_dbm": -72,
							"quality":  "fair",
							"summary":  "Signal quality dropped to fair",
						},
					},
				},
			})
		case "/get_camera_info":
			if got := r.Header.Get("Authorization"); got != "Bearer vc-secret" {
				t.Fatalf("camera info Authorization = %q, want Bearer vc-secret", got)
			}
			var body struct {
				DevID string `json:"devid"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode camera info body: %v", err)
			}
			if body.DevID != "device-2" {
				t.Fatalf("camera info devid = %q, want device-2", body.DevID)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"info": map[string]any{
					"firmware_version":  "v9.8.7",
					"current_transport": "websocket",
				},
			})
		default:
			t.Fatalf("unexpected video path: %s", r.URL.Path)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL:              accountUpstream.URL,
			LegacyCustomerPasswordLoginEnabled: true,
			VideoCloudBaseURL:                  videoUpstream.URL,
			VideoCloudAdminToken:               "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-002/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("proxy telemetry status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "video_cloud_devid") {
		t.Fatalf("proxy telemetry response should not expose video_cloud_devid: %s", rec.Body.String())
	}

	var payload contracts.DeviceTelemetry
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode proxy telemetry payload: %v", err)
	}
	if payload.DeviceID != "dev-002" {
		t.Fatalf("device_id = %q, want dev-002", payload.DeviceID)
	}
	if payload.DeviceName != "cam-a-002" {
		t.Fatalf("device_name = %q, want cam-a-002", payload.DeviceName)
	}
	if payload.Organization != "Acme Smart Camera" {
		t.Fatalf("organization = %q, want Acme Smart Camera", payload.Organization)
	}
	if payload.SerialNumber != "ACME-A-002" {
		t.Fatalf("serial_number = %q, want ACME-A-002", payload.SerialNumber)
	}
	if payload.Model != "RTK-CAM-A" {
		t.Fatalf("model = %q, want RTK-CAM-A", payload.Model)
	}
	if payload.LastSeenAt == "" {
		t.Fatal("last_seen_at is empty")
	}
	if payload.FirmwareVersion != "v9.8.7" {
		t.Fatalf("firmware_version = %q, want v9.8.7", payload.FirmwareVersion)
	}
	if payload.Health != "warning" {
		t.Fatalf("health = %q, want warning", payload.Health)
	}
	if len(payload.Signals) != 2 || payload.Signals[0] != "low_rssi" || payload.Signals[1] != "recent_reboot" {
		t.Fatalf("signals = %+v, want [low_rssi recent_reboot]", payload.Signals)
	}
	if len(payload.RSSI7D) != 7 || len(payload.Uptime7D) != 7 {
		t.Fatalf("sparkline lengths = rssi:%d uptime:%d, want 7", len(payload.RSSI7D), len(payload.Uptime7D))
	}
	uptimeByDate := make(map[string]float64, len(payload.Uptime7D))
	for _, sample := range payload.Uptime7D {
		if sample.OnlinePct < 0 || sample.OnlinePct > 100 {
			t.Fatalf("uptime sample %s has invalid online_pct %.1f", sample.Date, sample.OnlinePct)
		}
		uptimeByDate[sample.Date] = sample.OnlinePct
	}
	if got := uptimeByDate[uptimeSampleDate1]; got != 4.2 {
		t.Fatalf("online_pct for %s = %.1f, want 4.2", uptimeSampleDate1, got)
	}
	if got := uptimeByDate[uptimeSampleDate2]; got != 8.3 {
		t.Fatalf("online_pct for %s = %.1f, want 8.3", uptimeSampleDate2, got)
	}
	if len(payload.RecentEvents) != 2 || payload.RecentEvents[0].EventType != "device.reboot.reported" {
		t.Fatalf("recent_events = %+v", payload.RecentEvents)
	}
}

func TestDeviceTelemetryProxyModeMapsVideoCloudFailure(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
		case "/v1/orgs/org-acme/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"}]}`))
		default:
			t.Fatalf("unexpected account path: %s", r.URL.Path)
		}
	}))
	defer accountUpstream.Close()

	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/query_camera_activate":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"devices": []string{"1"},
			})
		case "/api/devices/device-2/telemetry":
			http.Error(w, "telemetry unavailable", http.StatusServiceUnavailable)
		case "/get_camera_info":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"info": map[string]any{
					"firmware_version":  "v1.2.3",
					"current_transport": "websocket",
				},
			})
		default:
			t.Fatalf("unexpected video path: %s", r.URL.Path)
		}
	}))
	defer videoUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	srv := NewWithOptions(st, Options{
		Config: config.Config{
			AccountManagerBaseURL:              accountUpstream.URL,
			LegacyCustomerPasswordLoginEnabled: true,
			VideoCloudBaseURL:                  videoUpstream.URL,
			VideoCloudAdminToken:               "vc-secret",
		},
		AccountClient: accountclient.New(accountUpstream.URL),
		VideoClient:   videoclient.New(videoUpstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-002/telemetry", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("proxy telemetry status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload contracts.DeviceTelemetry
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode telemetry payload: %v", err)
	}
	if payload.TelemetryStatus != "unavailable" {
		t.Fatalf("telemetry_status = %q, want unavailable", payload.TelemetryStatus)
	}
	if payload.ActiveStreamStatus != "unavailable" {
		t.Fatalf("active_stream_status = %q, want unavailable", payload.ActiveStreamStatus)
	}
	if payload.UnavailableReason == "" {
		t.Fatalf("unavailable_reason is empty")
	}
}

func TestDeviceTelemetryProxyModeMapsVideoCloudFailureModes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		status             int
		body               string
		wantTelemetryState string
		wantReasonContains string
	}{
		{name: "unauthorized", status: http.StatusUnauthorized, body: `{"error":"expired"}`, wantTelemetryState: "unauthorized", wantReasonContains: "authorized"},
		{name: "forbidden", status: http.StatusForbidden, body: `{"error":"denied"}`, wantTelemetryState: "unauthorized", wantReasonContains: "authorized"},
		{name: "not found", status: http.StatusNotFound, body: `{"error":"missing"}`, wantTelemetryState: "unavailable", wantReasonContains: "not found"},
		{name: "gateway failure", status: http.StatusServiceUnavailable, body: `{"error":"down"}`, wantTelemetryState: "unavailable", wantReasonContains: "unavailable"},
		{name: "invalid json", status: http.StatusOK, body: `{`, wantTelemetryState: "unavailable", wantReasonContains: "unexpected"},
		{name: "empty source", status: http.StatusOK, body: `{"status":"ok","device_id":"device-2"}`, wantTelemetryState: "unavailable", wantReasonContains: "No telemetry samples"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/me":
					_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"customer@example.com","name":"Customer"},"organizations":[{"id":"org-acme","name":"Acme Smart Camera","role":"owner"}]}`))
				case "/v1/orgs/org-acme/devices":
					_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"online","video_cloud_devid":"device-2"}]}`))
				default:
					t.Fatalf("unexpected account path: %s", r.URL.Path)
				}
			}))
			defer accountUpstream.Close()

			videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/query_camera_activate":
					_ = json.NewEncoder(w).Encode(map[string]any{
						"status":  "ok",
						"devices": []string{"1"},
					})
				case "/api/devices/device-2/telemetry":
					w.WriteHeader(tt.status)
					_, _ = w.Write([]byte(tt.body))
				case "/get_camera_info":
					_ = json.NewEncoder(w).Encode(map[string]any{
						"status": "ok",
						"info": map[string]any{
							"firmware_version":  "v1.2.3",
							"current_transport": "websocket",
						},
					})
				default:
					t.Fatalf("unexpected video path: %s", r.URL.Path)
				}
			}))
			defer videoUpstream.Close()

			st, err := store.Open(t.TempDir() + "/admin.db")
			if err != nil {
				t.Fatalf("Open returned error: %v", err)
			}
			defer st.Close()
			if err := st.Migrate(); err != nil {
				t.Fatalf("Migrate returned error: %v", err)
			}
			if err := st.SeedDemoData(); err != nil {
				t.Fatalf("SeedDemoData returned error: %v", err)
			}

			srv := NewWithOptions(st, Options{
				Config: config.Config{
					AccountManagerBaseURL:              accountUpstream.URL,
					LegacyCustomerPasswordLoginEnabled: true,
					VideoCloudBaseURL:                  videoUpstream.URL,
					VideoCloudAdminToken:               "vc-secret",
				},
				AccountClient: accountclient.New(accountUpstream.URL),
				VideoClient:   videoclient.New(videoUpstream.URL),
			})
			session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "", time.Hour)
			if err != nil {
				t.Fatalf("CreateSession returned error: %v", err)
			}

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/devices/dev-002/telemetry", nil)
			req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			srv.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("proxy telemetry status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "video_cloud_devid") || strings.Contains(rec.Body.String(), "vc-secret") || strings.Contains(rec.Body.String(), "operation_id") {
				t.Fatalf("proxy telemetry response exposed sensitive/platform-only data: %s", rec.Body.String())
			}
			var payload contracts.DeviceTelemetry
			if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
				t.Fatalf("decode telemetry payload: %v", err)
			}
			if payload.TelemetryStatus != tt.wantTelemetryState {
				t.Fatalf("telemetry_status = %q, want %q; body=%s", payload.TelemetryStatus, tt.wantTelemetryState, rec.Body.String())
			}
			if !strings.Contains(payload.UnavailableReason, tt.wantReasonContains) {
				t.Fatalf("unavailable_reason = %q, want containing %q", payload.UnavailableReason, tt.wantReasonContains)
			}
		})
	}
}

func TestAdminRoutesRequirePlatformAdmin(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	if err := st.CreateAuditEvent("demo-platform-operator", "DeviceProvisionRequested", "dev-001"); err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}
	if err := st.BootstrapPlatformAdmin("admin@example.com", "secret"); err != nil {
		t.Fatalf("BootstrapPlatformAdmin returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{Config: config.Config{AdminBreakGlassEnabled: true}})

	adminPaths := []string{
		"/api/admin/summary",
		"/api/admin/customers",
		"/api/admin/devices",
		"/api/admin/operations",
		"/api/admin/service-health",
		"/api/admin/audit",
	}

	for _, path := range adminPaths {
		unauth := httptest.NewRecorder()
		srv.ServeHTTP(unauth, httptest.NewRequest(http.MethodGet, path, nil))
		if unauth.Code != http.StatusUnauthorized {
			t.Fatalf("%s without session status = %d, want %d", path, unauth.Code, http.StatusUnauthorized)
		}
	}

	customerSession, err := st.CreateSession("customer", "u2", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}

	for _, path := range adminPaths {
		blocked := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: customerSession.ID})
		srv.ServeHTTP(blocked, req)
		if blocked.Code != http.StatusForbidden {
			t.Fatalf("%s with customer session status = %d, want %d", path, blocked.Code, http.StatusForbidden)
		}
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/platform/login", strings.NewReader(`{"email":"admin@example.com","password":"secret"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("platform login status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatalf("platform login did not set session cookie")
	}

	for _, path := range adminPaths {
		admin := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(rec.Result().Cookies()[0])
		srv.ServeHTTP(admin, req)
		if admin.Code != http.StatusOK {
			t.Fatalf("%s with session status = %d, want %d", path, admin.Code, http.StatusOK)
		}
	}

	audit := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil)
	req.AddCookie(rec.Result().Cookies()[0])
	srv.ServeHTTP(audit, req)
	if !strings.Contains(audit.Body.String(), "DeviceProvisionRequested") {
		t.Fatalf("admin audit body does not contain demo audit events: %s", audit.Body.String())
	}
}

func TestPlatformAdminReadModelsIncludeDashboardFields(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession platform_admin returned error: %v", err)
	}
	srv := New(st)

	adminRequest := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d; body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
		}
		return rec
	}

	var summary contracts.Summary
	if err := json.NewDecoder(adminRequest("/api/admin/summary").Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.Customers == 0 || summary.TotalDevices == 0 {
		t.Fatalf("admin summary missing customer/device counts: %#v", summary)
	}

	var customers []contracts.CustomerSummary
	if err := json.NewDecoder(adminRequest("/api/admin/customers").Body).Decode(&customers); err != nil {
		t.Fatalf("decode customers: %v", err)
	}
	if len(customers) == 0 {
		t.Fatal("admin customers response is empty")
	}
	if customers[0].OrganizationID == "" || customers[0].Organization == "" || customers[0].TotalDevices == 0 || customers[0].LastSeenAt == "" {
		t.Fatalf("admin customer summary is incomplete: %#v", customers[0])
	}

	var devices []contracts.Device
	if err := json.NewDecoder(adminRequest("/api/admin/devices").Body).Decode(&devices); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(devices) == 0 {
		t.Fatal("admin devices response is empty")
	}
	if devices[0].OrganizationID == "" || devices[0].Organization == "" || devices[0].Readiness == "" || devices[0].FirmwareVersion == "" {
		t.Fatalf("admin device read model is incomplete: %#v", devices[0])
	}
	if devices[0].Health == "" || devices[0].SignalQuality == "" || len(devices[0].SourceFacts) == 0 {
		t.Fatalf("admin device runtime facts are incomplete: %#v", devices[0])
	}
}

func TestPlatformAdminReadModelsUseAccountManagerAdminInventory(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
			t.Fatalf("%s Authorization = %q, want Bearer admin-access", r.URL.Path, got)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/admin/orgs":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"organizations": []map[string]any{
					{"id": "org-admin", "name": "Admin Org", "role": "owner", "tier": "commercial"},
				},
			})
		case "/v1/admin/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "dev-admin", "organization_id": "org-admin", "organization": "Admin Org", "name": "Admin Camera", "category": "ip_camera", "model": "RTK-CAM-A", "serial_number": "ADMIN-001", "status": "online", "readiness": "online", "last_seen_at": "2026-05-11T00:00:00Z", "updated_at": "2026-05-11T00:00:00Z"},
				},
			})
		case "/v1/admin/operations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"operations": []map[string]any{
					{"id": "op-admin", "device_id": "dev-admin", "device_name": "Admin Camera", "organization_id": "org-admin", "organization": "Admin Org", "type": "DeviceProvisionRequested", "state": "published", "message": "queued", "updated_at": "2026-05-11T00:00:00Z"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession platform_admin returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: accountUpstream.URL},
		AccountClient: accountclient.New(accountUpstream.URL),
	})

	adminGet := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d; body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
		}
		return rec
	}

	var summary contracts.Summary
	if err := json.NewDecoder(adminGet("/api/admin/summary").Body).Decode(&summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if summary.TotalDevices != 1 || summary.Customers != 1 || summary.OpenOperations != 1 {
		t.Fatalf("summary = %#v", summary)
	}

	var customers []contracts.CustomerSummary
	if err := json.NewDecoder(adminGet("/api/admin/customers").Body).Decode(&customers); err != nil {
		t.Fatalf("decode customers: %v", err)
	}
	if len(customers) != 1 || customers[0].OrganizationID != "org-admin" || customers[0].Organization != "Admin Org" || customers[0].TotalDevices != 1 {
		t.Fatalf("customers = %#v", customers)
	}

	var devices []contracts.Device
	if err := json.NewDecoder(adminGet("/api/admin/devices").Body).Decode(&devices); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	if len(devices) != 1 || devices[0].ID != "dev-admin" || devices[0].OrganizationID != "org-admin" || devices[0].Name != "Admin Camera" {
		t.Fatalf("devices = %#v", devices)
	}

	var ops []contracts.Operation
	if err := json.NewDecoder(adminGet("/api/admin/operations").Body).Decode(&ops); err != nil {
		t.Fatalf("decode operations: %v", err)
	}
	if len(ops) != 1 || ops[0].ID != "op-admin" || ops[0].DeviceID != "dev-admin" || ops[0].Organization != "Admin Org" {
		t.Fatalf("operations = %#v", ops)
	}
}

func TestPlatformAdminBrandCloudsProxyRequiresUpstreamToken(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
			t.Fatalf("%s Authorization = %q, want Bearer admin-access", r.URL.Path, got)
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/admin/brand-clouds":
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": map[string]any{"id": "brand-1", "name": "Realtek Connect+", "organization_kind": "brand_cloud", "status": "active"}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/admin/brand-clouds":
			_ = json.NewEncoder(w).Encode(map[string]any{"brand_clouds": []map[string]any{{"id": "brand-1", "name": "Realtek Connect+", "organization_kind": "brand_cloud", "status": "active"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	upstreamSession, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession platform_admin returned error: %v", err)
	}
	breakGlassSession, err := st.CreateSession("platform_admin", "break-glass", "break@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession break-glass returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: accountUpstream.URL},
		AccountClient: accountclient.New(accountUpstream.URL),
	})

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/admin/brand-clouds", strings.NewReader(`{"name":"Realtek Connect+"}`))
	createReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: upstreamSession.ID})
	srv.ServeHTTP(create, createReq)
	if create.Code != http.StatusCreated {
		t.Fatalf("brand cloud create status = %d, want 201; body=%s", create.Code, create.Body.String())
	}

	list := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/admin/brand-clouds", nil)
	listReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: upstreamSession.ID})
	srv.ServeHTTP(list, listReq)
	if list.Code != http.StatusOK {
		t.Fatalf("brand cloud list status = %d, want 200; body=%s", list.Code, list.Body.String())
	}

	blocked := httptest.NewRecorder()
	blockedReq := httptest.NewRequest(http.MethodPost, "/api/admin/brand-clouds", strings.NewReader(`{"name":"Blocked"}`))
	blockedReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: breakGlassSession.ID})
	srv.ServeHTTP(blocked, blockedReq)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("break-glass brand cloud create status = %d, want 403; body=%s", blocked.Code, blocked.Body.String())
	}
}

func TestPlatformAdminReadModelsSurfaceUpstreamFailure(t *testing.T) {
	t.Parallel()

	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
			t.Fatalf("%s Authorization = %q, want Bearer admin-access", r.URL.Path, got)
		}
		switch r.URL.Path {
		case "/v1/admin/orgs":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"organizations": []map[string]any{{"id": "org-admin", "name": "Admin Org"}},
			})
		case "/v1/admin/devices":
			http.Error(w, "inventory unavailable", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer accountUpstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession platform_admin returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: accountUpstream.URL},
		AccountClient: accountclient.New(accountUpstream.URL),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/devices", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("admin devices status = %d, want %d; body=%s", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Account Manager request failed") {
		t.Fatalf("admin devices body = %s", rec.Body.String())
	}
}

func TestMeContractStabilizesMembershipShape(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	customerSession, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	adminSession, err := st.CreateSession("platform_admin", "admin", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession platform_admin returned error: %v", err)
	}
	srv := New(st)

	checkMe := func(cookie *http.Cookie, wantAuthenticated bool) contracts.Me {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("/api/me status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatalf("decode raw /api/me: %v", err)
		}
		if _, ok := raw["memberships"]; !ok {
			t.Fatalf("/api/me missing memberships: %s", rec.Body.String())
		}
		if len(raw["memberships"]) == 0 || raw["memberships"][0] != '[' {
			t.Fatalf("/api/me memberships must be an array: %s", rec.Body.String())
		}
		var me contracts.Me
		if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
			t.Fatalf("decode /api/me: %v", err)
		}
		if me.Authenticated != wantAuthenticated {
			t.Fatalf("authenticated = %v, want %v in %#v", me.Authenticated, wantAuthenticated, me)
		}
		return me
	}

	demo := checkMe(nil, false)
	if demo.UserID == "" || demo.Email == "" || demo.Name == "" || demo.Kind == "" || demo.ActiveOrgID == "" || len(demo.Memberships) == 0 {
		t.Fatalf("unauthenticated demo me is incomplete: %#v", demo)
	}
	if demo.Memberships[0].OrganizationID == "" || demo.Memberships[0].Organization == "" || demo.Memberships[0].Role == "" || demo.Memberships[0].Tier == "" || demo.Memberships[0].EvaluationDeviceQuota == 0 {
		t.Fatalf("demo membership is incomplete: %#v", demo.Memberships[0])
	}

	customer := checkMe(&http.Cookie{Name: "rtk_admin_session", Value: customerSession.ID}, true)
	if customer.ActiveOrgID != "org-acme" || len(customer.Memberships) == 0 {
		t.Fatalf("customer me contract is incomplete: %#v", customer)
	}

	admin := checkMe(&http.Cookie{Name: "rtk_admin_session", Value: adminSession.ID}, true)
	if admin.Kind != "platform_admin" || admin.Memberships == nil {
		t.Fatalf("platform admin me contract is incomplete: %#v", admin)
	}
}

func TestActiveOrgAndQuotaContractsRejectInvalidOrganizations(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "customer@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	srv := New(st)

	switchRec := httptest.NewRecorder()
	switchReq := httptest.NewRequest(http.MethodPost, "/api/me/active-org", strings.NewReader(`{"organization_id":"org-nova"}`))
	switchReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(switchRec, switchReq)
	if switchRec.Code != http.StatusOK {
		t.Fatalf("active-org valid switch status = %d, want %d; body=%s", switchRec.Code, http.StatusOK, switchRec.Body.String())
	}

	blockedSwitch := httptest.NewRecorder()
	blockedReq := httptest.NewRequest(http.MethodPost, "/api/me/active-org", strings.NewReader(`{"organization_id":"org-missing"}`))
	blockedReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	srv.ServeHTTP(blockedSwitch, blockedReq)
	if blockedSwitch.Code != http.StatusForbidden {
		t.Fatalf("active-org invalid switch status = %d, want %d; body=%s", blockedSwitch.Code, http.StatusForbidden, blockedSwitch.Body.String())
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/orgs/org-nova/quota-raise-requests" {
			http.Error(w, "upstream unavailable", http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()
	proxySrv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	wrongOrg := httptest.NewRecorder()
	wrongOrgReq := httptest.NewRequest(http.MethodPost, "/api/orgs/org-acme/quota-raise-requests", strings.NewReader(`{"requested_quota":10}`))
	wrongOrgReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	proxySrv.ServeHTTP(wrongOrg, wrongOrgReq)
	if wrongOrg.Code != http.StatusForbidden {
		t.Fatalf("quota wrong org status = %d, want %d; body=%s", wrongOrg.Code, http.StatusForbidden, wrongOrg.Body.String())
	}

	upstreamFailure := httptest.NewRecorder()
	upstreamReq := httptest.NewRequest(http.MethodPost, "/api/orgs/org-nova/quota-raise-requests", strings.NewReader(`{"requested_quota":10}`))
	upstreamReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	proxySrv.ServeHTTP(upstreamFailure, upstreamReq)
	if upstreamFailure.Code != http.StatusBadGateway {
		t.Fatalf("quota upstream failure status = %d, want %d; body=%s", upstreamFailure.Code, http.StatusBadGateway, upstreamFailure.Body.String())
	}
	if !strings.Contains(upstreamFailure.Body.String(), "Account Manager request failed") {
		t.Fatalf("quota upstream failure body = %s", upstreamFailure.Body.String())
	}
}

func newSeededTestServer(t *testing.T, cfg config.Config) *Server {
	t.Helper()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	return NewWithOptions(st, Options{Config: cfg})
}

func requestJSON[T any](t *testing.T, srv *Server, method string, path string, body io.Reader) T {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(method, path, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("%s %s status = %d, want %d; body=%s", method, path, rec.Code, http.StatusOK, rec.Body.String())
	}
	var out T
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode %s %s: %v", method, path, err)
	}
	return out
}

func findServiceHealth(t *testing.T, health []contracts.ServiceHealth, name string) contracts.ServiceHealth {
	t.Helper()

	for _, item := range health {
		if item.Name == name {
			return item
		}
	}
	t.Fatalf("service health %q not found in %#v", name, health)
	return contracts.ServiceHealth{}
}

func TestCustomerUpstreamLifecycleIsIdempotentAndDurable(t *testing.T) {
	t.Parallel()

	callCount := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"offline","metadata":{"video_cloud_devid":"device-2"}}]}`))
		case "/v1/orgs/org-up/devices/dev-up/provision":
			fallthrough
		case "/v1/orgs/org-up/devices/dev-002/provision":
			callCount++
			_, _ = w.Write([]byte(`{"operation":{"id":"op-up","state":"published","message":"accepted"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]

	first := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(first, req)
	if first.Code != http.StatusOK {
		t.Fatalf("first provision status = %d, body=%s", first.Code, first.Body.String())
	}

	second := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(second, req)
	if second.Code != http.StatusOK {
		t.Fatalf("second provision status = %d, body=%s", second.Code, second.Body.String())
	}
	if callCount != 1 {
		t.Fatalf("provision upstream call count = %d, want 1", callCount)
	}

	var firstOp contracts.Operation
	if err := json.NewDecoder(first.Body).Decode(&firstOp); err != nil {
		t.Fatalf("decode first op: %v", err)
	}
	var secondOp contracts.Operation
	if err := json.NewDecoder(second.Body).Decode(&secondOp); err != nil {
		t.Fatalf("decode second op: %v", err)
	}
	if firstOp.UpstreamOperationID != "op-up" {
		t.Fatalf("first upstream id = %q, want op-up", firstOp.UpstreamOperationID)
	}
	if secondOp.ID != firstOp.ID {
		t.Fatalf("expected idempotent operation id=%q, got %q", firstOp.ID, secondOp.ID)
	}

	ops := httptest.NewRecorder()
	srv.ServeHTTP(ops, httptest.NewRequest(http.MethodGet, "/api/operations", nil))
	var list []contracts.Operation
	if err := json.NewDecoder(ops.Body).Decode(&list); err != nil {
		t.Fatalf("decode operations: %v", err)
	}
	if len(list) == 0 {
		t.Fatalf("operations list should not be empty")
	}
}

func TestCustomerReadOnlyObserverLifecycleReturns403(t *testing.T) {
	t.Parallel()

	upstreamProvisionCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"observer@example.com","name":"Observer"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"observer"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"observer"}]}`))
		case "/v1/orgs/org-up/devices/dev-002/provision", "/v1/orgs/org-up/devices/dev-002/deactivate":
			upstreamProvisionCalls++
			_, _ = w.Write([]byte(`{"operation":{"id":"op-up","state":"published","message":"accepted"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})
	session, err := st.CreateSession("customer", "u1", "observer@example.com", "access", "refresh", "org-up", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	for _, path := range []string{"/api/devices/dev-002/provision", "/api/devices/dev-002/deactivate"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s status = %d, want %d; body=%s", path, rec.Code, http.StatusForbidden, rec.Body.String())
		}
	}
	if upstreamProvisionCalls != 0 {
		t.Fatalf("read-only lifecycle should not call upstream, got %d calls", upstreamProvisionCalls)
	}
}

func TestDeactivateDoesNotReturnOpenProvisionOperation(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"offline"}]}`))
		case "/v1/orgs/org-up/devices/dev-002/provision":
			_, _ = w.Write([]byte(`{"operation":{"id":"op-prov","state":"published","message":"accepted"}}`))
		case "/v1/orgs/org-up/devices/dev-002/deactivate":
			_, _ = w.Write([]byte(`{"operation":{"id":"op-deact","state":"published","message":"deactivation accepted"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]

	provision := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(provision, req)
	if provision.Code != http.StatusOK {
		t.Fatalf("provision status = %d, body=%s", provision.Code, provision.Body.String())
	}
	if !strings.Contains(provision.Body.String(), "op-prov") {
		t.Fatalf("provision body missing op-prov: %s", provision.Body.String())
	}

	deactivate := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/deactivate", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(deactivate, req)
	if deactivate.Code != http.StatusOK {
		t.Fatalf("deactivate status = %d, body=%s", deactivate.Code, deactivate.Body.String())
	}
	if strings.Contains(deactivate.Body.String(), "op-prov") {
		t.Fatalf("deactivate returned provision operation instead of deactivate operation: %s", deactivate.Body.String())
	}
	if !strings.Contains(deactivate.Body.String(), "op-deact") {
		t.Fatalf("deactivate body missing op-deact: %s", deactivate.Body.String())
	}
}

func TestCustomerUpstreamLifecycleFailurePersistsFailedOperation(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-002","name":"cam-a-002","model":"RTK-CAM-A","serial_number":"ACME-A-002","readiness":"activated","status":"offline","metadata":{"video_cloud_devid":"device-2"}}]}`))
		case "/v1/orgs/org-up/devices/dev-up/provision":
			fallthrough
		case "/v1/orgs/org-up/devices/dev-002/provision":
			http.Error(w, "downstream failure", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{
		Config:        legacyCustomerLoginConfig(upstream.URL),
		AccountClient: accountclient.New(upstream.URL),
	})

	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"user@example.com","password":"secret"}`)))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]

	provision := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devices/dev-002/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(provision, req)
	if provision.Code != http.StatusBadGateway {
		t.Fatalf("provision status = %d, body=%s", provision.Code, provision.Body.String())
	}

	ops := httptest.NewRecorder()
	srv.ServeHTTP(ops, httptest.NewRequest(http.MethodGet, "/api/operations", nil))
	var operations []contracts.Operation
	if err := json.NewDecoder(ops.Body).Decode(&operations); err != nil {
		t.Fatalf("decode operations: %v", err)
	}
	hasFailed := false
	for _, op := range operations {
		if op.Type == "DeviceProvisionRequested" && op.State == contracts.OperationFailed {
			hasFailed = true
		}
	}
	if !hasFailed {
		t.Fatalf("expected failed operation projection after upstream failure")
	}

	audit := httptest.NewRecorder()
	srv.ServeHTTP(audit, httptest.NewRequest(http.MethodGet, "/api/audit", nil))
	var events []contracts.AuditEvent
	if err := json.NewDecoder(audit.Body).Decode(&events); err != nil {
		t.Fatalf("decode audit events: %v", err)
	}
	hasFailedAudit := false
	for _, event := range events {
		if event.Action == "DeviceProvisionRequested.failed" {
			hasFailedAudit = true
		}
	}
	if !hasFailedAudit {
		t.Fatalf("expected DeviceProvisionRequested.failed audit event")
	}

}

func TestPlatformAdminLogin(t *testing.T) {
	t.Parallel()

	st, err := store.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.BootstrapPlatformAdmin("admin@example.com", "secret"); err != nil {
		t.Fatalf("BootstrapPlatformAdmin returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{Config: config.Config{AdminBreakGlassEnabled: true}})
	blocked := httptest.NewRecorder()
	srv.ServeHTTP(blocked, httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil))
	if blocked.Code != http.StatusUnauthorized {
		t.Fatalf("admin audit without session status = %d, want %d", blocked.Code, http.StatusUnauthorized)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/platform/login", strings.NewReader(`{"email":"admin@example.com","password":"secret"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("platform login status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatalf("platform login did not set session cookie")
	}
	audit := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil)
	req.AddCookie(rec.Result().Cookies()[0])
	srv.ServeHTTP(audit, req)
	if audit.Code != http.StatusOK {
		t.Fatalf("admin audit with session status = %d, want %d", audit.Code, http.StatusOK)
	}
}

func TestConsoleAndAdminPagesRenderSeedData(t *testing.T) {
	t.Parallel()

	srv, err := NewTestServer(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("NewTestServer returned error: %v", err)
	}

	tests := []struct {
		path string
		want string
	}{
		{path: "/console", want: "Fleet Health Overview"},
		{path: "/console/overview", want: "Fleet Health Overview"},
		{path: "/console/devices", want: "cam-a-001"},
		{path: "/console/firmware-ota", want: "Fleet Health Overview"},
		{path: "/console/stream-health", want: "Fleet Health Overview"},
		{path: "/console/groups", want: "Fleet Health Overview"},
		{path: "/admin", want: "Platform Operations"},
		{path: "/admin/ops", want: "DeviceProvisionRequested"},
		{path: "/admin/audit", want: "Platform Operations"},
		{path: "/admin/operations", want: "DeviceProvisionRequested"},
	}

	for _, tt := range tests {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d", tt.path, rec.Code, http.StatusOK)
		}
		if !strings.Contains(rec.Body.String(), tt.want) {
			t.Fatalf("%s body does not contain %q\n%s", tt.path, tt.want, rec.Body.String())
		}
	}
}
