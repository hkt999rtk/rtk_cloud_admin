package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

const scopedDeviceID = "77777777-7777-4777-8777-000000000000"
const sharedDeviceID = "88888888-8888-4888-8888-000000000000"

func (f *scopedProductsFixture) resetDevices() {
	f.devices = map[string]accountclient.Device{}
	for i := 0; i < 26; i++ {
		id := fmt.Sprintf("77777777-7777-4777-8777-%012d", i)
		f.devices[id] = accountclient.Device{ID: id, OrganizationID: cloudA, DeviceItemProfileID: productA, Name: fmt.Sprintf("Camera device %02d", i), Category: "ip_camera", Model: "D1", Status: "registered", SerialNumber: fmt.Sprintf("serial-%02d", i), Metadata: map[string]any{"clip_public_key": "do-not-project", "credential": "secret-fixture"}}
	}
	f.devices[sharedDeviceID] = accountclient.Device{ID: sharedDeviceID, OrganizationID: cloudB, DeviceItemProfileID: sharedProductID, Name: "Shared device", Category: "mqtt_device", Status: "registered"}
}

// Called only with the synthetic fixture mutex held.
func (f *scopedProductsFixture) serveProductDevices(w http.ResponseWriter, r *http.Request, parts []string) bool {
	cloud := parts[2]
	if len(parts) == 5 && parts[3] == "fleet" && parts[4] == "devices" {
		items := []accountclient.Device{}
		for _, d := range f.devices {
			if d.OrganizationID == cloud && d.DeviceItemProfileID == r.URL.Query().Get("product_id") && strings.Contains(strings.ToLower(d.Name), strings.ToLower(r.URL.Query().Get("q"))) {
				items = append(items, d)
			}
		}
		sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
		total := len(items)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		start := min(offset, total)
		end := min(start+limit, total)
		items = items[start:end]
		if f.badDeviceScope && len(items) > 0 {
			items[0].DeviceItemProfileID = sharedProductID
		}
		writeJSON(w, map[string]any{"devices": items, "pagination": accountclient.Pagination{Limit: limit, Offset: offset, Total: total}})
		return true
	}
	if len(parts) == 5 && parts[3] == "devices" {
		d, ok := f.devices[parts[4]]
		if !ok || d.OrganizationID != cloud {
			http.NotFound(w, r)
			return true
		}
		writeJSON(w, map[string]any{"device": d})
		return true
	}
	if len(parts) == 8 && parts[3] == "device-item-profiles" && parts[5] == "devices" && parts[7] == "display" {
		d, ok := f.devices[parts[6]]
		if !ok || d.OrganizationID != cloud || d.DeviceItemProfileID != parts[4] {
			http.NotFound(w, r)
			return true
		}
		var in map[string]string
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, "bad input", 400)
			return true
		}
		if v, ok := in["name"]; ok {
			d.Name = v
		}
		if v, ok := in["model"]; ok {
			d.Model = v
		}
		f.devices[d.ID] = d
		f.writes = append(f.writes, r.Method+" "+r.URL.Path)
		f.keys = append(f.keys, r.Header.Get("Idempotency-Key"))
		writeJSON(w, map[string]any{"device": d})
		return true
	}
	return false
}

func TestProductDevicesExplicitScopeAndSafeDisplay(t *testing.T) {
	up, f := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(up.URL)})
	root := "/api/developer/brand-clouds/" + cloudA + "/products/" + productA + "/devices"
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "device-edit")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		method, path, body string
		code               int
	}{
		{"GET", root + "?limit=25&offset=25", "", 200},
		{"GET", root + "/" + scopedDeviceID, "", 200},
		{"PATCH", root + "/" + scopedDeviceID, `{"name":"Updated device","model":""}`, 200},
		{"PATCH", root + "/" + scopedDeviceID, `{"metadata":{"clip_public_key":"forged"}}`, 400},
		{"PATCH", root + "/" + scopedDeviceID, `{"name":"a","name":"b"}`, 400},
		{"PATCH", root + "/" + scopedDeviceID, `{"model":null}`, 400},
		{"GET", root + "?product_id=" + sharedProductID, "", 400},
		{"GET", root + "?limit=25&limit=10", "", 400},
		{"GET", root + "/" + sharedDeviceID, "", 404},
		{"GET", "/api/developer/brand-clouds/" + cloudA + "/products/33333333-3333-4333-8333-000000000001/devices/" + scopedDeviceID, "", 404},
		{"GET", "/api/developer/brand-clouds/" + cloudA + "/products/" + createdProductID + "/devices/" + scopedDeviceID, "", 404},
		{"PATCH", "/api/developer/brand-clouds/" + cloudB + "/products/" + sharedProductID + "/devices/" + sharedDeviceID, `{"name":"forbidden"}`, 403},
	} {
		w := call(tc.method, tc.path, tc.body)
		if w.Code != tc.code {
			t.Fatalf("%s %s: %d want %d: %s", tc.method, tc.path, w.Code, tc.code, w.Body)
		}
		if strings.Contains(w.Body.String(), "do-not-project") || strings.Contains(w.Body.String(), "credential") {
			t.Fatal("metadata escaped projection")
		}
	}
	w := call("GET", root+"/"+scopedDeviceID, "")
	if !strings.Contains(w.Body.String(), "Updated device") || !strings.Contains(w.Body.String(), "serial-00") {
		t.Fatal("display edit readback")
	}
	f.mu.Lock()
	if len(f.writes) != 1 || f.keys[0] != "device-edit" || f.devices[scopedDeviceID].Metadata["clip_public_key"] != "do-not-project" {
		t.Fatal("unsafe write")
	}
	f.allowed = false
	f.mu.Unlock()
	if w := call("PATCH", root+"/"+scopedDeviceID, `{"name":"revoked"}`); w.Code != 403 {
		t.Fatalf("revoked %d", w.Code)
	}
	f.mu.Lock()
	f.badDeviceScope = true
	f.mu.Unlock()
	if w := call("GET", root, ""); w.Code != 502 {
		t.Fatalf("wrong Product not withheld %d", w.Code)
	}
	current, _ := st.GetSession(session.ID)
	if current.ActiveOrgID != cloudB {
		t.Fatal("shared session scope was modified")
	}
}

func TestFleetDeviceRouteUsesExplicitCloudWithoutChangingSession(t *testing.T) {
	up, _ := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "owner-1", "owner@example.test", "global", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(up.URL)})
	r := httptest.NewRequest(http.MethodGet, "/api/developer/brand-clouds/"+cloudA+"/fleet/devices?limit=25&product_id="+productA, nil)
	r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("scoped fleet status=%d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Devices []struct {
			OrganizationID string `json:"organization_id"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Devices) == 0 {
		t.Fatal("scoped fleet returned no devices")
	}
	for _, device := range body.Devices {
		if device.OrganizationID != cloudA {
			t.Fatalf("device escaped explicit cloud: %q", device.OrganizationID)
		}
	}
	current, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.ActiveOrgID != cloudB {
		t.Fatalf("explicit scoped read mutated session: %q", current.ActiveOrgID)
	}
}
