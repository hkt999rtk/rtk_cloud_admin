package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestExplicitBrandCloudScopeUsesPathWithoutMutatingSession(t *testing.T) {
	var mu sync.Mutex
	var summaryClouds []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{"id": "developer-1", "email": "developer@example.com"},
				"organizations": []map[string]any{
					{"id": cloudA, "name": "Cloud A", "role": "owner", "capabilities": []string{capabilityFleetRead}},
					{"id": cloudB, "name": "Cloud B", "role": "viewer", "capabilities": []string{capabilityFleetRead}},
				},
			})
		case "/v1/orgs/" + cloudA + "/fleet/summary", "/v1/orgs/" + cloudB + "/fleet/summary":
			cloudID := r.URL.Path[len("/v1/orgs/") : len(r.URL.Path)-len("/fleet/summary")]
			mu.Lock()
			summaryClouds = append(summaryClouds, cloudID)
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"total": 1, "by_status": map[string]int{"online": 1}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "developer-1", "developer@example.com", "access", "refresh", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	request := func(path string, withCookie bool) *httptest.ResponseRecorder {
		var selected *http.Cookie
		if withCookie {
			selected = cookie
		}
		return requestWithCookie(t, srv, http.MethodGet, path, nil, selected)
	}

	path := "/api/developer/brand-clouds/" + cloudA + "/fleet/summary"
	if response := request(path, true); response.Code != http.StatusOK {
		t.Fatalf("scoped summary status = %d, body=%s", response.Code, response.Body.String())
	}
	stored, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ActiveOrgID != cloudB {
		t.Fatalf("stored active org = %q, want unchanged %q", stored.ActiveOrgID, cloudB)
	}
	mu.Lock()
	if len(summaryClouds) != 1 || summaryClouds[0] != cloudA {
		t.Fatalf("summary clouds = %v, want [%s]", summaryClouds, cloudA)
	}
	mu.Unlock()

	foreign := "99999999-9999-4999-8999-999999999999"
	if response := request("/api/developer/brand-clouds/"+foreign+"/fleet/summary", true); response.Code != http.StatusForbidden {
		t.Fatalf("foreign cloud status = %d, body=%s", response.Code, response.Body.String())
	}
	if response := request("/api/developer/brand-clouds/not-a-uuid/fleet/summary", true); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid cloud status = %d, body=%s", response.Code, response.Body.String())
	}
	if response := request("/api/developer/brand-clouds/"+cloudB+"/fleet/firmware-distribution", true); response.Code != http.StatusForbidden {
		t.Fatalf("cloud-specific capability status = %d, body=%s", response.Code, response.Body.String())
	}
	if response := request(path, false); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, body=%s", response.Code, response.Body.String())
	}
}
