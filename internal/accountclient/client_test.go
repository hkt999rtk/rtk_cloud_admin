package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientLoginAndMe(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			if got := r.Header.Get("Authorization"); got != "Bearer access" {
				t.Fatalf("Authorization = %q", got)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-1","name":"Acme","role":"owner","tier":"evaluation","evaluation_device_quota":5}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	login, err := client.Login(t.Context(), "user@example.com", "pw")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if login.Tokens.AccessToken != "access" {
		t.Fatalf("access token = %q", login.Tokens.AccessToken)
	}
	me, err := client.Me(t.Context(), login.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("Me returned error: %v", err)
	}
	if len(me.Organizations) != 1 || me.Organizations[0].ID != "org-1" {
		t.Fatalf("organizations = %#v", me.Organizations)
	}
	if me.Organizations[0].Tier != "evaluation" || me.Organizations[0].EvaluationDeviceQuota != 5 {
		t.Fatalf("organization metadata = %#v", me.Organizations[0])
	}
}

func TestClientRefresh(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/refresh":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s", r.Method)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"refreshed","refresh_token":"refresh-2","expires_in":1800}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	refresh, err := client.Refresh(t.Context(), "refresh-1")
	if err != nil {
		t.Fatalf("Refresh returned error: %v", err)
	}
	if refresh.Tokens.AccessToken != "refreshed" || refresh.Tokens.RefreshToken != "refresh-2" {
		t.Fatalf("tokens = %#v", refresh.Tokens)
	}
}

func TestClientSignupVerifyResendAndQuotaRaise(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/signup":
			if r.Method != http.MethodPost {
				t.Fatalf("signup method = %s", r.Method)
			}
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"signup@example.com","name":"Signup"},"organization":{"id":"org-1","name":"Acme","role":"owner","tier":"evaluation","evaluation_device_quota":5}}`))
		case "/v1/auth/verify-email":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"signup@example.com","name":"Signup"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/auth/resend-verification":
			w.WriteHeader(http.StatusAccepted)
		case "/v1/orgs/org-1/quota-raise-requests":
			if got := r.Header.Get("Authorization"); got != "Bearer access" {
				t.Fatalf("Authorization = %q", got)
			}
			_, _ = w.Write([]byte(`{"quota_raise_request":{"id":"req-1","organization_id":"org-1","requested_by":"u1","requested_quota":25,"use_case":"growth","contact_info":{"email":"owner@example.com"},"status":"pending","created_at":"2026-05-05T00:00:00Z","updated_at":"2026-05-05T00:00:00Z"},"organization":{"id":"org-1","name":"Acme","role":"owner","tier":"evaluation","evaluation_device_quota":5}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	signup, err := client.Signup(t.Context(), SignupRequest{
		Email:            "signup@example.com",
		Password:         "password123",
		OrganizationName: "Acme",
	})
	if err != nil {
		t.Fatalf("Signup returned error: %v", err)
	}
	if signup.Organization.Tier != "evaluation" || signup.Organization.EvaluationDeviceQuota != 5 {
		t.Fatalf("signup organization = %#v", signup.Organization)
	}

	verify, err := client.VerifyEmail(t.Context(), "token-1")
	if err != nil {
		t.Fatalf("VerifyEmail returned error: %v", err)
	}
	if verify.Tokens.AccessToken != "access" {
		t.Fatalf("verify tokens = %#v", verify.Tokens)
	}

	if err := client.ResendVerification(t.Context(), "signup@example.com"); err != nil {
		t.Fatalf("ResendVerification returned error: %v", err)
	}

	raise, err := client.CreateQuotaRaiseRequest(t.Context(), "access", "org-1", QuotaRaiseRequest{
		RequestedQuota: 25,
		UseCase:        "growth",
		ContactInfo:    map[string]any{"email": "owner@example.com"},
	})
	if err != nil {
		t.Fatalf("CreateQuotaRaiseRequest returned error: %v", err)
	}
	if raise.QuotaRaiseRequest.Status != "pending" {
		t.Fatalf("quota raise status = %q", raise.QuotaRaiseRequest.Status)
	}
}

func TestClientSSOStartCallbackAndProviderConfig(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/sso/start":
			if r.Method != http.MethodPost {
				t.Fatalf("sso start method = %s", r.Method)
			}
			var body SSOStartRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso start request: %v", err)
			}
			if body.Email != "owner@example.com" || body.ReturnURL != "https://admin.example.com/console" {
				t.Fatalf("sso start request = %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"redirect_url":    "https://idp.example.com/authorize?state=state-1",
				"state":           "state-1",
				"provider_id":     "provider-1",
				"organization_id": "org-1",
				"organization":    "Acme",
			})
		case "/v1/auth/sso/callback":
			if r.Method != http.MethodPost {
				t.Fatalf("sso callback method = %s", r.Method)
			}
			var body SSOCallbackRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso callback request: %v", err)
			}
			if body.Code != "code-1" || body.State != "state-1" || body.RedirectURI != "https://admin.example.com/api/auth/sso/callback" {
				t.Fatalf("sso callback request = %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user":          map[string]any{"id": "u1", "email": "owner@example.com", "name": "Owner"},
				"kind":          "customer",
				"active_org_id": "org-1",
				"organizations": []map[string]any{{"id": "org-1", "name": "Acme", "role": "owner", "tier": "evaluation", "evaluation_device_quota": 5}},
				"tokens":        map[string]any{"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
			})
		case "/v1/admin/sso/providers/status":
			if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
				t.Fatalf("status Authorization = %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"providers": []map[string]any{
					{"organization_id": "org-1", "organization": "Acme", "provider_id": "provider-1", "issuer": "https://idp.example.com", "client_id": "client-1", "verified_domains": []string{"example.com"}, "enabled": true, "configured": true, "status": "ready"},
				},
			})
		case "/v1/admin/orgs/org-1/sso-provider":
			if got := r.Header.Get("Authorization"); got != "Bearer admin-access" {
				t.Fatalf("config Authorization = %q", got)
			}
			switch r.Method {
			case http.MethodGet:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"provider": map[string]any{"organization_id": "org-1", "organization": "Acme", "provider_id": "provider-1", "issuer": "https://idp.example.com", "client_id": "client-1", "verified_domains": []string{"example.com"}, "enabled": true, "configured": true, "status": "ready"},
				})
			case http.MethodPut:
				var body SSOProviderConfigRequest
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatalf("decode sso provider config request: %v", err)
				}
				if body.ClientSecret != "secret-1" || body.Issuer != "https://idp.example.com" || len(body.VerifiedDomains) != 1 {
					t.Fatalf("sso provider config request = %#v", body)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"provider": map[string]any{"organization_id": "org-1", "organization": "Acme", "provider_id": "provider-1", "issuer": "https://idp.example.com", "client_id": "client-1", "verified_domains": []string{"example.com"}, "enabled": true, "configured": true, "status": "ready"},
				})
			default:
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	start, err := client.StartSSO(t.Context(), SSOStartRequest{
		Email:     "owner@example.com",
		ReturnURL: "https://admin.example.com/console",
	})
	if err != nil {
		t.Fatalf("StartSSO returned error: %v", err)
	}
	if start.RedirectURL == "" || start.OrganizationID != "org-1" || start.ProviderID != "provider-1" {
		t.Fatalf("start = %#v", start)
	}

	callback, err := client.CompleteSSO(t.Context(), SSOCallbackRequest{
		Code:        "code-1",
		State:       "state-1",
		RedirectURI: "https://admin.example.com/api/auth/sso/callback",
	})
	if err != nil {
		t.Fatalf("CompleteSSO returned error: %v", err)
	}
	if callback.Kind != "customer" || callback.ActiveOrgID != "org-1" || callback.Tokens.AccessToken != "access" || len(callback.Organizations) != 1 {
		t.Fatalf("callback = %#v", callback)
	}

	statuses, err := client.SSOProviderStatuses(t.Context(), "admin-access")
	if err != nil {
		t.Fatalf("SSOProviderStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].OrganizationID != "org-1" || !statuses[0].Configured {
		t.Fatalf("statuses = %#v", statuses)
	}

	status, err := client.SSOProviderStatus(t.Context(), "admin-access", "org-1")
	if err != nil {
		t.Fatalf("SSOProviderStatus returned error: %v", err)
	}
	if status.Issuer != "https://idp.example.com" || status.ClientID != "client-1" {
		t.Fatalf("status = %#v", status)
	}

	updated, err := client.UpsertSSOProvider(t.Context(), "admin-access", "org-1", SSOProviderConfigRequest{
		Issuer:          "https://idp.example.com",
		ClientID:        "client-1",
		ClientSecret:    "secret-1",
		VerifiedDomains: []string{"example.com"},
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("UpsertSSOProvider returned error: %v", err)
	}
	if !updated.Enabled || !updated.Configured {
		t.Fatalf("updated = %#v", updated)
	}
}

func TestClientSSOErrorMatrix(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/sso/start":
			var body SSOStartRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode sso start matrix request: %v", err)
			}
			switch body.Email {
			case "invalid-json":
				_, _ = w.Write([]byte(`{`))
			case "timeout":
				time.Sleep(50 * time.Millisecond)
				_, _ = w.Write([]byte(`{"redirect_url":"late"}`))
			case "forbidden":
				http.Error(w, "forbidden", http.StatusForbidden)
			case "not-found":
				http.Error(w, "unknown domain", http.StatusNotFound)
			default:
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}
		case "/v1/auth/sso/callback":
			http.Error(w, "bad gateway", http.StatusBadGateway)
		case "/v1/admin/sso/providers/status":
			http.Error(w, "upstream unavailable", http.StatusServiceUnavailable)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	assertHTTPStatus := func(name string, err error, status int) {
		t.Helper()
		if err == nil {
			t.Fatalf("%s expected error", name)
		}
		httpErr, ok := err.(*HTTPError)
		if !ok {
			t.Fatalf("%s error type = %T, want *HTTPError", name, err)
		}
		if httpErr.StatusCode != status {
			t.Fatalf("%s status = %d, want %d", name, httpErr.StatusCode, status)
		}
	}

	_, err := client.StartSSO(t.Context(), SSOStartRequest{Email: "owner@example.com"})
	assertHTTPStatus("start unauthorized", err, http.StatusUnauthorized)

	for name, tc := range map[string]struct {
		email  string
		status int
	}{
		"start forbidden": {"forbidden", http.StatusForbidden},
		"start not found": {"not-found", http.StatusNotFound},
	} {
		_, err := client.StartSSO(t.Context(), SSOStartRequest{Email: tc.email})
		assertHTTPStatus(name, err, tc.status)
	}

	if _, err := client.StartSSO(t.Context(), SSOStartRequest{Email: "invalid-json"}); err == nil {
		t.Fatal("expected invalid JSON error")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Millisecond)
	defer cancel()
	if _, err := client.StartSSO(ctx, SSOStartRequest{Email: "timeout"}); err == nil {
		t.Fatal("expected timeout error")
	}

	_, err = client.CompleteSSO(t.Context(), SSOCallbackRequest{Code: "code", State: "state"})
	assertHTTPStatus("callback 5xx", err, http.StatusBadGateway)

	_, err = client.SSOProviderStatuses(t.Context(), "admin-access")
	assertHTTPStatus("provider status 5xx", err, http.StatusServiceUnavailable)

	if _, err := New("").StartSSO(t.Context(), SSOStartRequest{Email: "owner@example.com"}); err == nil {
		t.Fatal("expected disabled StartSSO error")
	}
}

func TestClientOrganizationsAndDevices(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer access" {
			t.Fatalf("Authorization = %q, want Bearer access", got)
		}
		switch r.URL.Path {
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"organizations": []map[string]any{
					{"id": "org-1", "name": "Acme", "role": "owner", "tier": "evaluation", "evaluation_device_quota": 5},
				},
			})
		case "/v1/orgs/org-1/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{
						"id":                "dev-1",
						"organization_id":   "org-1",
						"organization":      "Acme",
						"name":              "Front Door",
						"model":             "RTK-CAM-A",
						"serial_number":     "ACME-001",
						"video_cloud_devid": "vc-1",
						"status":            "online",
						"readiness":         "activated",
						"metadata":          map[string]any{"video_cloud_devid": "vc-1"},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	orgs, err := client.Organizations(t.Context(), "access")
	if err != nil {
		t.Fatalf("Organizations returned error: %v", err)
	}
	if len(orgs) != 1 || orgs[0].ID != "org-1" || orgs[0].EvaluationDeviceQuota != 5 {
		t.Fatalf("organizations = %#v", orgs)
	}

	devices, err := client.Devices(t.Context(), "access", "org-1")
	if err != nil {
		t.Fatalf("Devices returned error: %v", err)
	}
	if len(devices) != 1 || devices[0].ID != "dev-1" || devices[0].VideoCloudDevID != "vc-1" {
		t.Fatalf("devices = %#v", devices)
	}
}

func TestClientLifecycleOperationsAcceptNestedAndFlatResponses(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer access" {
			t.Fatalf("Authorization = %q, want Bearer access", got)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		switch r.URL.Path {
		case "/v1/orgs/org-1/devices/dev-1/provision":
			_, _ = w.Write([]byte(`{"operation":{"id":"op-provision","state":"published","message":"accepted","updated_at":"2026-05-07T00:00:00Z"}}`))
		case "/v1/orgs/org-1/devices/dev-1/deactivate":
			_, _ = w.Write([]byte(`{"id":"op-deactivate","state":"completed","message":"disabled","updated_at":"2026-05-07T00:01:00Z"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	provision, err := client.Provision(t.Context(), "access", "org-1", "dev-1")
	if err != nil {
		t.Fatalf("Provision returned error: %v", err)
	}
	if provision.ID != "op-provision" || provision.State != "published" {
		t.Fatalf("provision operation = %#v", provision)
	}

	deactivate, err := client.Deactivate(t.Context(), "access", "org-1", "dev-1")
	if err != nil {
		t.Fatalf("Deactivate returned error: %v", err)
	}
	if deactivate.ID != "op-deactivate" || deactivate.State != "completed" {
		t.Fatalf("deactivate operation = %#v", deactivate)
	}
}

func TestClientHealthAndHTTPErrorBody(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			_, _ = w.Write([]byte("ok"))
		case "/v1/orgs/org-1/devices":
			http.Error(w, "forbidden org", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL + "/")
	if err := client.Health(t.Context()); err != nil {
		t.Fatalf("Health returned error: %v", err)
	}

	_, err := client.Devices(t.Context(), "access", "org-1")
	if err == nil {
		t.Fatal("expected Devices error")
	}
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("error type = %T, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusForbidden || !strings.Contains(httpErr.Body, "forbidden org") {
		t.Fatalf("HTTPError = %#v", httpErr)
	}
}

func TestClientDisabledHealthAndDecodeErrors(t *testing.T) {
	t.Parallel()

	disabled := New("")
	if disabled.Enabled() {
		t.Fatal("disabled client should report Enabled false")
	}
	if _, err := disabled.Login(t.Context(), "user@example.com", "secret"); err == nil {
		t.Fatal("expected disabled Login error")
	}
	if err := disabled.Health(t.Context()); err == nil {
		t.Fatal("expected disabled Health error")
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{`))
		case "/healthz":
			http.Error(w, "down", http.StatusBadGateway)
		case "/v1/me":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := NewWithHTTPClient(upstream.URL+"/", nil)
	if _, err := client.Login(t.Context(), "user@example.com", "secret"); err == nil {
		t.Fatal("expected invalid JSON error")
	}
	if err := client.Health(t.Context()); err == nil {
		t.Fatal("expected health status error")
	}
	if _, err := client.Me(t.Context(), "access"); err == nil {
		t.Fatal("expected empty JSON response decode error")
	}
}

func TestClientPropagatesTimeoutAndStatusMatrix(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/orgs":
			http.Error(w, "forbidden", http.StatusForbidden)
		case "/v1/auth/refresh":
			time.Sleep(50 * time.Millisecond)
			_, _ = w.Write([]byte(`{"tokens":{"access_token":"late"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := NewWithHTTPClient(upstream.URL, upstream.Client())
	if _, err := client.Organizations(t.Context(), "access"); err == nil {
		t.Fatal("expected Organizations status error")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Millisecond)
	defer cancel()
	if _, err := client.Refresh(ctx, "refresh"); err == nil {
		t.Fatal("expected Refresh timeout error")
	}
}
