package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
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
			if r.Header.Get("Authorization") != "Bearer refreshed-access" {
				http.Error(w, "unexpected bearer token", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-up","name":"edge-01","model":"RTK-CAM-X","serial_number":"UP-1","readiness":"online","status":"online","metadata":{"video_cloud_devid":"video-up"}}]}`))
		case "/v1/orgs/org-other/devices":
			t.Fatalf("should not request devices for non-active org")
		case "/v1/orgs/org-up/devices/dev-up/provision":
			if r.Header.Get("Authorization") != "Bearer refreshed-access" {
				http.Error(w, "unexpected bearer token", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"operation":{"id":"op-up","state":"published","message":"accepted"}}`))
		case "/v1/orgs/org-up/devices/dev-up/deactivate":
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
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
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
	if !strings.Contains(devices.Body.String(), "edge-01") || strings.Contains(devices.Body.String(), "cam-a-001") {
		t.Fatalf("devices should use upstream projection, got %s", devices.Body.String())
	}
	if !strings.Contains(devices.Body.String(), "source_facts") {
		t.Fatalf("devices response does not include source_facts: %s", devices.Body.String())
	}

	provision := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-up/provision", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(provision, req)
	if provision.Code != http.StatusOK {
		t.Fatalf("provision status = %d, body=%s", provision.Code, provision.Body.String())
	}
	if !strings.Contains(provision.Body.String(), "op-up") {
		t.Fatalf("provision body = %s", provision.Body.String())
	}

	deactivate := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/devices/dev-up/deactivate", nil)
	req.AddCookie(cookie)
	srv.ServeHTTP(deactivate, req)
	if deactivate.Code != http.StatusOK {
		t.Fatalf("deactivate status = %d, body=%s", deactivate.Code, deactivate.Body.String())
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
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
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
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
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
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
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
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
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
	srv := New(st)

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
	srv := New(st)
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
		{path: "/console", want: "Customer Fleet"},
		{path: "/console/devices", want: "cam-a-001"},
		{path: "/admin", want: "Platform Operations"},
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
