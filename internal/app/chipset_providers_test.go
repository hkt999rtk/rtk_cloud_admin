package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/correlation"
)

func TestChipsetProviderBFFEnforcesCapabilityAndForwardsMutationMetadata(t *testing.T) {
	var mu sync.Mutex
	var mutationHeaders http.Header
	var mutationCalls int
	capabilities := []string{capabilityChipsetProviderRead, capabilityChipsetProviderEdit, capabilityChipsetProviderPublish}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "admin-1"}, "organizations": []any{}, "capabilities": capabilities})
		case "/v1/admin/chipset-providers":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"providers": []any{map[string]any{"id": "provider-1", "name": "Ameba IoT", "status": "draft", "unavailable": true}}})
				return
			}
			mu.Lock()
			mutationCalls++
			mutationHeaders = r.Header.Clone()
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"provider": map[string]any{"id": "provider-1", "name": "Ameba IoT", "status": "draft"}, "audit_result": "accepted"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})

	list := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/admin/chipset-providers", nil, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), capabilityChipsetProviderEdit) {
		t.Fatalf("provider list = %d: %s", list.Code, list.Body.String())
	}
	missingKey := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/admin/chipset-providers", strings.NewReader(`{"name":"Ameba","manifest_url":"https://provider.example.com/manifest.json"}`), http.Header{"Content-Type": {"application/json"}})
	if missingKey.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key = %d: %s", missingKey.Code, missingKey.Body.String())
	}
	headers := http.Header{
		"Content-Type":                {"application/json"},
		"Idempotency-Key":             {"create-provider-1"},
		correlation.HeaderRequestID:   {"req-chipset-1"},
		correlation.HeaderTraceID:     {"trace-chipset-1"},
		correlation.HeaderOperationID: {"op-chipset-1"},
	}
	created := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/admin/chipset-providers", strings.NewReader(`{"name":"Ameba","manifest_url":"https://provider.example.com/manifest.json"}`), headers)
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"audit_result":"accepted"`) {
		t.Fatalf("provider create = %d: %s", created.Code, created.Body.String())
	}
	mu.Lock()
	gotHeaders, gotCalls := mutationHeaders, mutationCalls
	mu.Unlock()
	if gotCalls != 1 || gotHeaders.Get("Authorization") != "Bearer admin-access" || gotHeaders.Get("Idempotency-Key") != "create-provider-1" || gotHeaders.Get(correlation.HeaderRequestID) != "req-chipset-1" || gotHeaders.Get(correlation.HeaderTraceID) != "trace-chipset-1" || gotHeaders.Get(correlation.HeaderOperationID) != "op-chipset-1" {
		t.Fatalf("forwarded mutation headers = %#v, calls=%d", gotHeaders, gotCalls)
	}

	capabilities = []string{capabilityChipsetProviderRead}
	forbidden := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/admin/chipset-providers", strings.NewReader(`{"name":"Ameba","manifest_url":"https://provider.example.com/manifest.json"}`), headers)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("missing edit capability = %d: %s", forbidden.Code, forbidden.Body.String())
	}
}

func TestChipsetDeveloperBFFNormalizesResponsesAndSanitizesUpstreamErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/developer/chipsets":
			_ = json.NewEncoder(w).Encode(map[string]any{"chipsets": []any{map[string]any{"id": "chipset-1", "provider_name": "Ameba IoT", "chipset_key": "realtek-amebapro2", "vendor": "Realtek", "name": "AmebaPro2", "sdk_releases": []any{}, "stale": false, "last_successful_refresh_at": "2026-07-19T00:00:00Z"}}})
		case "/v1/developer/chipsets/chipset-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"chipset": map[string]any{"id": "chipset-1", "provider_name": "Ameba IoT", "chipset_key": "realtek-amebapro2", "vendor": "Realtek", "name": "AmebaPro2", "sdk_releases": []any{}, "stale": false}})
		case "/v1/developer/chipsets/failure":
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`database password=do-not-leak`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "developer-1", "developer@example.com", "developer-access", "developer-refresh", "brand-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	list := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/chipsets", nil, nil)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "AmebaPro2") || strings.Contains(list.Body.String(), "manifest_url") {
		t.Fatalf("developer list = %d: %s", list.Code, list.Body.String())
	}
	detail := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/chipsets/chipset-1", nil, nil)
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"source_status":"available"`) {
		t.Fatalf("developer detail = %d: %s", detail.Code, detail.Body.String())
	}
	failure := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/chipsets/failure", nil, nil)
	if failure.Code != http.StatusBadGateway || strings.Contains(failure.Body.String(), "password") {
		t.Fatalf("developer upstream failure = %d: %s", failure.Code, failure.Body.String())
	}
}

func authenticatedRequest(handler http.Handler, sessionID, method, path string, body *strings.Reader, headers http.Header) *httptest.ResponseRecorder {
	var request *http.Request
	if body == nil {
		request = httptest.NewRequest(method, path, nil)
	} else {
		request = httptest.NewRequest(method, path, body)
	}
	request.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
	for name, values := range headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
