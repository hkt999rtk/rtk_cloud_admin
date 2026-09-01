package app

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestSelectAccountViewDestinationsAndCapabilities(t *testing.T) {
	for _, tc := range []struct {
		next             string
		member, platform bool
		want             string
	}{
		{"", true, true, "customer"},
		{"", false, true, "platform_admin"},
		{"", true, false, "customer"},
		{"", false, false, "customer"},
		{"/admin?tab=health#status", true, true, "platform_admin"},
		{" /admin#status ", true, true, "platform_admin"},
		{"/admin/health?tab=live", true, true, "platform_admin"},
		{"/console?cloud=brand-1", true, true, "customer"},
		{"/admin?tab=health", true, false, "customer"},
		{"/console#status", false, true, "platform_admin"},
		{"/admin", false, false, "customer"},
		{"/administrator", true, true, "customer"},
		{"https://example.com/admin", true, true, "customer"},
		{"//example.com/admin", true, true, "customer"},
		{`/admin\evil`, true, true, "customer"},
		{"/admin/%invalid", true, true, "customer"},
		{"/admin/../console", true, true, "customer"},
		{"/console/../admin", true, true, "platform_admin"},
		{"/%61dmin", true, true, "customer"},
	} {
		t.Run(fmt.Sprintf("%s/%t/%t", tc.next, tc.member, tc.platform), func(t *testing.T) {
			if got := selectAccountView(tc.next, tc.member, tc.platform); got != tc.want {
				t.Fatalf("view = %q, want %q", got, tc.want)
			}
		})
	}
}

type failingViewTokenStore struct{ sessionStore }

func (s failingViewTokenStore) UpdateSessionTokens(string, string, string, time.Duration) error {
	return errors.New("session token persistence failed")
}

func TestAccountViewPreservesAccountSessionAndRotatedTokens(t *testing.T) {
	for _, tc := range []struct {
		name, body, initialKind, profile              string
		fresh, invalidRefresh, failedWrite, noSession bool
		profileStatus, wantStatus                     int
		wantKind                                      string
	}{
		{name: "dual role rotates and switches", body: `{"view":"platform"}`, wantStatus: 200, wantKind: "platform_admin"},
		{name: "same customer view", body: `{"view":"customer"}`, wantStatus: 200, wantKind: "customer"},
		{name: "platform to customer", body: `{"view":"customer"}`, initialKind: "platform_admin", wantStatus: 200, wantKind: "customer"},
		{name: "fresh session", body: `{"view":"platform"}`, fresh: true, wantStatus: 200, wantKind: "platform_admin"},
		{name: "forbidden view retains rotated tokens", body: `{"view":"platform"}`, profile: `{"brand_cloud_memberships":[{"id":"brand-1","role":"owner"}]}`, wantStatus: 403, wantKind: "customer"},
		{name: "no memberships can open My Clouds", body: `{"view":"customer"}`, initialKind: "platform_admin", profile: `{"platform_capabilities":["platform.audit.read"]}`, wantStatus: 200, wantKind: "customer"},
		{name: "profile failure retains rotated tokens", body: `{"view":"platform"}`, profileStatus: 503, wantStatus: 502, wantKind: "customer"},
		{name: "invalid refresh clears session", body: `{"view":"platform"}`, invalidRefresh: true, wantStatus: 401},
		{name: "persistence failure clears session", body: `{"view":"platform"}`, failedWrite: true, wantStatus: 500},
		{name: "invalid view rejected before upstream", body: `{"view":"root"}`, wantStatus: 400, wantKind: "customer"},
		{name: "invalid body rejected before upstream", body: `{`, wantStatus: 400, wantKind: "customer"},
		{name: "authentication required", body: `{"view":"platform"}`, noSession: true, wantStatus: 401, wantKind: "customer"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls, refreshCalls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch r.URL.Path {
				case "/v1/me":
					if r.Header.Get("Authorization") == "Bearer expired-access" {
						http.Error(w, "expired", http.StatusUnauthorized)
						return
					}
					if r.Header.Get("Authorization") != "Bearer current-access" {
						t.Error("profile used an unexpected token")
					}
					if tc.profileStatus != 0 {
						w.WriteHeader(tc.profileStatus)
					}
					profile := tc.profile
					if profile == "" {
						profile = `{"user":{"id":"u1","email":"owner@example.com"},"brand_cloud_memberships":[{"id":"brand-1","role":"owner"},{"id":"brand-2","role":"member"}],"platform_capabilities":["platform.audit.read"]}`
					}
					_, _ = w.Write([]byte(profile))
				case "/v1/auth/refresh":
					if refreshCalls.Add(1) != 1 {
						t.Error("refresh grant reused")
					}
					if tc.invalidRefresh {
						http.Error(w, "revoked", http.StatusUnauthorized)
						return
					}
					_, _ = w.Write([]byte(`{"tokens":{"access_token":"current-access","refresh_token":"rotated-refresh","expires_in":3600}}`))
				default:
					t.Errorf("view switching must not log in again: %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			st := mustOpenStore(t)
			kind := tc.initialKind
			if kind == "" {
				kind = "customer"
			}
			access := "expired-access"
			if tc.fresh {
				access = "current-access"
			}
			session, err := st.CreateSession(kind, "u1", "owner@example.com", access, "original-refresh", "brand-2", time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			srv := NewWithOptions(st, Options{Config: customerPasswordLoginConfig(upstream.URL), AccountClient: accountclient.New(upstream.URL)})
			if tc.failedWrite {
				srv.sessions = failingViewTokenStore{srv.sessions}
			}
			req := httptest.NewRequest(http.MethodPost, "/api/me/view", strings.NewReader(tc.body))
			cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
			if !tc.noSession {
				req.AddCookie(cookie)
			}
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			saved, err := st.GetSession(session.ID)
			if tc.invalidRefresh || tc.failedWrite {
				if !errors.Is(err, sql.ErrNoRows) {
					t.Fatalf("invalid session not removed: %v", err)
				}
				cookies := rec.Result().Cookies()
				if len(cookies) != 1 || cookies[0].MaxAge >= 0 {
					t.Fatal("invalid session cookie not cleared")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if saved.ID != session.ID || saved.Subject != session.Subject || saved.ActiveOrgID != "brand-2" || saved.Kind != tc.wantKind {
				t.Fatal("view changed account identity, active Brand Cloud, or selected the wrong view")
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Fatal("view switch must keep the existing session cookie")
			}
			if tc.wantStatus == 400 || tc.noSession {
				if calls.Load() != 0 || saved.AccessToken != access {
					t.Fatal("rejected request contacted upstream or changed tokens")
				}
				return
			}
			wantRefresh := "rotated-refresh"
			if tc.fresh {
				wantRefresh = "original-refresh"
			}
			if saved.AccessToken != "current-access" || saved.RefreshToken != wantRefresh {
				t.Fatal("current upstream tokens were not retained")
			}
			// The next request uses the very same cookie and must not reuse the old grant.
			if tc.profileStatus == 0 {
				meReq := httptest.NewRequest(http.MethodGet, "/api/me", nil)
				meReq.AddCookie(cookie)
				meRec := httptest.NewRecorder()
				srv.ServeHTTP(meRec, meReq)
				if meRec.Code != 200 {
					t.Fatalf("same-session me status=%d", meRec.Code)
				}
			}
			wantRefreshCalls := int32(1)
			if tc.fresh {
				wantRefreshCalls = 0
			}
			if refreshCalls.Load() != wantRefreshCalls {
				t.Fatalf("refresh count=%d", refreshCalls.Load())
			}
		})
	}
}
