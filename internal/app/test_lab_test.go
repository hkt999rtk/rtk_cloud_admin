package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"strings"
	"testing"
	"time"
)

func TestLabActionJSONBoundsAndNull(t *testing.T) {
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{"payload":{"state":{"desired":null}}}`, true},
		{`{"offer":{"type":"offer","sdp":"` + strings.Repeat("a", 20000) + `"}}`, true},
		{`{"offer":"` + strings.Repeat("a", 170000) + `"}`, false},
		{`{"unknown":true}`, false},
		{`{} {}`, false},
	} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		var out struct {
			Payload json.RawMessage `json:"payload"`
			Offer   json.RawMessage `json:"offer"`
		}
		if err := decodeLabJSON(httptest.NewRecorder(), r, &out); (err == nil) != tc.valid {
			t.Fatalf("valid=%v err=%v", tc.valid, err)
		}
	}
}

func TestTestLabContextScopeCapabilitiesAndFeatureGate(t *testing.T) {
	up, f := newScopedProductsFixture(t)
	f.mu.Lock()
	d := f.devices[scopedDeviceID]
	d.VideoCloudDevID = "camera-1"
	f.devices[scopedDeviceID] = d
	f.mu.Unlock()
	st := mustOpenStore(t)
	actor, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(up.URL), Config: config.Config{TestLabEnabled: true, Environment: "dev", VideoCloudBaseURL: "http://runtime.invalid"}})
	root := "/api/developer/brand-clouds/" + cloudA + "/test-lab/context?product_id=" + productA + "&device_id=" + scopedDeviceID
	call := func(path string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if authenticated {
			r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: actor.ID})
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	if w := call(root, false); w.Code != 401 {
		t.Fatalf("unauthenticated: %d", w.Code)
	}
	w := call(root, true)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"shadow_http":true`) || !strings.Contains(w.Body.String(), `"shadow_mqtt":true`) || strings.Contains(w.Body.String(), "secret-fixture") {
		t.Fatalf("unsafe context: %d", w.Code)
	}
	f.mu.Lock()
	profile := f.products[productA]
	profile.ServiceOptions = []string{"video_streaming"}
	f.products[productA] = profile
	f.mu.Unlock()
	if w := call(root, true); w.Code != 200 || !strings.Contains(w.Body.String(), `"shadow_http":false`) || !strings.Contains(w.Body.String(), `"shadow_mqtt":false`) {
		t.Fatal("Shadow enabled without MQTT Product service")
	}
	if w := call(root+"&device_id="+sharedDeviceID, true); w.Code != 400 {
		t.Fatalf("duplicate scope: %d", w.Code)
	}
	if w := call(strings.Replace(root, scopedDeviceID, sharedDeviceID, 1), true); w.Code != 404 {
		t.Fatalf("foreign device: %d", w.Code)
	}
	s.cfg.Environment = "production"
	if w := call(root, true); w.Code != 404 {
		t.Fatal("production feature enabled")
	}
}

func TestTestLabSessionRequiresSameOriginAndBoundLogin(t *testing.T) {
	st := mustOpenStore(t)
	actor, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{Config: config.Config{TestLabEnabled: true, Environment: "dev"}})
	path := "/api/developer/brand-clouds/" + cloudA + "/test-lab/sessions/" + productA + "/credentials"
	for _, tc := range []struct {
		origin string
		status int
	}{{"https://foreign.test", 403}, {"", 404}} {
		r := httptest.NewRequest("POST", path, strings.NewReader(`{}`))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: actor.ID})
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("got %d want %d", w.Code, tc.status)
		}
	}
}

func TestTestLabShadowSigningIncludesSessionAndPayload(t *testing.T) {
	creds := labCredentials{}
	creds.AWS.AccessKey = "access"
	creds.AWS.Secret = "secret"
	creds.AWS.Region = "us-east-1"
	creds.AWS.Token = "session"
	r := httptest.NewRequest("POST", "https://cloud.example/things/camera-1/shadow?name=config", nil)
	signLabShadow(r, []byte(`{}`), creds, time.Date(2026, 9, 4, 0, 0, 0, 0, time.UTC))
	if !strings.Contains(r.Header.Get("Authorization"), "/iotdevicegateway/aws4_request") || r.Header.Get("X-Amz-Security-Token") != "session" || len(r.Header.Get("X-Amz-Content-Sha256")) != 64 {
		t.Fatal("invalid signing headers")
	}
}
