package sdkportalclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestExamplesRequestsUseOfficialPathsAndPreserveVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			if r.URL.Path != "/api/pro2-examples/catalog" || r.URL.Query().Get("version") != "0.1.0-dev.2" {
				t.Errorf("unexpected catalog request: %s", r.URL)
			}
		} else if r.URL.Path != "/api/pro2-examples/download" || r.FormValue("artifact") != "mqtt" || r.FormValue("accepted") != "true" {
			t.Errorf("unexpected download request: %s", r.URL)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"test_only":true}`))
	}))
	defer server.Close()
	c, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		body, status, err := c.ExamplesRequest(context.Background(), method, "0.1.0-dev.2", url.Values{"artifact": {"mqtt"}, "accepted": {"true"}})
		if err != nil || status != 200 || string(body) != `{"test_only":true}` {
			t.Fatalf("response: %s %d %v", body, status, err)
		}
	}
}

func TestExamplesUnavailableAndCancelledRequests(t *testing.T) {
	var missing *Client
	if _, status, err := missing.ExamplesRequest(context.Background(), http.MethodGet, "", nil); status != 503 || err == nil {
		t.Fatal("missing Portal accepted")
	}
	c, err := New("https://portal.example")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, status, err := c.ExamplesRequest(ctx, http.MethodGet, "", nil); status != 503 || err == nil {
		t.Fatal("cancelled request accepted")
	}
}
