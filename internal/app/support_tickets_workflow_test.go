package app

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
)

func TestSupportTicketCustomerAndAgentWorkflow(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	role := "member"
	capabilities := []string{"ticket.support.read", "ticket.support.reply", "ticket.support.note", "ticket.support.assign", "ticket.support.reassign"}
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/me" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") == "Bearer agent-token" {
			_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "a1", "name": "Agent One", "email": "agent@example.test"}, "platform_capabilities": capabilities})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "u1", "email": "customer@example.test"}, "brand_cloud_memberships": []any{map[string]any{"id": cloud, "role": role}}})
	}))
	defer am.Close()

	users := map[int64]map[string]any{
		8: {"id": 8, "login": "rtk-a1", "email": "agent@example.test", "firstname": "Agent", "lastname": "One", "roles": []string{"Agent"}},
		9: {"id": 9, "login": "rtk-a2", "email": "agent2@example.test", "firstname": "Agent", "lastname": "Two", "roles": []string{"Agent"}},
	}
	ticket := map[string]any{"id": int64(1), "number": "1001", "title": "Camera offline", "group_id": int64(7), "owner_id": int64(1), "owner": "-", "rtk_cloud_id": cloud, "rtk_category": "incident", "state": "open", "created_at": "2026-09-27T11:00:00Z", "updated_at": "2026-09-27T11:00:00Z", "last_contact_at": "2026-09-27T11:00:00Z"}
	articles := []map[string]any{}
	var createdCustomers int
	var notificationsSuppressed bool
	zammad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token token=z-token" {
			t.Error("Zammad token must stay server-side")
		}
		if r.Header.Get("X-Zammad-Suppress-Notifications") == "true" {
			notificationsSuppressed = true
		}
		path := r.URL.Path
		switch {
		case r.Method == "GET" && path == "/api/v1/users/search":
			query := r.URL.Query().Get("query")
			found := []any{}
			for _, user := range users {
				if query == "rtk-" || strings.Contains(query, user["login"].(string)) {
					found = append(found, user)
				}
			}
			_ = json.NewEncoder(w).Encode(found)
		case r.Method == "POST" && path == "/api/v1/users":
			var input map[string]any
			_ = json.NewDecoder(r.Body).Decode(&input)
			if !strings.HasPrefix(input["login"].(string), "rtk-u1") || input["roles"].([]any)[0] != "Customer" {
				t.Errorf("unexpected customer identity: %#v", input)
			}
			input["id"] = int64(3)
			users[3] = input
			createdCustomers++
			_ = json.NewEncoder(w).Encode(input)
		case r.Method == "GET" && strings.HasPrefix(path, "/api/v1/users/"):
			id, _ := strconv.ParseInt(strings.TrimPrefix(path, "/api/v1/users/"), 10, 64)
			if user, ok := users[id]; ok {
				_ = json.NewEncoder(w).Encode(user)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == "POST" && path == "/api/v1/tickets":
			var input map[string]any
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input["rtk_cloud_id"] != cloud || input["group_id"] != float64(7) || input["customer_id"] != float64(3) {
				t.Errorf("ticket scope was not server-controlled: %#v", input)
			}
			initial := input["article"].(map[string]any)
			if initial["internal"] != false || initial["origin_by_id"] != float64(3) {
				t.Errorf("initial public author mismatch: %#v", initial)
			}
			articles = append(articles, map[string]any{"id": int64(11), "ticket_id": int64(1), "body": initial["body"], "from": "Customer", "sender": "Customer", "internal": false, "origin_by_id": int64(3), "created_at": "2026-09-27T11:00:00Z", "attachments": []any{}})
			_ = json.NewEncoder(w).Encode(ticket)
		case r.Method == "GET" && path == "/api/v1/tickets/search":
			_ = json.NewEncoder(w).Encode([]any{ticket})
		case r.Method == "GET" && path == "/api/v1/tickets/1":
			_ = json.NewEncoder(w).Encode(ticket)
		case r.Method == "PUT" && path == "/api/v1/tickets/1":
			var input map[string]any
			_ = json.NewDecoder(r.Body).Decode(&input)
			for key, value := range input {
				ticket[key] = value
			}
			if ticket["owner_id"] == float64(8) {
				ticket["owner"] = "Agent One"
			}
			_ = json.NewEncoder(w).Encode(ticket)
		case r.Method == "GET" && path == "/api/v1/ticket_articles/by_ticket/1":
			_ = json.NewEncoder(w).Encode(articles)
		case r.Method == "POST" && path == "/api/v1/ticket_articles":
			var input map[string]any
			_ = json.NewDecoder(r.Body).Decode(&input)
			input["id"] = int64(12 + len(articles))
			input["created_at"] = "2026-09-27T12:00:00Z"
			if files, ok := input["attachments"].([]any); ok && len(files) > 0 {
				input["attachments"] = []any{map[string]any{"id": 31, "filename": "evidence.png", "size": "12"}}
			}
			articles = append(articles, input)
			_ = json.NewEncoder(w).Encode(input)
		case r.Method == "GET" && strings.HasPrefix(path, "/api/v1/ticket_attachment/1/"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("image-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer zammad.Close()

	st := mustOpenStore(t)
	customer, err := st.CreateSession("customer", "u1", "customer@example.test", "customer-token", "", cloud, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateSession("platform_admin", "a1", "agent@example.test", "agent-token", "", "", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(am.URL), Config: config.Config{SupportTicketsEnabled: true, ZammadBaseURL: zammad.URL, ZammadAPIToken: "z-token", ZammadSupportGroupID: 7, ZammadUnassignedOwnerID: 1}})
	call := func(sessionID, method, path, contentType string, body io.Reader, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, path, body)
		req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		response := httptest.NewRecorder()
		srv.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("%s %s: %d %s, want %d", method, path, response.Code, response.Body.String(), want)
		}
		return response.Body.String()
	}
	customerBase := "/api/developer/brand-clouds/" + cloud + "/support/tickets"
	agentBase := "/api/admin/support/tickets"
	created := call(customer.ID, "POST", customerBase, "application/json", strings.NewReader(`{"title":"Camera offline","body":"Please investigate","category":"incident"}`), 201)
	if !strings.Contains(created, "Camera offline") || createdCustomers != 1 || !notificationsSuppressed {
		t.Fatalf("customer creation/notification policy failed: %s", created)
	}
	if list := call(customer.ID, "GET", customerBase+"?q=Camera&state=open", "", nil, 200); !strings.Contains(list, "Camera offline") {
		t.Fatalf("Cloud ticket missing from list: %s", list)
	}
	call(customer.ID, "POST", customerBase+"/1/seen", "", nil, 200)
	call(agent.ID, "GET", agentBase+"?queue=unassigned", "", nil, 200)
	if agents := call(agent.ID, "GET", "/api/admin/support/agents", "", nil, 200); !strings.Contains(agents, "Agent Two") {
		t.Fatalf("approved Agent lookup failed: %s", agents)
	}
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"owner_id":0}`), 200)
	call(agent.ID, "GET", agentBase+"?queue=mine", "", nil, 200)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"owner_id":9,"state":"closed"}`), 200)
	if reply := call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"A public reply","visibility":"public"}`), 200); !strings.Contains(reply, "A public reply") {
		t.Fatalf("public agent reply missing: %s", reply)
	}
	call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"Private diagnosis","visibility":"internal"}`), 200)
	if detail := call(customer.ID, "GET", customerBase+"/1", "", nil, 200); strings.Contains(detail, "Private diagnosis") || !strings.Contains(detail, "A public reply") {
		t.Fatalf("customer article projection wrong: %s", detail)
	}
	if detail := call(agent.ID, "GET", agentBase+"/1", "", nil, 200); !strings.Contains(detail, "Private diagnosis") {
		t.Fatalf("agent note missing: %s", detail)
	}
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	_ = writer.WriteField("body", "Evidence attached")
	file, err := writer.CreateFormFile("attachments", "evidence.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("\x89PNG\r\n\x1a\nimage"))
	_ = writer.Close()
	if reply := call(customer.ID, "POST", customerBase+"/1/articles", writer.FormDataContentType(), &upload, 200); !strings.Contains(reply, "evidence.png") || !strings.Contains(reply, `"state":"open"`) {
		t.Fatalf("customer attachment/reopen failed: %s", reply)
	}
	attachment := call(customer.ID, "GET", customerBase+"/1/articles/"+strconv.Itoa(12+len(articles)-1)+"/attachments/31", "", nil, 200)
	if attachment != "image-bytes" {
		t.Fatalf("attachment download = %q", attachment)
	}
	// Invalid browser input and reduced support permissions must fail before
	// any scoped ticket or article can be changed.
	call(agent.ID, "GET", "/api/admin/support/agents?q="+strings.Repeat("a", 81), "", nil, 400)
	call(customer.ID, "GET", customerBase+"?q="+strings.Repeat("a", 101), "", nil, 400)
	call(customer.ID, "GET", customerBase+"?queue=mine", "", nil, 400)
	call(agent.ID, "GET", agentBase+"?queue=invalid", "", nil, 400)
	call(customer.ID, "GET", customerBase+"/abc", "", nil, 400)
	call(customer.ID, "GET", customerBase+"/1/articles/abc/attachments/31", "", nil, 400)
	call(customer.ID, "GET", customerBase+"/1/articles/11/attachments/abc", "", nil, 400)
	call(customer.ID, "GET", customerBase+"/1/articles/11/attachments/31", "", nil, 404)
	call(customer.ID, "POST", customerBase, "application/json", strings.NewReader(`{"title":"x","body":"message","category":"incident"}`), 400)
	call(customer.ID, "POST", customerBase, "application/json", strings.NewReader(`{"title":"Valid title","body":"message","category":"billing"}`), 400)
	call(customer.ID, "POST", customerBase, "application/json", strings.NewReader(`{"title":"Valid title","body":"","category":"incident"}`), 400)
	call(customer.ID, "POST", customerBase, "application/json", strings.NewReader(`{"title":"Valid title","body":"message","category":"incident","owner_id":9}`), 400)
	call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"message"}`), 400)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{bad`), 400)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{}`), 400)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"state":"pending"}`), 400)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"owner_id":3}`), 400)
	capabilities = []string{"ticket.support.read", "ticket.support.assign"}
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"owner_id":0}`), 403)
	call(agent.ID, "PATCH", agentBase+"/1", "application/json", strings.NewReader(`{"state":"closed"}`), 403)
	call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"message","visibility":"public"}`), 403)
	call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"message","visibility":"internal"}`), 403)
	capabilities = []string{"ticket.support.read", "ticket.support.reply", "ticket.support.note", "ticket.support.assign", "ticket.support.reassign"}
	var invalidUpload bytes.Buffer
	invalidWriter := multipart.NewWriter(&invalidUpload)
	_ = invalidWriter.WriteField("body", "Inspect this binary")
	invalidFile, err := invalidWriter.CreateFormFile("attachments", "program.exe")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = invalidFile.Write([]byte{0, 1, 2, 3, 4, 5})
	_ = invalidWriter.Close()
	call(customer.ID, "POST", customerBase+"/1/articles", invalidWriter.FormDataContentType(), &invalidUpload, 400)
	call(agent.ID, "POST", agentBase, "application/json", strings.NewReader(`{"title":"Invalid route","body":"message","category":"incident"}`), 404)
	call(customer.ID, "PATCH", customerBase+"/1", "application/json", strings.NewReader(`{"state":"closed"}`), 404)
	capabilities = []string{"ticket.support.read"}
	call(agent.ID, "GET", "/api/admin/support/agents", "", nil, 403)
	capabilities = []string{"ticket.support.read", "ticket.support.reply", "ticket.support.note", "ticket.support.assign", "ticket.support.reassign"}
	var excessiveUpload bytes.Buffer
	excessiveWriter := multipart.NewWriter(&excessiveUpload)
	_ = excessiveWriter.WriteField("body", "Too many files")
	for range 6 {
		file, err := excessiveWriter.CreateFormFile("attachments", "evidence.png")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.Write([]byte("\x89PNG\r\n\x1a\nimage"))
	}
	_ = excessiveWriter.Close()
	call(customer.ID, "POST", customerBase+"/1/articles", excessiveWriter.FormDataContentType(), &excessiveUpload, 400)
	savedAgent := users[8]
	delete(users, 8)
	call(agent.ID, "GET", agentBase+"?queue=mine", "", nil, 503)
	users[8] = savedAgent
	savedAgent["roles"] = []string{"Customer"}
	call(agent.ID, "POST", agentBase+"/1/articles", "application/json", strings.NewReader(`{"body":"Agent role required","visibility":"public"}`), 503)
	savedAgent["roles"] = []string{"Agent"}
	var oversizedUpload bytes.Buffer
	oversizedWriter := multipart.NewWriter(&oversizedUpload)
	_ = oversizedWriter.WriteField("body", "Too large")
	oversizedFile, err := oversizedWriter.CreateFormFile("attachments", "large.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = oversizedFile.Write(bytes.Repeat([]byte("x"), (10<<20)+1))
	_ = oversizedWriter.Close()
	call(customer.ID, "POST", customerBase+"/1/articles", oversizedWriter.FormDataContentType(), &oversizedUpload, 413)
	role = "viewer"
	call(customer.ID, "POST", customerBase+"/1/articles", "application/json", strings.NewReader(`{"body":"Viewer cannot reply"}`), 403)
}
