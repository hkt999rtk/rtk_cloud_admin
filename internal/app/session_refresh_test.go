package app

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
)

func sessionTestJWT(expiresAt time.Time) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, expiresAt.Unix())))
	return "header." + payload + ".signature"
}

func TestSessionRefreshesBeforeAccessExpiryAcrossConcurrentRequests(t *testing.T) {
	oldAccess := sessionTestJWT(time.Now().Add(10 * time.Second))
	newAccess := sessionTestJWT(time.Now().Add(time.Hour))
	refreshExpiresAt := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	var mu sync.Mutex
	refreshCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/refresh":
			mu.Lock()
			refreshCalls++
			count := refreshCalls
			mu.Unlock()
			if count != 1 {
				http.Error(w, "refresh token already rotated", http.StatusUnauthorized)
				return
			}
			_, _ = fmt.Fprintf(w, `{"tokens":{"access_token":%q,"refresh_token":"refresh-2","access_token_expires_at":%q,"refresh_token_expires_at":%q}}`, newAccess, time.Now().Add(time.Hour).UTC().Format(time.RFC3339), refreshExpiresAt)
		case "/v1/me":
			if r.Header.Get("Authorization") != "Bearer "+newAccess {
				http.Error(w, "expired access token", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com"},"organizations":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	tokens := accountclient.Tokens{AccessToken: oldAccess, RefreshToken: "refresh-1", AccessTokenExpiresAt: time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339), RefreshTokenExpiresAt: refreshExpiresAt}
	if ttl := tokenTTL(tokens); ttl < 23*time.Hour {
		t.Fatalf("session lifetime = %s, want refresh token lifetime", ttl)
	}
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "user@example.com", oldAccess, "refresh-1", "", tokenTTL(tokens))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	srv := NewWithOptions(st, Options{Config: config.Config{AccountManagerBaseURL: upstream.URL}, AccountClient: accountclient.New(upstream.URL)})
	var wg sync.WaitGroup
	results := make(chan int, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
			req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			srv.ServeHTTP(rec, req)
			results <- rec.Code
		}()
	}
	wg.Wait()
	close(results)
	for status := range results {
		if status != http.StatusOK {
			t.Fatalf("concurrent /api/me status = %d, want 200", status)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if refreshCalls != 1 {
		t.Fatalf("refresh calls = %d, want 1", refreshCalls)
	}
	updated, err := st.GetSession(session.ID)
	if err != nil || updated.AccessToken != newAccess || updated.RefreshToken != "refresh-2" {
		t.Fatalf("updated session = %#v, err=%v", updated, err)
	}
}

func TestAccessTokenNearExpiryIgnoresMalformedTokens(t *testing.T) {
	if accessTokenNearExpiry("not-a-jwt") || accessTokenNearExpiry(sessionTestJWT(time.Now().Add(time.Hour))) {
		t.Fatal("unexpected proactive refresh")
	}
	if !accessTokenNearExpiry(sessionTestJWT(time.Now().Add(-time.Minute))) {
		t.Fatal("expired access token should be refreshed")
	}
}
