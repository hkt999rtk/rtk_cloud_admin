package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestProductDevicesValidateUpstreamPage(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const product = "33333333-3333-4333-8333-333333333333"
	const device = "77777777-7777-4777-8777-000000000000"
	d := Device{ID: device, OrganizationID: cloud, DeviceItemProfileID: product}
	for _, tc := range []struct {
		name  string
		page  ProductDevicePage
		valid bool
	}{
		{"valid", ProductDevicePage{[]Device{d}, &Pagination{Limit: 25, Total: 1}}, true},
		{"empty", ProductDevicePage{[]Device{}, &Pagination{Limit: 25}}, true},
		{"missing pagination", ProductDevicePage{Devices: []Device{d}}, false},
		{"duplicates", ProductDevicePage{[]Device{d, d}, &Pagination{Limit: 25, Total: 2}}, false},
		{"wrong Product", ProductDevicePage{[]Device{{ID: device, OrganizationID: cloud, DeviceItemProfileID: cloud}}, &Pagination{Limit: 25, Total: 1}}, false},
		{"wrong cloud", ProductDevicePage{[]Device{{ID: device, OrganizationID: product, DeviceItemProfileID: product}}, &Pagination{Limit: 25, Total: 1}}, false},
		{"missing list", ProductDevicePage{Pagination: &Pagination{Limit: 25}}, false},
		{"impossible total", ProductDevicePage{[]Device{d}, &Pagination{Limit: 25}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/orgs/"+cloud+"/fleet/devices" || r.URL.Query().Get("product_id") != product || r.Header.Get("Authorization") != "Bearer global" {
					t.Error("scope or actor lost")
				}
				_ = json.NewEncoder(w).Encode(tc.page)
			}))
			defer s.Close()
			q := url.Values{"limit": {"25"}, "offset": {"0"}, "product_id": {"forged"}}
			_, err := New(s.URL).ProductDevices(context.Background(), "global", cloud, product, q)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if q.Get("product_id") != "forged" {
				t.Fatal("mutated caller query")
			}
		})
	}
}
