package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestLegacyCustomerProductCatalogAndRegisteredServiceWrite(t *testing.T) {
	var writes []accountclient.DeviceItemProfileRequest
	var catalogScopes []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"owner-1"},"organizations":[{"id":"org-1","role":"owner","capabilities":["product.read","product.manage"]}]}`))
		case r.URL.Path == "/v1/platform/service-options":
			catalogScopes = append(catalogScopes, r.URL.Query().Get("brand_cloud_id"))
			_, _ = w.Write([]byte(`{"catalog_revision":7,"product_writes_enabled":true,"options":[{"code":"mqtt","display_name":"MQTT","selectable":true},{"code":"iot_shadow","display_name":"IoT Shadow","selectable":true,"requires":["mqtt"]},{"code":"custom_option","display_name":"Custom","selectable":true}]}`))
		case r.URL.Path == "/v1/orgs/org-1/access/check":
			_, _ = w.Write([]byte(`{"allowed":true}`))
		case strings.HasPrefix(r.URL.Path, "/v1/orgs/org-1/device-item-profiles"):
			var input accountclient.DeviceItemProfileRequest
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Errorf("decode Product request: %v", err)
				http.Error(w, "invalid JSON", 400)
				return
			}
			writes = append(writes, input)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": "product-1", "display_name": input.DisplayName, "service_options": input.ServiceOptions}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "owner-1", "owner@example.com", "access", "refresh", "org-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	if response := requestWithCookie(t, srv, http.MethodGet, "/api/product-service-options", nil, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated catalog status = %d", response.Code)
	}
	response := requestWithCookie(t, srv, http.MethodGet, "/api/product-service-options", nil, cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"iot_shadow"`) || !strings.Contains(response.Body.String(), `"catalog_revision":7`) {
		t.Fatalf("catalog status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || !slices.Equal(catalogScopes, []string{"org-1"}) {
		t.Fatalf("catalog scope/cache = %#v, %q", catalogScopes, response.Header().Get("Cache-Control"))
	}

	headers := http.Header{"Content-Type": {"application/json"}, "Idempotency-Key": {"catalog-create"}}
	response = authenticatedRequest(srv, session.ID, http.MethodPost, "/api/products", strings.NewReader(`{"name":"Sensor","product_model":"R1","category":"mqtt_device","service_capabilities":["mqtt","iot_shadow","custom_option"],"catalog_revision":7}`), headers)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	if len(writes) != 1 || writes[0].CatalogRevision != 7 || !slices.Equal(writes[0].ServiceOptions, []string{"custom_option", "iot_shadow", "mqtt"}) {
		t.Fatalf("Product grant write = %#v", writes)
	}
	if !strings.Contains(response.Body.String(), `"custom_option"`) || !strings.Contains(response.Body.String(), `"iot_shadow"`) {
		t.Fatalf("registered options lost from Product response: %s", response.Body.String())
	}

	headers.Set("Idempotency-Key", "catalog-metadata-edit")
	response = authenticatedRequest(srv, session.ID, http.MethodPatch, "/api/products/product-1", strings.NewReader(`{"name":"Renamed","product_model":"R1","category":"mqtt_device"}`), headers)
	if response.Code != http.StatusOK || len(writes) != 2 || writes[1].ServiceOptions != nil || writes[1].CatalogRevision != 0 {
		t.Fatalf("metadata-only edit status = %d, writes = %#v, body = %s", response.Code, writes, response.Body.String())
	}
}
