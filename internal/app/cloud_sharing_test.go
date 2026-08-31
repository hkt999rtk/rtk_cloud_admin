package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestCloudSharingScopeAndIdentity(t *testing.T) {
	const target = "44444444-4444-4444-8444-444444444444"
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer global" || r.Header.Get("X-Billing-Owner-User-ID") != "" {
			t.Error("wrong identity/header")
		}
		if r.URL.Path == "/v1/developer/brand-clouds/"+cloudA {
			_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloudA, MyRole: "owner", Capabilities: []string{"team.manage"}}})
			return
		}
		if r.URL.Path == "/v1/developer/brand-clouds/"+cloudB {
			_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloudB, MyRole: "viewer", Capabilities: []string{"product.read"}}})
			return
		}
		if r.Method != "GET" && r.Header.Get("Idempotency-Key") != "same-intent" {
			t.Error("idempotency key not forwarded")
		}
		scope := &accountclient.CloudAccessScope{Kind: "selected_products", ProductIDs: []string{productA}}
		member := accountclient.Member{OrganizationID: cloudA, UserID: target, Role: "viewer", AccessScope: scope}
		invite := accountclient.BrandCloudMemberInvitation{ID: productA, BrandCloudID: cloudA, TargetUserID: target, TargetEmail: "other@example.test", Role: "viewer", AccessScope: scope}
		if r.Method == "DELETE" {
			w.WriteHeader(204)
			return
		}
		if r.Method == "GET" {
			if strings.HasSuffix(r.URL.Path, "/invitations") {
				_ = json.NewEncoder(w).Encode(map[string]any{"invitations": []any{invite}})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"members": []any{member}, "pagination": accountclient.Pagination{Limit: 25, Total: 1}})
			}
			return
		}
		var body accountclient.CloudSharingWrite
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.HasSuffix(r.URL.Path, "/invitations") || (r.Method == "PATCH" && strings.HasSuffix(r.URL.Path, target)) {
			if body.AccessScope == nil || body.AccessScope.Kind != "selected_products" || len(body.AccessScope.ProductIDs) != 1 || body.AccessScope.ProductIDs[0] != productA {
				t.Error("Product scope lost", body)
			}
		}
		if strings.Contains(r.URL.Path, "invitations") {
			_ = json.NewEncoder(w).Encode(map[string]any{"invitation": invite, "member": member})
		} else {
			_ = json.NewEncoder(w).Encode(map[string]any{"member": member})
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("platform_admin", "owner", "owner@example.test", "global", "", cloudB, time.Hour)
	inviteeSession, _ := st.CreateSession("customer", target, "other@example.test", "global", "", "", time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	body := `{"role":"viewer","access_scope":{"kind":"selected_products","product_ids":["` + productA + `"]}}`
	base := "/api/developer/brand-clouds/" + cloudA + "/members"
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", base + "?limit=25", "", 200}, {"GET", base + "/invitations", "", 200},
		{"POST", base + "/invitations", `{"email":"other@example.test",` + body[1:], 202},
		{"PATCH", base + "/" + target, body, 200}, {"PATCH", base + "/" + target + "/disable", `{}`, 200},
		{"POST", base + "/invitations/" + productA + "/resend", `{}`, 202}, {"POST", base + "/invitations/" + productA + "/cancel", `{}`, 200},
		{"DELETE", base + "/" + target, "", 204},
		{"POST", "/api/developer/brand-cloud-member-invitations/accept", `{"token":"fixture-only"}`, 200},
		{"GET", "/api/developer/brand-clouds/" + cloudB + "/members", "", 403},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		sessionID := session.ID
		if strings.HasSuffix(tc.path, "/accept") {
			sessionID = inviteeSession.ID
		}
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "same-intent")
		r.Header.Set("X-Billing-Owner-User-ID", "forged")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
		if tc.status == 200 && tc.method == "GET" && !strings.Contains(w.Body.String(), "access_scope") {
			t.Fatal("scope lost on readback")
		}
	}
	stored, err := st.GetSession(session.ID)
	if err != nil || stored.Kind != "platform_admin" || stored.ActiveOrgID != cloudB {
		t.Fatal("sharing mutated account scope", err)
	}
	r := httptest.NewRequest("POST", "/api/developer/brand-cloud-member-invitations/accept", strings.NewReader(`{"token":"fixture-only"}`))
	r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", "same-intent")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 502 {
		t.Fatal("accepted membership for a different global account", w.Code)
	}
	if calls == 0 {
		t.Fatal("missing upstream calls")
	}
}

func TestCloudSharingRejectsAmbiguousOrOwnerWrites(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("invalid write reached upstream")
		w.WriteHeader(500)
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "owner", "owner@example.test", "global", "", cloudA, time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	for _, body := range []string{
		`{"email":"x@example.test","role":"owner"}`,
		`{"email":"x@example.test","role":"viewer"}`,
		`{"email":"x@example.test","role":"viewer","access_scope":null}`,
		`{"email":"x@example.test","role":"viewer","access_scope":{"kind":"selected_products","kind":"all_products"}}`,
		`{"email":"x@example.test","role":"viewer","access_scope":{"kind":"selected_products","product_ids":[]}}`,
		`{"email":"x@example.test","role":"viewer","access_scope":{"kind":"all_products","product_ids":[]}}`,
		`{"email":"x@example.test","role":"viewer","access_scope":{"kind":"all_products","extra":true}}`,
		`{"email":"x@example.test","role":"admin"} {}`, `[]`, `null`,
		`{"email":"x@example.test","role":"viewer","access_scope":{"kind":"selected_products","product_ids":["` + productA + `","` + productA + `"]}}`,
	} {
		r := httptest.NewRequest("POST", "/api/developer/brand-clouds/"+cloudA+"/members/invitations", strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "key")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("body %s: %d %s", body, w.Code, w.Body.String())
		}
	}
	r := httptest.NewRequest("POST", "/api/developer/brand-clouds/"+cloudA+"/members/invitations", strings.NewReader(`{"email":"x@example.test","role":"member"}`))
	r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", "key")
	r.Header.Set("Origin", "https://untrusted.example")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("cross-origin sharing accepted: %d", w.Code)
	}
}
