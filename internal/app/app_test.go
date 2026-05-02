package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func TestCustomerLoginAndUpstreamProxyMode(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			if r.Header.Get("Authorization") != "Bearer access" {
				t.Fatalf("missing bearer token")
			}
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs":
			_, _ = w.Write([]byte(`{"organizations":[{"id":"org-up","name":"Upstream Org","role":"owner"}]}`))
		case "/v1/orgs/org-up/devices":
			_, _ = w.Write([]byte(`{"devices":[{"id":"dev-up","name":"edge-01","model":"RTK-CAM-X","serial_number":"UP-1","readiness":"online","status":"online","metadata":{"video_cloud_devid":"video-up"}}]}`))
		case "/v1/orgs/org-up/devices/dev-up/provision":
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
	if devices.Code != http.StatusOK {
		t.Fatalf("devices status = %d, body=%s", devices.Code, devices.Body.String())
	}
	if !strings.Contains(devices.Body.String(), "edge-01") || strings.Contains(devices.Body.String(), "cam-a-001") {
		t.Fatalf("devices should use upstream projection, got %s", devices.Body.String())
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
