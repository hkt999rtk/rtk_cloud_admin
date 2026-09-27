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
)

func TestSupportTicketsKeepCloudAndArticleBoundaries(t *testing.T) {
	const cloudOne = "11111111-1111-4111-8111-111111111111"
	const cloudTwo = "22222222-2222-4222-8222-222222222222"
	role := "viewer"
	member := true
	var zammadCalls int
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/me" || r.Header.Get("Authorization") != "Bearer am-token" {
			t.Errorf("unexpected Account Manager call: %s", r.URL)
			http.Error(w, "bad request", 400)
			return
		}
		memberships := []any{}
		if member {
			memberships = append(memberships, map[string]any{"id": cloudOne, "name": "Cloud One", "role": role})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "u1", "email": "user@example.test"}, "brand_cloud_memberships": memberships})
	}))
	defer am.Close()
	zammad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		zammadCalls++
		if r.Header.Get("Authorization") != "Token token=z-token" || r.Header.Get("X-Zammad-Suppress-Notifications") != "true" {
			t.Error("Zammad request did not use service credential and suppressed notifications")
		}
		switch r.URL.Path {
		case "/api/v1/tickets/search":
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"id": 1, "number": "1001", "title": "Cloud One case", "group_id": 7, "owner_id": 1, "owner": "-", "rtk_cloud_id": cloudOne, "state": "open", "updated_at": "2026-09-27T11:00:00Z"}, map[string]any{"id": 2, "number": "1002", "title": "Cloud Two case", "group_id": 7, "rtk_cloud_id": cloudTwo}})
		case "/api/v1/tickets/1":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 1, "number": "1001", "title": "Cloud One case", "group_id": 7, "rtk_cloud_id": cloudOne, "state": "open", "updated_at": "2026-09-27T11:00:00Z"})
		case "/api/v1/tickets/2":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 2, "number": "1002", "title": "Cloud Two case", "group_id": 7, "rtk_cloud_id": cloudTwo})
		case "/api/v1/ticket_articles/by_ticket/1":
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"id": 10, "ticket_id": 1, "body": "hello", "internal": false, "sender": "Customer", "attachments": []any{}}, map[string]any{"id": 11, "ticket_id": 1, "body": "staff secret", "internal": true, "sender": "Agent", "attachments": []any{map[string]any{"id": 22, "filename": "secret.txt"}}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer zammad.Close()
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "user@example.test", "am-token", "", cloudOne, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(am.URL), Config: config.Config{SupportTicketsEnabled: true, ZammadBaseURL: zammad.URL, ZammadAPIToken: "z-token", ZammadSupportGroupID: 7, ZammadUnassignedOwnerID: 1}})
	path := "/api/developer/brand-clouds/" + cloudOne + "/support/tickets"
	call := func(method, suffix, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path+suffix, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		srv.ServeHTTP(response, req)
		return response
	}
	list := call("GET", "", "")
	if list.Code != 200 || strings.Contains(list.Body.String(), "Cloud Two case") || !strings.Contains(list.Body.String(), "Cloud One case") {
		t.Fatalf("Cloud list: %d %s", list.Code, list.Body.String())
	}
	detail := call("GET", "/1", "")
	if detail.Code != 200 || strings.Contains(detail.Body.String(), "staff secret") || strings.Contains(detail.Body.String(), "secret.txt") {
		t.Fatalf("public detail: %d %s", detail.Code, detail.Body.String())
	}
	other := call("GET", "/2", "")
	if other.Code != 404 {
		t.Fatalf("cross-Cloud ID: %d %s", other.Code, other.Body.String())
	}
	attachment := call("GET", "/1/articles/11/attachments/22", "")
	if attachment.Code != 404 {
		t.Fatalf("internal attachment: %d %s", attachment.Code, attachment.Body.String())
	}
	before := zammadCalls
	viewerWrite := call("POST", "", `{"title":"Issue","body":"problem","category":"incident"}`)
	if viewerWrite.Code != 403 || zammadCalls != before {
		t.Fatalf("Viewer write: %d, upstream calls=%d", viewerWrite.Code, zammadCalls-before)
	}
	role = "member"
	memberWrite := call("POST", "/1/articles", `{"body":"member reply","visibility":"internal"}`)
	if memberWrite.Code != 400 {
		t.Fatalf("customer internal attempt: %d %s", memberWrite.Code, memberWrite.Body.String())
	}
	member = false
	before = zammadCalls
	revoked := call("GET", "/1", "")
	if revoked.Code != 403 || zammadCalls != before {
		t.Fatalf("revoked member: %d, upstream calls=%d", revoked.Code, zammadCalls-before)
	}
}
