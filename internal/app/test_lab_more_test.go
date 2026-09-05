package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testLabAccountID = "99999999-9999-4999-8999-999999999999"
	testLabSessionID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)

func TestTestLabManagementRuntimeAndMQTT(t *testing.T) {
	var accountMu sync.Mutex
	accountCalls := make([]string, 0, 16)
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer actor-token" {
			t.Errorf("account authorization = %q", r.Header.Get("Authorization"))
		}
		accountMu.Lock()
		accountCalls = append(accountCalls, r.Method+" "+r.URL.RequestURI())
		accountMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/test-lab/sessions"):
			_ = json.NewEncoder(w).Encode(labSession{
				ID: testLabSessionID, Cloud: cloudA, Product: productA,
				Device: scopedDeviceID, Devid: "camera-1", Account: testLabAccountID,
				Expires: time.Now().Add(5 * time.Minute),
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/"+testLabSessionID+"/credentials"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "runtime-token", "expires_at": time.Now().Add(30 * time.Second),
				"mqtt": map[string]string{"username": "camera-1", "client_id": "console-lab"},
				"aws_credentials": map[string]string{
					"accessKeyId": "access", "secretAccessKey": "secret",
					"sessionToken": "session", "region": "us-east-1",
				},
			})
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/test-lab/sessions/"+testLabSessionID):
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/test-lab/devices/"):
			_, _ = w.Write([]byte(`{"runtime_ready":true}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/test-lab/devices"):
			_, _ = w.Write([]byte(`{"items":[]}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/bind"):
			_, _ = w.Write([]byte(`{"runtime_ready":true}`))
		case r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/test-lab/accounts/"):
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer account.Close()

	var runtimeMu sync.Mutex
	runtimeCalls := make([]string, 0, 8)
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runtimeMu.Lock()
		runtimeCalls = append(runtimeCalls, r.Method+" "+r.URL.RequestURI())
		runtimeMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/things/camera-1/shadow"):
			if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
				t.Errorf("shadow authorization = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"state":{"desired":{"led":true}}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/request_webrtc/ice":
			if r.Header.Get("Authorization") != "Bearer runtime-token" {
				t.Errorf("runtime authorization = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`[{"urls":"stun:example.test"}]`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/request_webrtc":
			_, _ = w.Write([]byte(`{"session_id":"stream-1"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/request_webrtc":
			_, _ = w.Write([]byte(`{"answer":{"type":"answer","sdp":"v=0"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/request_webrtc/close":
			_, _ = w.Write([]byte(`{}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer runtime.Close()

	var mqttHeaders http.Header
	mqtt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mqttHeaders = r.Header.Clone()
		if r.URL.Path != "/mqtt" {
			t.Errorf("mqtt path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mqtt.Close()

	st := mustOpenStore(t)
	actor, err := st.CreateSession("account", "owner-1", "owner@example.test", "actor-token", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{
		AccountClient: accountclient.New(account.URL),
		Config: config.Config{
			TestLabEnabled: true, Environment: "dev", VideoCloudBaseURL: runtime.URL,
			TestLabMQTTURL: "wss://mqtt.example.test/mqtt", TestLabMQTTBackend: mqtt.URL,
		},
	})
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: actor.ID})
		r.Header.Set("Origin", "http://example.com")
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	requireStatus := func(name string, w *httptest.ResponseRecorder, want int) {
		t.Helper()
		if w.Code != want {
			t.Fatalf("%s status=%d body=%s", name, w.Code, w.Body.String())
		}
	}

	manageRoot := "/api/developer/brand-clouds/" + cloudA + "/test-lab/manage"
	requireStatus("list devices", call(http.MethodGet, manageRoot+"/devices?account_id="+testLabAccountID+"&product_id="+productA, ""), http.StatusOK)
	requireStatus("bind", call(http.MethodPost, manageRoot+"/devices/"+scopedDeviceID+"/bind", `{"account_id":"`+testLabAccountID+`","product_id":"`+productA+`"}`), http.StatusOK)
	requireStatus("delete account", call(http.MethodDelete, manageRoot+"/accounts/"+testLabAccountID, ""), http.StatusNoContent)
	requireStatus("invalid manage query", call(http.MethodGet, manageRoot+"/devices?secret=true", ""), http.StatusBadRequest)

	ready, err := s.labBindingReady(context.Background(), "actor-token", cloudA, productA, testLabAccountID, scopedDeviceID)
	if err != nil || !ready {
		t.Fatalf("binding ready=%v err=%v", ready, err)
	}

	sessionRoot := "/api/developer/brand-clouds/" + cloudA + "/test-lab/sessions"
	w := call(http.MethodPost, sessionRoot, `{"product_id":"`+productA+`","device_id":"`+scopedDeviceID+`","account_id":"`+testLabAccountID+`"}`)
	requireStatus("create session", w, http.StatusCreated)
	if !strings.Contains(w.Body.String(), testLabSessionID) {
		t.Fatalf("create session body=%s", w.Body.String())
	}
	actionRoot := sessionRoot + "/" + testLabSessionID
	for _, tc := range []struct {
		name, action, body string
		status             int
	}{
		{"credentials", "credentials", `{}`, http.StatusOK},
		{"shadow", "shadow", `{"name":"console-lab","operation":"get"}`, http.StatusOK},
		{"shadow update", "shadow", `{"name":"console-lab","operation":"update","payload":{"state":{"desired":{"led":false}}}}`, http.StatusOK},
		{"shadow delete", "shadow", `{"name":"console-lab","operation":"delete"}`, http.StatusOK},
		{"ice", "ice", `{}`, http.StatusOK},
		{"offer", "offer", `{"offer":{"type":"offer","sdp":"v=0"}}`, http.StatusOK},
		{"answer", "answer", `{}`, http.StatusOK},
		{"stop", "stop", `{}`, http.StatusOK},
		{"stop idle", "stop", `{}`, http.StatusNoContent},
		{"unknown", "unknown", `{}`, http.StatusNotFound},
	} {
		requireStatus(tc.name, call(http.MethodPost, actionRoot+"/"+tc.action, tc.body), tc.status)
	}
	value, ok := s.testLabSessions.Load(actor.ID + ":" + testLabSessionID)
	if !ok {
		t.Fatal("active Test Lab session was not retained")
	}
	value.(*labSession).actions = 0
	for _, tc := range []struct {
		name, body string
	}{
		{"invalid shadow name", `{"name":"not allowed","operation":"get"}`},
		{"invalid shadow operation", `{"name":"console-lab","operation":"replace"}`},
		{"invalid shadow field", `{"operation":"update","payload":{"state":{"desired":{"led":true}},"unexpected":true}}`},
		{"invalid shadow state", `{"operation":"update","payload":{"state":{"reported":{"led":true}}}}`},
		{"invalid shadow payload", `{"operation":"update","payload":null}`},
	} {
		requireStatus(tc.name, call(http.MethodPost, actionRoot+"/shadow", tc.body), http.StatusBadRequest)
	}
	requireStatus("malformed action", call(http.MethodPost, actionRoot+"/shadow", `{`), http.StatusBadRequest)
	requireStatus("answer without stream", call(http.MethodPost, actionRoot+"/answer", `{}`), http.StatusConflict)
	requireStatus("offer without SDP", call(http.MethodPost, actionRoot+"/offer", `{}`), http.StatusBadRequest)
	requireStatus("close", call(http.MethodPost, actionRoot+"/close", `{}`), http.StatusNoContent)
	requireStatus("closed session is gone", call(http.MethodPost, actionRoot+"/credentials", `{}`), http.StatusNotFound)

	mqttReq := httptest.NewRequest(http.MethodGet, "/api/developer/test-lab/mqtt", nil)
	mqttReq.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: actor.ID})
	mqttReq.Header.Set("Origin", "http://example.com")
	mqttReq.Header.Set("Connection", "Upgrade")
	mqttReq.Header.Set("Upgrade", "websocket")
	mqttReq.Header.Set("Authorization", "Bearer must-not-forward")
	mqttW := httptest.NewRecorder()
	s.ServeHTTP(mqttW, mqttReq)
	requireStatus("mqtt bridge", mqttW, http.StatusOK)
	if mqttHeaders.Get("Cookie") != "" || mqttHeaders.Get("Authorization") != "" {
		t.Fatalf("mqtt credentials forwarded: cookie=%q authorization=%q", mqttHeaders.Get("Cookie"), mqttHeaders.Get("Authorization"))
	}

	accountMu.Lock()
	gotAccountCalls := strings.Join(accountCalls, "\n")
	accountMu.Unlock()
	for _, want := range []string{"/test-lab/devices", "/bind", "/test-lab/sessions", "/credentials"} {
		if !strings.Contains(gotAccountCalls, want) {
			t.Errorf("missing account call %q in:\n%s", want, gotAccountCalls)
		}
	}
	runtimeMu.Lock()
	gotRuntimeCalls := strings.Join(runtimeCalls, "\n")
	runtimeMu.Unlock()
	for _, want := range []string{"/things/camera-1/shadow", "/api/request_webrtc/ice", "/api/request_webrtc/close"} {
		if !strings.Contains(gotRuntimeCalls, want) {
			t.Errorf("missing runtime call %q in:\n%s", want, gotRuntimeCalls)
		}
	}
	if _, _, err := s.labRequest(context.Background(), labCredentials{}, http.MethodPost, "/invalid", make(chan int), false); err == nil {
		t.Error("labRequest accepted a body that cannot be encoded as JSON")
	}
	if _, _, err := s.labRequest(context.Background(), labCredentials{}, http.MethodGet, "/things/camera-1/shadow", nil, true); err == nil {
		t.Error("labRequest accepted missing Shadow credentials")
	}
}
