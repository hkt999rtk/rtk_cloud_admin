package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/videoclient"
)

func TestBrandWebhookBFFChecksLiveOwnerBeforeTenantScopedUpstream(t *testing.T) {
	cloudID := "11111111-1111-4111-8111-111111111111"
	ownerID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	token := strings.Repeat("b", 32)
	secret := strings.Repeat("s", 32)
	role := "owner"
	returnedCloudID := cloudID
	var videoCalls int
	var subscriptionMissing bool
	var malformedReceipt bool
	accountUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/developer/brand-clouds/"+cloudID || r.Header.Get("Authorization") != "Bearer customer-access" {
			t.Errorf("unexpected account lookup: %s %s", r.Method, r.URL.Path)
			http.Error(w, "bad lookup", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": map[string]any{
			"id": returnedCloudID, "owner_user_id": ownerID, "my_role": role,
			"ownership_version": 7, "capabilities": []string{"cloud.update"},
		}})
	}))
	defer accountUpstream.Close()
	videoUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		videoCalls++
		if r.Header.Get("Authorization") != "Bearer "+token || r.Header.Get("X-Brand-Cloud-ID") != cloudID {
			t.Errorf("bad video service credential or tenant header")
			http.Error(w, "bad scope", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/brand/webhook/subscription":
			switch r.Method {
			case http.MethodGet, http.MethodPut:
				if r.Method == http.MethodGet && subscriptionMissing {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				_, _ = w.Write([]byte(`{"endpoint_url":"https://hooks.example.test/events","enabled":true,"secret":"` + secret + `"}`))
			case http.MethodDelete:
				w.WriteHeader(http.StatusNoContent)
			default:
				t.Errorf("unexpected subscription method %s", r.Method)
			}
		case "/v1/brand/webhook/events/event-1/receipts":
			if malformedReceipt {
				_, _ = w.Write([]byte(`{"event_id":"event-1","receipts":[{"event_id":"event-1","attempt":1}]}`))
			} else {
				_, _ = w.Write([]byte(`{"event_id":"event-1","receipts":[{"event_id":"event-1","device_id":"device-1","attempt":1},{"event_id":"event-1","device_id":"device-2","attempt":1}]}`))
			}
		default:
			t.Errorf("unexpected video path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer videoUpstream.Close()
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", ownerID, "owner@example.test", "customer-access", "refresh", cloudID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{
		Config: config.Config{AccountManagerBaseURL: accountUpstream.URL, VideoCloudBaseURL: videoUpstream.URL,
			VideoCloudBrandWebhookToken: token},
		AccountClient: accountclient.New(accountUpstream.URL), VideoClient: videoclient.New(videoUpstream.URL),
	})
	request := func(method, path, body, version, origin string, authenticated bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if version != "" {
			req.Header.Set("X-Cloud-Ownership-Version", version)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if authenticated {
			req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		}
		response := httptest.NewRecorder()
		srv.ServeHTTP(response, req)
		return response
	}
	base := "/api/developer/brand-clouds/" + cloudID + "/webhook"
	validBody := `{"endpoint_url":"https://hooks.example.test/events","secret":"` + secret + `"}`
	for _, tc := range []struct {
		name, method, path, body, version, origin string
		authenticated                             bool
		status                                    int
		upstream                                  bool
	}{
		{"no session", http.MethodGet, base + "/subscription", "", "", "", false, 401, false},
		{"owner read", http.MethodGet, base + "/subscription", "", "", "", true, 200, true},
		{"owner write", http.MethodPut, base + "/subscription", validBody, "7", "http://example.com", true, 200, true},
		{"owner receipt", http.MethodGet, base + "/events/event-1/receipts", "", "", "", true, 200, true},
		{"stale owner", http.MethodPut, base + "/subscription", validBody, "6", "http://example.com", true, 409, false},
		{"cross origin", http.MethodDelete, base + "/subscription", "", "7", "https://attacker.example", true, 403, false},
		{"duplicate JSON", http.MethodPut, base + "/subscription", `{"endpoint_url":"https://a.test","endpoint_url":"https://b.test","secret":"` + secret + `"}`, "7", "http://example.com", true, 400, false},
		{"invalid receipt ID", http.MethodGet, base + "/events/%25bad/receipts", "", "", "", true, 400, false},
		{"owner disable", http.MethodDelete, base + "/subscription", "", "7", "http://example.com", true, 204, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := videoCalls
			response := request(tc.method, tc.path, tc.body, tc.version, tc.origin, tc.authenticated)
			if response.Code != tc.status || (videoCalls > before) != tc.upstream {
				t.Fatalf("status=%d upstream=%t, want %d/%t; body=%s", response.Code, videoCalls > before, tc.status, tc.upstream, response.Body.String())
			}
			if strings.Contains(response.Body.String(), secret) || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("secret or cache policy leak: %s", response.Body.String())
			}
			if tc.name == "owner receipt" && (!strings.Contains(response.Body.String(), `"device_id":"device-1"`) ||
				!strings.Contains(response.Body.String(), `"device_id":"device-2"`)) {
				t.Fatalf("device-labeled receipts missing: %s", response.Body.String())
			}
		})
	}
	malformedReceipt = true
	if response := request(http.MethodGet, base+"/events/event-1/receipts", "", "", "", true); response.Code != http.StatusBadGateway {
		t.Fatalf("unlabeled receipt status=%d", response.Code)
	}
	malformedReceipt = false
	subscriptionMissing = true
	missing := request(http.MethodGet, base+"/subscription", "", "", "", true)
	if missing.Code != http.StatusNotFound || missing.Header().Get("X-Cloud-Ownership-Version") != "7" {
		t.Fatalf("missing subscription status=%d version=%q", missing.Code, missing.Header().Get("X-Cloud-Ownership-Version"))
	}
	role = "viewer"
	if response := request(http.MethodGet, base+"/subscription", "", "", "", true); response.Code != http.StatusForbidden {
		t.Fatalf("viewer read status=%d", response.Code)
	}
	role = "owner"
	returnedCloudID = "22222222-2222-4222-8222-222222222222"
	if response := request(http.MethodGet, base+"/subscription", "", "", "", true); response.Code != http.StatusBadGateway {
		t.Fatalf("mismatched Account Manager cloud status=%d", response.Code)
	}
	returnedCloudID = cloudID
	srv.cfg.VideoCloudAdminToken = token
	if response := request(http.MethodGet, base+"/subscription", "", "", "", true); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("reused general admin credential status=%d", response.Code)
	}
}
