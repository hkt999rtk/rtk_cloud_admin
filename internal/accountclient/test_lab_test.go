package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTestLabManagePreservesScopeMethodAndBody(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer console-token" {
			t.Error("developer identity lost")
		}
		switch requests {
		case 1:
			if r.Method != http.MethodPost || r.URL.Path != "/v1/developer/brand-clouds/"+cloud+"/test-lab/manage/devices/device-1/bind" {
				t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["product_id"] != "product-1" {
				t.Errorf("request body: %#v, %v", body, err)
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "completed"})
		case 2:
			if r.Method != http.MethodDelete || r.URL.Path != "/v1/developer/brand-clouds/"+cloud+"/test-lab/manage/accounts/account-1" {
				t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			}
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer server.Close()

	got, err := New(server.URL).TestLabManage(context.Background(), "console-token", cloud, "manage/devices/device-1/bind", http.MethodPost, map[string]string{"product_id": "product-1"})
	if err != nil || string(got) != "{\"status\":\"completed\"}" {
		t.Fatalf("response=%s error=%v", got, err)
	}
	got, err = New(server.URL).TestLabManage(context.Background(), "console-token", cloud, "manage/accounts/account-1", http.MethodDelete, nil)
	if err != nil || got != nil {
		t.Fatalf("delete response=%s error=%v", got, err)
	}
}

func TestTestLabBuildsSessionAndActionPaths(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer console-token" {
			t.Errorf("request identity or method lost: %s", r.Method)
		}
		want := "/v1/developer/brand-clouds/" + cloud + "/test-lab/sessions"
		if requests == 2 {
			want += "/session-1/shadow"
		}
		if r.URL.Path != want {
			t.Errorf("path=%s want=%s", r.URL.Path, want)
		}
		_ = json.NewEncoder(w).Encode(map[string]int{"request": requests})
	}))
	defer server.Close()

	for _, tc := range []struct {
		session string
		action  string
		want    string
	}{
		{"", "", "{\"request\":1}"},
		{"session-1", "shadow", "{\"request\":2}"},
	} {
		got, err := New(server.URL).TestLab(context.Background(), "console-token", cloud, tc.session, tc.action, http.MethodPost, map[string]string{"operation": "get"})
		if err != nil || string(got) != tc.want {
			t.Fatalf("response=%s error=%v", got, err)
		}
	}

	deleteServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/v1/developer/brand-clouds/"+cloud+"/test-lab/sessions/session-1/close" {
			t.Errorf("unexpected delete %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer deleteServer.Close()
	got, err := New(deleteServer.URL).TestLab(context.Background(), "console-token", cloud, "session-1", "close", http.MethodDelete, nil)
	if err != nil || got != nil {
		t.Fatalf("delete response=%s error=%v", got, err)
	}
}
