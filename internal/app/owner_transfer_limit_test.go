package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestOwnerTransferLimitBFFAdminOnlyAndPreservesLimitError(t *testing.T) {
	limit := 3
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/admin/brand-clouds/" + cloudA + "/owner-transfer-limit":
			if r.Header.Get("Authorization") != "Bearer admin-token" {
				t.Error("missing platform admin token")
			}
			if r.Method == http.MethodPatch {
				var body struct {
					Limit *int `json:"owner_transfer_limit"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Limit == nil {
					t.Error("invalid limit forwarded", err)
				} else {
					limit = *body.Limit
				}
			}
			_ = json.NewEncoder(w).Encode(accountclient.OwnerTransferQuota{Limit: limit, Remaining: limit})
		case "/v1/developer/brand-clouds/" + cloudA + "/owner-transfer":
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"owner_transfer_limit_reached","message":"upstream detail"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	admin, _ := st.CreateSession("platform_admin", "admin", "admin@example.test", "admin-token", "", "", time.Hour)
	owner, _ := st.CreateSession("customer", "owner", "owner@example.test", "owner-token", "", cloudA, time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	call := func(sessionID, method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", "limit-intent")
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	path := "/api/admin/brand-clouds/" + cloudA + "/owner-transfer-limit"
	if r := call(owner.ID, "GET", path, ""); r.Code != 403 {
		t.Fatalf("owner read admin policy=%d", r.Code)
	}
	if r := call(admin.ID, "GET", path, ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"owner_transfer_remaining":3`) {
		t.Fatalf("admin read=%d %s", r.Code, r.Body.String())
	}
	if r := call(admin.ID, "PATCH", path, `{"owner_transfer_limit":0}`); r.Code != 200 || !strings.Contains(r.Body.String(), `"owner_transfer_remaining":0`) {
		t.Fatalf("admin patch=%d %s", r.Code, r.Body.String())
	}
	if r := call(admin.ID, "PATCH", path, `{"owner_transfer_limit":201}`); r.Code != 400 {
		t.Fatalf("invalid patch=%d", r.Code)
	}
	if r := call(owner.ID, "POST", "/api/developer/brand-clouds/"+cloudA+"/owner-transfer", `{"target_email":"target@example.test"}`); r.Code != 409 || !strings.Contains(r.Body.String(), `"code":"owner_transfer_limit_reached"`) || strings.Contains(r.Body.String(), "upstream detail") {
		t.Fatalf("limit error=%d %s", r.Code, r.Body.String())
	}
}
