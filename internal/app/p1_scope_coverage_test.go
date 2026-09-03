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

func TestScopedGroupAggregatesAndTagMutations(t *testing.T) {
	t.Parallel()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("fail") == "1" {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
			return
		}
		switch {
		case r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organizations": []map[string]any{{
				"id": cloudA, "name": "Cloud A", "role": "owner", "capabilities": fleetManagerCapabilities(),
			}}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/device-groups/aggregates":
			_ = json.NewEncoder(w).Encode(map[string]any{"aggregates": []map[string]any{{
				"group_id": "group-1", "member_count": 3, "online_count": 2, "offline_count": 1,
				"health_distribution":   map[string]int{"healthy": 2, "warning": 1},
				"firmware_distribution": map[string]int{"1.0.0": 3},
			}}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/tags" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"tags": []map[string]any{{"tag": "lab", "device_count": 2}}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/tags" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
		case strings.HasSuffix(r.URL.Path, "/tags/reject"):
			http.Error(w, "tag mutation rejected", http.StatusBadGateway)
		case strings.HasPrefix(r.URL.Path, "/v1/orgs/"+cloudA+"/tags/") && r.Method == http.MethodPatch:
			w.WriteHeader(http.StatusOK)
		case strings.HasPrefix(r.URL.Path, "/v1/orgs/"+cloudA+"/tags/") && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(account.Close)

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "owner-1", "owner@example.com", "access", "refresh", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(account.URL)})
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	request := func(method, path, body, key string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(cookie)
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		srv.ServeHTTP(recorder, req)
		return recorder
	}
	root := "/api/developer/brand-clouds/" + cloudA

	if response := request(http.MethodGet, root+"/groups/aggregates?limit=10", "", ""); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"member_count":3`) {
		t.Fatalf("group aggregates status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, root+"/groups/aggregates?fail=1", "", ""); response.Code != http.StatusBadGateway {
		t.Fatalf("group aggregate failure status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodGet, root+"/tags", "", ""); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"tag":"lab"`) {
		t.Fatalf("tag list status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, root+"/tags", `{"name":"field"}`, "tag-create"); response.Code != http.StatusCreated {
		t.Fatalf("tag create status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPatch, root+"/tags/lab", `{"name":"field"}`, "tag-rename"); response.Code != http.StatusOK {
		t.Fatalf("tag rename status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodDelete, root+"/tags/field", "", "tag-delete"); response.Code != http.StatusNoContent {
		t.Fatalf("tag delete status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPatch, root+"/tags/lab", `{`, "tag-invalid"); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid rename status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPatch, root+"/tags/reject", `{"name":"field"}`, "tag-reject"); response.Code != http.StatusBadGateway {
		t.Fatalf("rejected rename status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodDelete, root+"/tags/lab", "", ""); response.Code != http.StatusPreconditionRequired {
		t.Fatalf("missing idempotency key status=%d body=%s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, root+"/tags", `{}`, "tag-invalid-create"); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid tag create status=%d body=%s", response.Code, response.Body.String())
	}

	options := httptest.NewRecorder()
	retiredCustomerRoute(options, httptest.NewRequest(http.MethodOptions, "/api/tags", nil))
	if options.Code != http.StatusNoContent {
		t.Fatalf("retired OPTIONS status=%d", options.Code)
	}
	retired := httptest.NewRecorder()
	retiredCustomerRoute(retired, httptest.NewRequest(http.MethodGet, "/api/tags", nil))
	if retired.Code != http.StatusNotFound || !strings.Contains(retired.Body.String(), "SCOPED_ROUTE_REQUIRED") {
		t.Fatalf("retired GET status=%d body=%s", retired.Code, retired.Body.String())
	}
}
