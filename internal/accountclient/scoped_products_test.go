package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestScopedProductsValidatePaginationAndScope(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const product = "33333333-3333-4333-8333-333333333333"
	p := DeviceItemProfile{ID: product, BrandCloudID: cloud}
	for _, tc := range []struct {
		name  string
		page  ScopedProductPage
		valid bool
	}{
		{"valid", ScopedProductPage{[]DeviceItemProfile{p}, &Pagination{Limit: 25, Offset: 25, Total: 26}}, true},
		{"empty beyond last page", ScopedProductPage{[]DeviceItemProfile{}, &Pagination{Limit: 25, Offset: 25, Total: 0}}, true},
		{"missing pagination", ScopedProductPage{Profiles: []DeviceItemProfile{p}}, false},
		{"missing list", ScopedProductPage{Pagination: &Pagination{Limit: 25}}, false},
		{"negative total", ScopedProductPage{[]DeviceItemProfile{}, &Pagination{Limit: 25, Total: -1}}, false},
		{"impossible total", ScopedProductPage{[]DeviceItemProfile{p}, &Pagination{Limit: 25, Offset: 25, Total: 25}}, false},
		{"duplicate Product", ScopedProductPage{[]DeviceItemProfile{p, p}, &Pagination{Limit: 25, Total: 2}}, false},
		{"too many", ScopedProductPage{[]DeviceItemProfile{p, p}, &Pagination{Limit: 1, Total: 2}}, false},
		{"wrong cloud", ScopedProductPage{[]DeviceItemProfile{{ID: product, BrandCloudID: product}}, &Pagination{Limit: 25, Total: 1}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/orgs/"+cloud+"/device-item-profiles" || r.URL.Query().Get("offset") != "25" || r.Header.Get("Authorization") != "Bearer global-token" {
					t.Error("scope, pagination or identity lost")
				}
				_ = json.NewEncoder(w).Encode(tc.page)
			}))
			defer s.Close()
			_, err := New(s.URL).ScopedProducts(context.Background(), "global-token", cloud, url.Values{"offset": {"25"}, "limit": {"25"}})
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

func TestScopedProductWriteValidatesReadback(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const product = "33333333-3333-4333-8333-333333333333"
	for _, wrong := range []bool{false, true} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.Path != "/v1/orgs/"+cloud+"/device-item-profiles/"+product+"/disable" || r.Header.Get("Idempotency-Key") != "retry-key" {
				t.Error("write target or key lost")
			}
			id := product
			if wrong {
				id = cloud
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": DeviceItemProfile{ID: id, BrandCloudID: cloud}})
		}))
		_, err := New(s.URL).ScopedProductWrite(context.Background(), "token", cloud, product, "POST", "disable", "retry-key", map[string]any{})
		s.Close()
		if (err != nil) != wrong {
			t.Fatalf("wrong=%v, error=%v", wrong, err)
		}
	}
}
