package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlatformPKIProxyRequiresSessionAndSameOrigin(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/platform/pki/issuers/search" || r.Header.Get("Authorization") != "Bearer access" || r.Header.Get("Idempotency-Key") != "pki-test" {
			t.Errorf("wrong proxy identity/path")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"items":[]}`))
	}))
	defer upstream.Close()
	srv, session := newDeveloperPKITestServer(t, upstream.URL, "")
	for _, tc := range []struct {
		session, origin string
		want            int
	}{{"", "", 401}, {session, "https://other.example", 403}, {session, "http://example.com", 200}} {
		req := developerPKIRequest(t, tc.session, "/api/platform/pki/issuers/search", "pki-test", `{"limit":25}`)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", tc.origin)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("status %d want %d: %s", rec.Code, tc.want, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("unauthorized call reached upstream: %d", calls)
	}
}

func TestPlatformPKIStepUpBindsStateAndSubject(t *testing.T) {
	for _, tc := range []struct {
		name, subject  string
		controllerDown bool
	}{{"same-user", "user-1", false}, {"different-user", "other-user", false}, {"controller-outage", "user-1", true}} {
		subject := tc.subject
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/auth/oidc/pki/login":
					if r.URL.Query().Get("pki_step_up") != "true" {
						t.Error("missing step-up")
					}
					http.Redirect(w, r, "https://idp.example/authorize?state=fixture-state", 302)
				case "/v1/auth/oidc/pki/callback":
					json.NewEncoder(w).Encode(map[string]any{"user": map[string]string{"id": subject}, "tokens": map[string]string{"access_token": "mfa-access", "refresh_token": "mfa-refresh"}})
				case "/v1/platform/pki/issuers/search":
					if tc.controllerDown {
						http.Error(w, "controller unavailable", 503)
						return
					}
					if r.Header.Get("Authorization") != "Bearer mfa-access" {
						t.Error("did not validate new token")
					}
					w.Write([]byte(`{"items":[]}`))
				case "/v1/platform/admin-recovery":
					if !tc.controllerDown || r.Method != "GET" || r.Header.Get("Authorization") != "Bearer mfa-access" {
						t.Error("invalid recovery authority probe")
					}
					w.Write([]byte(`{"status":"authorized"}`))
				default:
					t.Errorf("unexpected upstream path %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			srv, session := newDeveloperPKITestServer(t, upstream.URL, "")
			req := developerPKIRequest(t, session, "/api/pki/login", "", `{"provider":"pki"}`)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != 200 {
				t.Fatalf("start: %d %s", rec.Code, rec.Body.String())
			}
			cookies := rec.Result().Cookies()
			if len(cookies) != 1 || !cookies[0].HttpOnly {
				t.Fatal("missing bound state cookie")
			}
			callback := httptest.NewRequest("GET", "/api/pki/oidc/pki/callback?code=code&state=fixture-state", nil)
			callback.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session})
			// Missing state cookie must fail without exchanging the authorization code.
			denied := httptest.NewRecorder()
			srv.ServeHTTP(denied, callback)
			if denied.Code != 403 {
				t.Fatal("missing state accepted")
			}
			callback.AddCookie(cookies[0])
			rec = httptest.NewRecorder()
			srv.ServeHTTP(rec, callback)
			want := 303
			if subject != "user-1" {
				want = 403
			}
			if rec.Code != want {
				t.Fatalf("callback: %d want %d: %s", rec.Code, want, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "mfa-access") {
				t.Fatal("token leaked to browser")
			}
			updated, err := srv.sessions.GetSession(session)
			if err != nil {
				t.Fatal(err)
			}
			if subject == "user-1" && updated.AccessToken != "mfa-access" {
				t.Fatal("step-up token not saved")
			}
			if subject != "user-1" && updated.AccessToken != "access" {
				t.Fatal("different subject replaced session")
			}
		})
	}
}
