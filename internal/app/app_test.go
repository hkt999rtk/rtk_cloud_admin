package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rtk_cloud_admin/internal/contracts"
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
