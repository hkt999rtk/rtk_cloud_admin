package app

import (
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/config"
	"strings"
	"testing"
	"time"
)

func TestPRO2BFFAuthenticationAndDownload(t *testing.T) {
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/pro2-examples/catalog" && r.URL.Path != "/api/pro2-examples/download" {
			t.Error(r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v1"}`))
	}))
	defer portal.Close()
	srv := newSeededTestServer(t, config.Config{SDKPortalBaseURL: portal.URL, Environment: "local"})
	r := httptest.NewRecorder()
	srv.ServeHTTP(r, httptest.NewRequest("GET", "/api/developer/pro2-examples/catalog", nil))
	if r.Code != 401 {
		t.Fatal(r.Code)
	}
	session, e := srv.sessions.CreateSession("customer", "owner-1", "owner@example.com", "owner-token", "refresh", "org-acme", time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	response := authenticatedRequest(srv, session.ID, "GET", "/api/developer/pro2-examples/catalog?version=v1", nil, nil)
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	response = authenticatedRequest(srv, session.ID, "POST", "/api/developer/pro2-examples/download", strings.NewReader("accepted=true&artifact=mqtt&version=v1&terms_version=eval-v1"), http.Header{"Content-Type": {"application/x-www-form-urlencoded"}})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	response = authenticatedRequest(srv, session.ID, "POST", "/api/developer/pro2-examples/download", nil, http.Header{"Origin": {"https://untrusted.example"}})
	if response.Code != 403 {
		t.Fatal(response.Code)
	}
}
