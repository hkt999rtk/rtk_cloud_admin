package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminRecoveryProxyUsesAccountManagerDirectly(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/platform/admin-recovery" || r.Header.Get("Authorization") != "Bearer access" {
			t.Error("recovery used wrong upstream or identity")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"request_id":"fixture","status":"requested"}`))
	}))
	defer upstream.Close()
	server, session := newDeveloperPKITestServer(t, upstream.URL, "")
	for _, tc := range []struct {
		session, origin string
		want            int
	}{{"", "", 401}, {session, "https://attacker.example", 403}, {session, "http://example.com", 200}} {
		req := developerPKIRequest(t, tc.session, "/api/platform/admin-recovery", "fixture-key", `{"target_user_id":"target","reason":"incident"}`)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", tc.origin)
		rec := httptest.NewRecorder()
		server.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("status %d want %d: %s", rec.Code, tc.want, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("unexpected upstream calls %d", calls)
	}
}
