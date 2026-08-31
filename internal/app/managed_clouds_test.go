package app

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

const cloudA = "11111111-1111-4111-8111-111111111111"
const cloudB = "22222222-2222-4222-8222-222222222222"
const productA = "33333333-3333-4333-8333-333333333333"

type managedCloudFixture struct {
	mu             sync.Mutex
	calls          []string
	keys           []string
	clouds         map[string]accountclient.ManagedCloud
	deny           bool
	operation      bool
	sharingMembers map[string]accountclient.Member
	sharingInvites map[string]accountclient.BrandCloudMemberInvitation
}

func managedCloudFixtureServer(t *testing.T) (*httptest.Server, *managedCloudFixture) {
	t.Helper()
	f := &managedCloudFixture{clouds: map[string]accountclient.ManagedCloud{
		cloudA: {ID: cloudA, Name: "Camera Lab", Description: "My owned cloud", TenantSlug: "camera-lab", OwnerUserID: "owner-1", MyRole: "owner", Status: "active", OwnershipVersion: 1, Capabilities: []string{"cloud.update", "product.read"}},
		cloudB: {ID: cloudB, Name: "Shared Home", Description: "Read-only collaboration", TenantSlug: "shared-home", OwnerUserID: "owner-2", MyRole: "viewer", Status: "active", OwnershipVersion: 1, Capabilities: []string{"product.read"}},
	}}
	f.sharingMembers = map[string]accountclient.Member{"44444444-4444-4444-8444-444444444444": {OrganizationID: cloudA, UserID: "44444444-4444-4444-8444-444444444444", Email: "viewer@example.test", Role: "viewer", AccessScope: &accountclient.CloudAccessScope{Kind: "selected_products", ProductIDs: []string{productA}}}}
	f.sharingInvites = map[string]accountclient.BrandCloudMemberInvitation{}
	owner := f.clouds[cloudA]
	owner.Capabilities = append(owner.Capabilities, "team.manage")
	f.clouds[cloudA] = owner
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-Billing-Actor-Type") != "" || r.Header.Get("X-Billing-Owner-User-ID") != "" {
			t.Error("untrusted header forwarded")
		}
		w.Header().Set("Content-Type", "application/json")
		send := func(status int, v any) { w.WriteHeader(status); _ = json.NewEncoder(w).Encode(v) }
		if r.URL.Path == "/v1/auth/login" {
			send(200, map[string]any{"user": map[string]string{"id": "owner-1", "email": "demo@example.test"}, "tokens": map[string]any{"access_token": "fixture-access", "refresh_token": "fixture-refresh", "expires_in": 3600}})
			return
		}
		if r.URL.Path == "/v1/me" {
			send(200, map[string]any{"user": map[string]string{"id": "owner-1", "email": "demo@example.test"}, "brand_cloud_memberships": []map[string]any{{"id": cloudA, "name": "Camera Lab", "role": "owner", "capabilities": []string{"fleet.read", "product.read"}}, {"id": cloudB, "name": "Shared Home", "role": "viewer", "capabilities": []string{"product.read"}}}})
			return
		}
		if f.deny {
			send(403, map[string]string{"error": "secret upstream credential"})
			return
		}
		if r.Method != "GET" {
			f.keys = append(f.keys, r.Header.Get("Idempotency-Key"))
		}
		if r.URL.Path == "/v1/developer/brand-clouds" {
			if r.Method == "POST" {
				var body accountclient.ManagedCloudWrite
				_ = json.NewDecoder(r.Body).Decode(&body)
				c := f.clouds[cloudA]
				c.ID = "44444444-4444-4444-8444-444444444444"
				if body.Name != nil {
					c.Name = *body.Name
				}
				if body.Description != nil {
					c.Description = *body.Description
				}
				f.clouds[c.ID] = c
				send(201, map[string]any{"brand_cloud": c})
				return
			}
			list := []accountclient.ManagedCloud{}
			owned := 0
			for _, c := range f.clouds {
				if c.MyRole == "owner" {
					owned++
				}
				view := r.URL.Query().Get("view")
				if view == "owned" && c.MyRole != "owner" || view == "shared" && c.MyRole == "owner" {
					continue
				}
				list = append(list, c)
			}
			send(200, accountclient.ManagedCloudPage{BrandClouds: list, OwnedCount: owned, OwnedLimit: 8, Pagination: accountclient.Pagination{Limit: 25, Total: len(list)}})
			return
		}
		for id, c := range f.clouds {
			base := "/v1/developer/brand-clouds/" + id
			if serveCloudSharingFixture(f, w, r, id) {
				return
			}
			if r.URL.Path == base {
				if r.Method != "GET" && c.MyRole != "owner" {
					send(403, map[string]string{"error": "not owner"})
					return
				}
				if r.Method == "PATCH" {
					var body accountclient.ManagedCloudWrite
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body.Name != nil {
						c.Name = *body.Name
					}
					if body.Description != nil {
						c.Description = *body.Description
					}
					f.clouds[id] = c
				}
				if r.Method == "DELETE" {
					f.operation = true
					send(202, map[string]any{"operation": accountclient.ManagedCloudOperation{ID: productA, CloudID: id, Type: "delete", State: "running", Phase: "preparing", Blockers: []accountclient.CloudBlocker{}}})
					return
				}
				send(200, map[string]any{"brand_cloud": c})
				return
			}
			if r.URL.Path == base+"/deletion-preflight" {
				eligible := id == cloudA
				send(200, map[string]any{"eligible": eligible, "blockers": []accountclient.CloudBlocker{}})
				return
			}
			if r.URL.Path == base+"/operations/"+productA {
				send(200, map[string]any{"operation": accountclient.ManagedCloudOperation{ID: productA, CloudID: id, Type: "delete", State: "succeeded", Phase: "succeeded", Blockers: []accountclient.CloudBlocker{}}})
				return
			}
			if r.URL.Path == "/v1/orgs/"+id+"/device-item-profiles" {
				send(200, map[string]any{"device_item_profiles": []accountclient.DeviceItemProfile{{ID: productA, BrandCloudID: id, DisplayName: "Door Camera", ProfileKey: "door-camera", Status: "active"}}})
				return
			}
			if r.URL.Path == "/v1/orgs/"+id+"/device-item-profiles/"+productA {
				send(200, map[string]any{"device_item_profile": accountclient.DeviceItemProfile{ID: productA, BrandCloudID: id, DisplayName: "Door Camera", ProfileKey: "door-camera", Status: "active"}})
				return
			}
		}
		send(404, map[string]string{"error": "not found"})
	}))
	t.Cleanup(server.Close)
	return server, f
}

func TestManagedCloudBFFUsesExplicitScopeAndPreservesQuota(t *testing.T) {
	upstream, f := managedCloudFixtureServer(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("platform_admin", "owner-1", "owner@example.test", "fixture-access", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	request := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "test-key")
		r.Header.Set("X-Billing-Owner-User-ID", "forged")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	list := request("GET", "/api/developer/brand-clouds?view=shared", "")
	if list.Code != 200 || !strings.Contains(list.Body.String(), `"owned_count":1`) || !strings.Contains(list.Body.String(), `"owner_user_id":"owner-2"`) || list.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("list %d %s", list.Code, list.Body.String())
	}
	for _, id := range []string{cloudA, cloudB} {
		w := request("GET", "/api/developer/brand-clouds/"+id+"/products", "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), id) {
			t.Fatalf("scoped Products %d %s", w.Code, w.Body.String())
		}
	}
	w := request("PATCH", "/api/developer/brand-clouds/"+cloudB, `{"name":"forbidden"}`)
	if w.Code != 403 {
		t.Fatalf("shared mutation %d", w.Code)
	}
	w = request("PATCH", "/api/developer/brand-clouds/"+cloudA, `{"name":"Renamed"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"tenant_slug":"camera-lab"`) {
		t.Fatalf("edit %d %s", w.Code, w.Body.String())
	}
	w = request("POST", "/api/developer/brand-clouds", `{"name":"Created"}`)
	if w.Code != 201 || !strings.Contains(w.Body.String(), `"name":"Created"`) {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	w = request("GET", "/api/developer/brand-clouds/"+cloudA+"/deletion-preflight", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"eligible":true`) {
		t.Fatalf("preflight %d %s", w.Code, w.Body.String())
	}
	w = request("DELETE", "/api/developer/brand-clouds/"+cloudA, "")
	if w.Code != 202 || w.Header().Get("Location") != "/api/developer/brand-clouds/"+cloudA+"/operations/"+productA {
		t.Fatalf("delete %d %s", w.Code, w.Body.String())
	}
	w = request("GET", w.Header().Get("Location"), "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"succeeded"`) {
		t.Fatalf("operation %d %s", w.Code, w.Body.String())
	}
	stored, err := st.GetSession(session.ID)
	if err != nil || stored.ActiveOrgID != cloudA || stored.Kind != "platform_admin" {
		t.Fatal("explicit requests mutated shared session", err)
	}
	f.mu.Lock()
	f.deny = true
	f.mu.Unlock()
	w = request("GET", "/api/developer/brand-clouds/"+cloudA, "")
	if w.Code != 403 || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("revocation %d %s", w.Code, w.Body.String())
	}
}

func TestManagedCloudBFFRejectsAmbiguousWrites(t *testing.T) {
	upstream, f := managedCloudFixtureServer(t)
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner-1", "owner@example.test", "fixture-access", "", cloudA, time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	for _, tc := range []struct{ body, origin, key string }{
		{`{"name":"one","name":"two"}`, "", "key"}, {`{"owner_user_id":"other"}`, "", "key"}, {`{"name":null}`, "", "key"}, {`{"name":"x"} {}`, "", "key"}, {`[]`, "", "key"}, {`{"name":"x"}`, "https://evil.example", "key"}, {`{"name":"x"}`, "", ""},
	} {
		r := httptest.NewRequest("POST", "/api/developer/brand-clouds", strings.NewReader(tc.body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", tc.key)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 && w.Code != 403 {
			t.Fatalf("invalid input accepted %d", w.Code)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 0 {
		t.Fatalf("invalid write reached upstream %v", f.calls)
	}
}

func TestManagedCloudBFFInvalidatesExpiredSessionAndSanitizesErrors(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 409, 422, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`secret upstream diagnostic`))
			}))
			defer upstream.Close()
			st := mustOpenStore(t)
			session, _ := st.CreateSession("customer", "owner-1", "owner@example.test", "global-access", "", cloudA, time.Hour)
			s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
			r := httptest.NewRequest("GET", "/api/developer/brand-clouds/"+cloudA, nil)
			r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			want := status
			if want == 500 {
				want = 502
			}
			if w.Code != want || strings.Contains(w.Body.String(), "secret") || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("unsafe status/body: %d %s", w.Code, w.Body.String())
			}
			if status == 401 {
				if _, err := st.GetSession(session.ID); err == nil {
					t.Fatal("expired upstream identity retained local session")
				}
				if len(w.Result().Cookies()) != 1 || w.Result().Cookies()[0].MaxAge >= 0 {
					t.Fatal("session cookie was not cleared")
				}
			}
		})
	}
}

func TestManagedCloudBFFRejectsInvalidQueriesAndUnauthenticatedAccounts(t *testing.T) {
	upstream, f := managedCloudFixtureServer(t)
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner-1", "owner@example.test", "global-access", "", cloudA, time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	for _, query := range []string{"view=unknown", "view=all&view=shared", "limit=0", "limit=101", "offset=-1", "owner_user_id=other"} {
		r := httptest.NewRequest("GET", "/api/developer/brand-clouds?"+query, nil)
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("query %q: %d", query, w.Code)
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/api/developer/brand-clouds", nil))
	if w.Code != 401 {
		t.Fatalf("anonymous request: %d", w.Code)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 0 {
		t.Fatal("invalid request reached upstream", f.calls)
	}
}

// Explicit disposable browser fixture; never compiled into cmd/server routes.
func TestManagedCloudBrowserFixture(t *testing.T) {
	if os.Getenv("MULTICLOUD_UI_FIXTURE") != "1" {
		t.Skip("local browser fixture only")
	}
	t.Chdir("../..")
	upstream, f := managedCloudFixtureServer(t)
	st := mustOpenStore(t)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	session, err := st.CreateSession("customer", "owner-1", "demo@example.test", "fixture-access", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:18192")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	fmt.Println("Disposable multi-cloud browser fixture: http://127.0.0.1:18192")
	// Synthetic fixture account only; no real credentials or login bypass exists
	// in the production server. Both tabs use this same disposable session.
	fixture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__fixture__/state" {
			f.mu.Lock()
			defer f.mu.Unlock()
			current, _ := st.GetSession(session.ID)
			writeJSON(w, map[string]any{"calls": f.calls, "keys": f.keys, "active_org_id": current.ActiveOrgID})
			return
		}
		if r.URL.Path == "/__fixture__/deny" && r.Method == "POST" {
			f.mu.Lock()
			f.deny = true
			f.mu.Unlock()
			w.WriteHeader(204)
			return
		}
		r.Header.Set("Cookie", "rtk_admin_session="+session.ID)
		s.ServeHTTP(w, r)
	})
	if err := http.Serve(listener, fixture); err != nil {
		t.Fatal(err)
	}
}
