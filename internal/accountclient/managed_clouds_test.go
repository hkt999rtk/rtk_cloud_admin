package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManagedCloudCommandRejectsMalformedScope(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const operation = "22222222-2222-4222-8222-222222222222"
	for _, tc := range []struct {
		name, method, action, response string
		valid                          bool
	}{
		{"detail", "GET", "", `{"brand_cloud":{"id":"` + cloud + `"}}`, true},
		{"wrong cloud", "GET", "", `{"brand_cloud":{"id":"wrong"}}`, false},
		{"missing cloud", "PATCH", "", `{}`, false},
		{"preflight", "GET", "deletion-preflight", `{"eligible":true,"blockers":[]}`, true},
		{"blocked preflight", "GET", "deletion-preflight", `{"eligible":false,"blockers":[{"code":"balance_not_zero"}]}`, true},
		{"missing eligibility", "GET", "deletion-preflight", `{}`, false},
		{"contradictory eligibility", "GET", "deletion-preflight", `{"eligible":true,"blockers":[{"code":"balance_not_zero"}]}`, false},
		{"delete", "DELETE", "", `{"operation":{"id":"` + operation + `","brand_cloud_id":"` + cloud + `"}}`, true},
		{"missing operation", "DELETE", "", `{}`, false},
		{"unsafe operation ID", "DELETE", "", `{"operation":{"id":"../wrong","brand_cloud_id":"` + cloud + `"}}`, false},
		{"wrong operation cloud", "DELETE", "", `{"operation":{"id":"` + operation + `","brand_cloud_id":"wrong"}}`, false},
		{"poll", "GET", "operations/" + operation, `{"operation":{"id":"` + operation + `","brand_cloud_id":"` + cloud + `"}}`, true},
		{"different operation", "GET", "operations/" + operation, `{"operation":{"id":"` + cloud + `","brand_cloud_id":"` + cloud + `"}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer global-token" || r.Header.Get("Idempotency-Key") != "same-intent" {
					t.Error("missing global identity or idempotency header")
				}
				_, _ = w.Write([]byte(tc.response))
			}))
			defer upstream.Close()
			_, err := New(upstream.URL).ManagedCloudCommand(context.Background(), "global-token", tc.method, cloud, tc.action, "same-intent", nil)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}

func TestManagedCloudsRequiresQuotaAndStripsSecrets(t *testing.T) {
	for _, body := range []string{`{}`, `{"brand_clouds":[]}`, `{"brand_clouds":[],"owned_limit":0}`} {
		t.Run(body, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer upstream.Close()
			if _, err := New(upstream.URL).ManagedClouds(context.Background(), "global-token", nil); err == nil {
				t.Fatal("missing quota must not be invented")
			}
		})
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"brand_clouds":[{"id":"cloud","metadata":{"private_key":"secret"},"payment_method":"secret"}],"owned_limit":8}`))
	}))
	defer upstream.Close()
	page, err := New(upstream.URL).ManagedClouds(context.Background(), "global-token", nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(page)
	if err != nil || strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "metadata") {
		t.Fatalf("unsafe response: %s (%v)", raw, err)
	}
}
