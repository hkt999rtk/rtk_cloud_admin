package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestProductProductionRunBoundary(t *testing.T) {
	upstream, fixture := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	root := "/api/developer/brand-clouds/" + cloudA + "/products/" + productA + "/production-runs"
	request := func(method, path, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Idempotency-Key", "factory-intent-a")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	valid := `{"factory_id":"line-a","batch_id":"batch-a","allowed_quantity":25,"valid_hours":24}`
	if got := request("GET", root, "", ""); got.Code != 200 || strings.Contains(got.Body.String(), "factory_jwt") {
		t.Fatalf("list before setup: %d %s", got.Code, got.Body)
	}
	if got := request("POST", root, valid, ""); got.Code != 503 {
		t.Fatalf("unconfigured endpoint: %d %s", got.Code, got.Body)
	}
	s.cfg.FactoryEnrollPublicBaseURL = "https://factory-enroll.example.test"
	missingKey := httptest.NewRequest(http.MethodPost, root, strings.NewReader(valid))
	missingKey.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	missingKeyResult := httptest.NewRecorder()
	s.ServeHTTP(missingKeyResult, missingKey)
	if missingKeyResult.Code != http.StatusBadRequest {
		t.Fatalf("missing creation key: %d", missingKeyResult.Code)
	}
	for _, tc := range []struct {
		method, path, body, origin string
		want                       int
	}{
		{"POST", root, valid, "https://evil.example.test", 403},
		{"POST", root, `{"factory_id":"INVALID","batch_id":"batch-a","allowed_quantity":25,"valid_hours":24}`, "", 400},
		{"POST", root, `{"factory_id":"line-a","batch_id":"batch-a","allowed_quantity":25,"valid_hours":169}`, "", 400},
		{"POST", root, `{"factory_id":"line-a","batch_id":"batch-a","allowed_quantity":25,"valid_hours":24,"extra":"x"}`, "", 400},
		{"GET", "/api/developer/brand-clouds/" + cloudB + "/products/" + productA + "/production-runs", "", "", 404},
	} {
		got := request(tc.method, tc.path, tc.body, tc.origin)
		if got.Code != tc.want {
			t.Errorf("%s %s: %d want %d: %s", tc.method, tc.path, got.Code, tc.want, got.Body)
		}
	}
	created := request("POST", root, valid, "")
	if created.Code != 201 || !strings.Contains(created.Body.String(), "fixture-secret-shown-once") {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	fixture.mu.Lock()
	if len(fixture.keys) != 1 || fixture.keys[0] != "factory-intent-a" {
		t.Errorf("creation key not forwarded: %v", fixture.keys)
	}
	fixture.mu.Unlock()
	listed := request("GET", root, "", "")
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), "batch-a") || strings.Contains(listed.Body.String(), "fixture-secret-shown-once") {
		t.Fatalf("list redaction: %d %s", listed.Code, listed.Body)
	}
	s.cfg.FactoryEnrollPublicBaseURL = ""
	stopped := request("POST", root+"/"+fixtureProductionRunID+"/stop", "", "")
	if stopped.Code != 200 || !strings.Contains(stopped.Body.String(), `"status":"disabled"`) {
		t.Fatalf("stop: %d %s", stopped.Code, stopped.Body)
	}
}
