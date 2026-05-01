package accountclient

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientLoginAndMe(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/login":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"tokens":{"access_token":"access","refresh_token":"refresh","expires_in":3600}}`))
		case "/v1/me":
			if got := r.Header.Get("Authorization"); got != "Bearer access" {
				t.Fatalf("Authorization = %q", got)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"user":{"id":"u1","email":"user@example.com","name":"User"},"organizations":[{"id":"org-1","name":"Acme","role":"owner"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := New(upstream.URL)
	login, err := client.Login(t.Context(), "user@example.com", "pw")
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if login.Tokens.AccessToken != "access" {
		t.Fatalf("access token = %q", login.Tokens.AccessToken)
	}
	me, err := client.Me(t.Context(), login.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("Me returned error: %v", err)
	}
	if len(me.Organizations) != 1 || me.Organizations[0].ID != "org-1" {
		t.Fatalf("organizations = %#v", me.Organizations)
	}
}
