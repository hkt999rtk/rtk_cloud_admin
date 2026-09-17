package accountclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func TestPKIAndRecoveryClientRoutes(t *testing.T) {
	const operationID = "11111111-1111-4111-8111-111111111111"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/v1/platform/") {
			if req.Header.Get("Authorization") != "Bearer token" ||
				req.Header.Get("Content-Type") != "application/json" ||
				req.Header.Get("Idempotency-Key") != "intent-1" {
				t.Fatalf("unexpected PKI headers: %#v", req.Header)
			}
		}
		switch req.URL.Path {
		case "/v1/platform/pki/issuers":
			if req.Method != http.MethodPost {
				t.Fatalf("method = %s", req.Method)
			}
			_, _ = w.Write([]byte(`{"issuers":[]}`))
		case "/v1/platform/pki/operations/" + operationID + "/cancel":
			w.WriteHeader(http.StatusNoContent)
		case "/v1/platform/admin-recovery":
			_, _ = w.Write([]byte(`{"requests":[]}`))
		case "/v1/platform/admin-recovery/" + operationID + "/approve":
			_, _ = w.Write([]byte(`{"status":"approved"}`))
		case "/v1/auth/oidc/google/login":
			http.Redirect(w, req, "https://idp.example.test/authorize?state=state-1", http.StatusFound)
		case "/v1/auth/oidc/google/callback":
			if req.URL.Query().Get("code") != "code-1" || req.URL.Query().Get("state") != "state-1" {
				t.Fatalf("callback query = %s", req.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"user":{"id":"user-1"},"tokens":{"access_token":"access"}}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()
	client := New(server.URL)

	got, err := client.PKI(t.Context(), "token", http.MethodPost, "/issuers", "intent-1", json.RawMessage(`{"provider":"openbao"}`))
	if err != nil || string(got) != `{"issuers":[]}` {
		t.Fatalf("PKI response = %s, %v", got, err)
	}
	got, err = client.PKI(t.Context(), "token", http.MethodPost, "/operations/"+operationID+"/cancel", "intent-1", nil)
	if err != nil || string(got) != "null" {
		t.Fatalf("PKI no-content response = %s, %v", got, err)
	}
	got, err = client.AdminRecovery(t.Context(), "token", http.MethodGet, "", "intent-1", nil)
	if err != nil || string(got) != `{"requests":[]}` {
		t.Fatalf("recovery response = %s, %v", got, err)
	}
	got, err = client.AdminRecovery(t.Context(), "token", http.MethodPost, "/"+operationID+"/approve", "intent-1", json.RawMessage(`{"reason":"verified"}`))
	if err != nil || string(got) != `{"status":"approved"}` {
		t.Fatalf("recovery approval = %s, %v", got, err)
	}
	location, state, err := client.StartPKIOIDC(t.Context(), "google")
	if err != nil || state != "state-1" || !strings.HasPrefix(location, "https://idp.example.test/") {
		t.Fatalf("OIDC start = %q, %q, %v", location, state, err)
	}
	login, err := client.CompletePKIOIDC(t.Context(), "google", "code-1", "state-1")
	if err != nil || login.Tokens.AccessToken != "access" {
		t.Fatalf("OIDC completion = %#v, %v", login, err)
	}
}

func TestPKIAndRecoveryClientRejectInvalidInputsAndResponses(t *testing.T) {
	client := New("https://account.example.test")
	for _, call := range []struct {
		name string
		fn   func() error
	}{
		{name: "PKI path", fn: func() error {
			_, err := client.PKI(t.Context(), "token", http.MethodDelete, "/issuers", "", nil)
			return err
		}},
		{name: "recovery path", fn: func() error {
			_, err := client.AdminRecovery(t.Context(), "token", http.MethodDelete, "/bad", "", nil)
			return err
		}},
		{name: "OIDC start provider", fn: func() error {
			_, _, err := client.StartPKIOIDC(t.Context(), "../google")
			return err
		}},
		{name: "OIDC completion provider", fn: func() error {
			_, err := client.CompletePKIOIDC(t.Context(), "../google", "code", "state")
			return err
		}},
	} {
		t.Run(call.name, func(t *testing.T) {
			if err := call.fn(); err == nil {
				t.Fatal("invalid input unexpectedly passed")
			}
		})
	}

	responses := []struct {
		name   string
		status int
		body   string
		call   func(*Client) error
	}{
		{name: "PKI rejection", status: http.StatusForbidden, body: `{"error":"denied"}`, call: func(c *Client) error {
			_, err := c.PKI(t.Context(), "token", http.MethodGet, "/issuers", "", nil)
			return err
		}},
		{name: "PKI invalid JSON", status: http.StatusOK, body: "{", call: func(c *Client) error {
			_, err := c.PKI(t.Context(), "token", http.MethodGet, "/issuers", "", nil)
			return err
		}},
		{name: "recovery invalid JSON", status: http.StatusOK, body: "{", call: func(c *Client) error {
			_, err := c.AdminRecovery(t.Context(), "token", http.MethodGet, "", "", nil)
			return err
		}},
		{name: "OIDC unexpected status", status: http.StatusOK, body: "{}", call: func(c *Client) error {
			_, _, err := c.StartPKIOIDC(t.Context(), "google")
			return err
		}},
		{name: "OIDC invalid redirect", status: http.StatusFound, body: "", call: func(c *Client) error {
			_, _, err := c.StartPKIOIDC(t.Context(), "google")
			return err
		}},
	}
	for _, test := range responses {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			if err := test.call(New(server.URL)); err == nil {
				t.Fatal("invalid upstream response unexpectedly passed")
			}
		})
	}
}

func TestPKIRequestBoundsAndTransportErrors(t *testing.T) {
	client := New("https://account.example.test")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("transport failed")
	})}
	if _, err := client.PKI(t.Context(), "token", http.MethodGet, "/issuers", "", nil); err == nil {
		t.Fatal("transport failure unexpectedly passed")
	}

	client.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(failingReader{})}, nil
	})}
	if _, err := client.PKI(t.Context(), "token", http.MethodGet, "/issuers", "", nil); err == nil {
		t.Fatal("response read failure unexpectedly passed")
	}

	client.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(make([]byte, (2<<20)+1)))}, nil
	})}
	if _, err := client.PKI(t.Context(), "token", http.MethodGet, "/issuers", "", nil); err == nil {
		t.Fatal("oversized response unexpectedly passed")
	}

	if _, err := client.PKI(t.Context(), "token", http.MethodPost, "/issuers", "", json.RawMessage("{")); err == nil {
		t.Fatal("invalid request JSON unexpectedly passed")
	}

	badURL := &Client{baseURL: "://bad", httpClient: http.DefaultClient}
	if _, err := badURL.PKI(context.Background(), "token", http.MethodGet, "/issuers", "", nil); err == nil {
		t.Fatal("invalid request URL unexpectedly passed")
	}
}
