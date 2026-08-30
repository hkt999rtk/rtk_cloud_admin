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

func TestDeveloperPKIAllowedFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  config.Config
		key  string
		want int
	}{
		{"disabled", config.Config{Environment: "staging"}, "idem", http.StatusNotFound},
		{"production", config.Config{Environment: "production", DeveloperPKITestToolsEnabled: true}, "idem", http.StatusNotFound},
		{"production alias", config.Config{Environment: "prod", DeveloperPKITestToolsEnabled: true}, "idem", http.StatusNotFound},
		{"missing idempotency", config.Config{Environment: "staging", DeveloperPKITestToolsEnabled: true}, "", http.StatusPreconditionRequired},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{cfg: tc.cfg}
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			req.Header.Set("Idempotency-Key", tc.key)
			rec := httptest.NewRecorder()
			if _, ok := srv.developerPKIAllowed(rec, req); ok {
				t.Fatal("expected request rejection")
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestDeveloperPKIAppBundleProxy(t *testing.T) {
	var gotBody map[string]string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/developer/brand-clouds/brand-1/pki/test-app-certificates" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer access" || r.Header.Get("Idempotency-Key") != "idem-app" {
			t.Fatalf("headers = %#v", r.Header)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"certificate_bundle": map[string]any{"format": "rtk_certificate_bundle", "version": 1}})
	}))
	defer upstream.Close()

	srv, sessionID := newDeveloperPKITestServer(t, upstream.URL, "")
	req := developerPKIRequest(t, sessionID, "/api/developer/pki/test-bundles/app", "idem-app", `{"brand_cloud_id":"brand-1","target_type":"user","target_id":"user-1","csr_pem":"CSR"}`)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != certificateBundleMIME || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("response status=%d headers=%v body=%s", rec.Code, rec.Header(), rec.Body.String())
	}
	if gotBody["target_id"] != "user-1" || gotBody["csr_pem"] != "CSR" || strings.Contains(rec.Body.String(), "PRIVATE KEY") {
		t.Fatalf("upstream body=%v response=%s", gotBody, rec.Body.String())
	}

	for _, tc := range []struct {
		name, body, session string
		want                int
	}{
		{"unauthenticated", `{}`, "", http.StatusUnauthorized},
		{"invalid JSON", `{`, sessionID, http.StatusBadRequest},
		{"cross tenant", `{"brand_cloud_id":"brand-2"}`, sessionID, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := developerPKIRequest(t, tc.session, "/api/developer/pki/test-bundles/app", "idem-error", tc.body)
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestDeveloperPKIDeviceBundleProxy(t *testing.T) {
	var factoryBody map[string]any
	factory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/factory/enroll" || r.Header.Get("Authorization") != "Bearer factory-jwt" {
			t.Fatalf("factory request path=%s headers=%v", r.URL.Path, r.Header)
		}
		if err := json.NewDecoder(r.Body).Decode(&factoryBody); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"certificate_bundle": map[string]any{"format": "rtk_certificate_bundle", "version": 1}})
	}))
	defer factory.Close()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/device-item-profiles/profile-1"):
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": "profile-1", "status": "active", "service_options": []string{"video"}}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/device-item-profiles/profile-1/production-runs"):
			_ = json.NewEncoder(w).Encode(map[string]any{"production_run": map[string]any{"id": "run-1"}, "factory_jwt": "factory-jwt"})
		default:
			t.Fatalf("unexpected account request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer account.Close()

	srv, sessionID := newDeveloperPKITestServer(t, account.URL, factory.URL)
	body := `{"brand_cloud_id":"brand-1","device_item_profile_id":"profile-1","device_id":"device-1","serial_number":"serial-1","csr_pem":"CSR"}`
	req := developerPKIRequest(t, sessionID, "/api/developer/pki/test-bundles/device", "idem-device", body)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != certificateBundleMIME {
		t.Fatalf("response status=%d headers=%v body=%s", rec.Code, rec.Header(), rec.Body.String())
	}
	if factoryBody["devid"] != "device-1" || factoryBody["ttl_days"].(float64) != 30 || factoryBody["production_run_id"] != "run-1" {
		t.Fatalf("factory body = %#v", factoryBody)
	}

	for _, tc := range []struct {
		name, session, body string
		want                int
	}{
		{"unauthenticated", "", body, http.StatusUnauthorized},
		{"invalid JSON", sessionID, `{`, http.StatusBadRequest},
		{"invalid fields", sessionID, `{"brand_cloud_id":"brand-2"}`, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := developerPKIRequest(t, tc.session, "/api/developer/pki/test-bundles/device", "idem-device-error", tc.body)
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}

	noFactory, noFactorySession := newDeveloperPKITestServer(t, account.URL, "")
	req = developerPKIRequest(t, noFactorySession, "/api/developer/pki/test-bundles/device", "idem-device-2", body)
	rec = httptest.NewRecorder()
	noFactory.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured factory status = %d", rec.Code)
	}
}

func newDeveloperPKITestServer(t *testing.T, accountURL, factoryURL string) (*Server, string) {
	t.Helper()
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "user-1", "developer@example.com", "access", "refresh", "brand-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{
		Config: config.Config{
			Environment: "staging", DeveloperPKITestToolsEnabled: true,
			AccountManagerBaseURL: accountURL, FactoryEnrollBaseURL: factoryURL,
		},
		AccountClient: accountclient.New(accountURL),
	})
	return srv, session.ID
}

func developerPKIRequest(t *testing.T, sessionID, path, key, body string) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(http.MethodPost, path, reader)
	req.Header.Set("Idempotency-Key", key)
	if sessionID != "" {
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
	}
	return req
}
