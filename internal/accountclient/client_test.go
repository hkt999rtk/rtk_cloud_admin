package accountclient

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
