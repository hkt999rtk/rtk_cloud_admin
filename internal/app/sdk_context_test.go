package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/accountclient"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSDKContextAuthorizationAndExplicitScope(t *testing.T) {
	upstream, fixture := managedCloudFixtureServer(t)
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner-1", "demo@example.test", "fixture-access", "fixture-refresh", cloudB, time.Hour)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	path := "/api/developer/chipset-sdk/context?cloudId=" + cloudA
	response := authenticatedRequest(srv, session.ID, http.MethodGet, path, nil, nil)
	if response.Code != 200 {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private context must not be cached")
	}
	var body struct {
		Me struct {
			ActiveOrgID string `json:"active_org_id"`
		}
		Cloud  *accountclient.ManagedCloud `json:"brand_cloud"`
		Status string                      `json:"cloud_list_status"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Cloud == nil || body.Cloud.ID != cloudA || body.Me.ActiveOrgID != cloudA || body.Status != "available" {
		t.Fatalf("incorrect context: %s", response.Body.String())
	}
	saved, _ := st.GetSession(session.ID)
	if saved.ActiveOrgID != cloudB {
		t.Fatal("read changed active cloud")
	}
	for _, secret := range []string{"fixture-access", "fixture-refresh", "access_token", "refresh_token"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Fatal("private token leaked")
		}
	}
	for _, query := range []string{"?cloudId=bad", "?cloudId=" + cloudA + "&cloudId=" + cloudB, "?unknown=1"} {
		if got := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/chipset-sdk/context"+query, nil, nil).Code; got != 400 {
			t.Fatalf("invalid query status %d", got)
		}
	}
	if got := authenticatedRequest(srv, "missing", http.MethodGet, path, nil, nil).Code; got != 401 {
		t.Fatalf("unauthenticated %d", got)
	}
	platform, _ := st.CreateSession("platform_admin", "admin", "admin@example.test", "fixture-access", "", cloudA, time.Hour)
	if got := authenticatedRequest(srv, platform.ID, http.MethodGet, path, nil, nil).Code; got != 403 {
		t.Fatalf("platform %d", got)
	}
	fixture.mu.Lock()
	fixture.deny = true
	fixture.mu.Unlock()
	if got := authenticatedRequest(srv, session.ID, http.MethodGet, path, nil, nil).Code; got != 403 {
		t.Fatalf("denied cloud %d", got)
	}
}

func TestConsoleContextAlias(t *testing.T) {
	upstream, fixture := managedCloudFixtureServer(t)
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner-1", "demo@example.test", "fixture-access", "fixture-refresh", cloudB, time.Hour)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	path := "/api/developer/console/context?cloudId=" + cloudA
	response := authenticatedRequest(srv, session.ID, http.MethodGet, path, nil, nil)
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("console context: status %d", response.Code)
	}
	fixture.mu.Lock()
	for _, call := range fixture.calls {
		if call == "GET /v1/developer/brand-clouds" {
			t.Error("Docs fetched unused cloud list")
		}
	}
	fixture.mu.Unlock()
	if got := authenticatedRequest(srv, "missing", http.MethodGet, path, nil, nil).Code; got != 401 {
		t.Fatalf("unauthenticated %d", got)
	}
	fixture.mu.Lock()
	fixture.deny = true
	fixture.mu.Unlock()
	if got := authenticatedRequest(srv, session.ID, http.MethodGet, path, nil, nil).Code; got != 403 {
		t.Fatalf("denied cloud %d", got)
	}
}

func TestConsoleCloudListContext(t *testing.T) {
	upstream, fixture := managedCloudFixtureServer(t)
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner-1", "demo@example.test", "fixture-access", "fixture-refresh", cloudB, time.Hour)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	path := "/api/developer/console/clouds-context"
	for _, view := range []string{"all", "owned", "shared"} {
		response := authenticatedRequest(srv, session.ID, http.MethodGet, path+"?view="+view+"&limit=25&offset=0", nil, nil)
		if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("list status %d", response.Code)
		}
		var body struct {
			Page accountclient.ManagedCloudPage `json:"page"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		expected := 1
		if view == "all" {
			expected = 2
		}
		if len(body.Page.BrandClouds) != expected || body.Page.OwnedLimit != 8 || body.Page.OwnedCount != 1 {
			t.Fatal("lost filter or quota")
		}
	}
	for _, query := range []string{"?view=bad", "?limit=101", "?offset=-1", "?offset=0&offset=1", "?cloudId=" + cloudA} {
		if got := authenticatedRequest(srv, session.ID, http.MethodGet, path+query, nil, nil).Code; got != 400 {
			t.Fatalf("invalid query status %d", got)
		}
	}
	if got := authenticatedRequest(srv, "missing", http.MethodGet, path, nil, nil).Code; got != 401 {
		t.Fatal(got)
	}
	platform, _ := st.CreateSession("platform_admin", "admin", "admin@example.test", "fixture-access", "", cloudA, time.Hour)
	response := authenticatedRequest(srv, platform.ID, http.MethodGet, path, nil, nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"page":null`) || !strings.Contains(response.Body.String(), `"kind":"platform_admin"`) {
		t.Fatal("platform view should not load clouds")
	}
	fixture.mu.Lock()
	fixture.deny = true
	fixture.mu.Unlock()
	response = authenticatedRequest(srv, session.ID, http.MethodGet, path, nil, nil)
	if response.Code != 403 || strings.Contains(response.Body.String(), "secret upstream") {
		t.Fatal("list authorization or redaction failed")
	}
}

func TestSDKContextRefreshOnceParallelAndOptionalList(t *testing.T) {
	for _, mode := range []string{"parallel", "slow-list", "failed-list", "no-cloud", "list-forbidden", "profile-timeout"} {
		t.Run(mode, func(t *testing.T) {
			var refreshes atomic.Int32
			selectedStarted := make(chan struct{}, 1)
			listStarted := make(chan struct{}, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/auth/refresh":
					refreshes.Add(1)
					json.NewEncoder(w).Encode(map[string]any{"tokens": accountclient.Tokens{AccessToken: "fresh-access", RefreshToken: "fresh-refresh", ExpiresIn: 3600}})
				case "/v1/me":
					if mode == "profile-timeout" {
						<-r.Context().Done()
						return
					}
					if r.Header.Get("Authorization") != "Bearer fresh-access" {
						w.WriteHeader(401)
						return
					}
					members := []map[string]any{}
					if mode != "no-cloud" {
						members = append(members, map[string]any{"id": cloudA, "name": "Cloud A", "role": "owner"})
					}
					json.NewEncoder(w).Encode(map[string]any{"user": map[string]string{"id": "owner-1", "email": "dev@example.test"}, "brand_cloud_memberships": members})
				case "/v1/developer/brand-clouds":
					if r.Header.Get("Authorization") != "Bearer fresh-access" {
						t.Error("list used old token")
					}
					listStarted <- struct{}{}
					if mode == "parallel" {
						select {
						case <-selectedStarted:
						case <-r.Context().Done():
							return
						}
					}
					if mode == "slow-list" {
						<-r.Context().Done()
						return
					}
					if mode == "failed-list" {
						w.WriteHeader(503)
						return
					}
					if mode == "list-forbidden" {
						w.WriteHeader(403)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"brand_clouds": []any{}, "owned_count": 0, "owned_limit": 5, "reserved_count": 0})
				case "/v1/developer/brand-clouds/" + cloudA:
					if mode == "no-cloud" {
						t.Error("unexpected selected cloud request")
					}
					if r.Header.Get("Authorization") != "Bearer fresh-access" {
						t.Error("selected cloud used old token")
					}
					selectedStarted <- struct{}{}
					if mode == "parallel" {
						select {
						case <-listStarted:
						case <-r.Context().Done():
							return
						}
					}
					json.NewEncoder(w).Encode(map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloudA, Name: "Cloud A", Status: "active", MyRole: "owner"}})
				default:
					w.WriteHeader(404)
				}
			}))
			defer upstream.Close()
			st := mustOpenStore(t)
			session, _ := st.CreateSession("customer", "owner-1", "dev@example.test", "expired-access", "refresh", cloudB, time.Hour)
			srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
			started := time.Now()
			response := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/chipset-sdk/context", nil, nil)
			if mode == "profile-timeout" {
				if response.Code != 504 || time.Since(started) > 6*time.Second {
					t.Fatalf("timeout status=%d elapsed=%s", response.Code, time.Since(started))
				}
				return
			}
			if refreshes.Load() != 1 {
				t.Fatalf("refreshes=%d", refreshes.Load())
			}
			if mode == "list-forbidden" {
				if response.Code != 403 {
					t.Fatal(response.Code)
				}
				return
			}
			if response.Code != 200 {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if mode == "slow-list" || mode == "failed-list" {
				if !strings.Contains(response.Body.String(), `"cloud_list_status":"unavailable"`) {
					t.Fatal("missing degraded list state")
				}
			}
			if mode == "slow-list" && time.Since(started) > 2*time.Second {
				t.Fatal("optional list blocked too long")
			}
			if mode == "no-cloud" && !strings.Contains(response.Body.String(), `"brand_cloud":null`) {
				t.Fatal("invented cloud")
			}
			saved, _ := st.GetSession(session.ID)
			if saved.AccessToken != "fresh-access" || saved.ActiveOrgID != cloudB {
				t.Fatal("incorrect session update")
			}
		})
	}
}
