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

func TestPatchProductDeviceDisplayPreservesScopeIdempotencyAndBody(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const product = "33333333-3333-4333-8333-333333333333"
	const device = "77777777-7777-4777-8777-000000000000"
	for _, tc := range []struct {
		name     string
		status   int
		response Device
		wantErr  bool
	}{
		{"success", http.StatusOK, Device{ID: device, OrganizationID: cloud, DeviceItemProfileID: product, Name: "Lobby"}, false},
		{"upstream error", http.StatusConflict, Device{}, true},
		{"wrong cloud", http.StatusOK, Device{ID: device, OrganizationID: product, DeviceItemProfileID: product}, true},
		{"wrong Product", http.StatusOK, Device{ID: device, OrganizationID: cloud, DeviceItemProfileID: cloud}, true},
		{"wrong device", http.StatusOK, Device{ID: product, OrganizationID: cloud, DeviceItemProfileID: product}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPatch || r.URL.Path != "/v1/orgs/"+cloud+"/device-item-profiles/"+product+"/devices/"+device+"/display" || r.Header.Get("Authorization") != "Bearer global" || r.Header.Get("Idempotency-Key") != "display-retry" {
					t.Error("write scope, actor or idempotency key lost")
				}
				var body map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["name"] != "Lobby" || len(body) != 1 {
					t.Errorf("request body: %#v %v", body, err)
				}
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"device": tc.response})
			}))
			defer s.Close()
			got, err := New(s.URL).PatchProductDeviceDisplay(context.Background(), "global", cloud, product, device, "display-retry", map[string]string{"name": "Lobby"})
			if (err != nil) != tc.wantErr {
				t.Fatalf("got=%+v err=%v wantErr=%v", got, err, tc.wantErr)
			}
		})
	}
}
