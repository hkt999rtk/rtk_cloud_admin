package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

const sharedProductID = "55555555-5555-4555-8555-555555555555"
const createdProductID = "66666666-6666-4666-8666-666666666666"
const fixtureProductionRunID = "77777777-7777-4777-8777-777777777777"

type scopedProductsFixture struct {
	mu             sync.Mutex
	products       map[string]accountclient.DeviceItemProfile
	writes         []string
	keys           []string
	badScope       bool
	allowed        bool
	revoked        bool
	clouds         *managedCloudFixture
	devices        map[string]accountclient.Device
	runs           map[string]accountclient.ProductionRun
	badDeviceScope bool
}

func newScopedProductsFixture(t *testing.T) (*httptest.Server, *scopedProductsFixture) {
	t.Helper()
	base, clouds := managedCloudFixtureServer(t)
	clouds.mu.Lock()
	owner := clouds.clouds[cloudA]
	owner.Capabilities = append(owner.Capabilities, "product.manage")
	clouds.clouds[cloudA] = owner
	clouds.mu.Unlock()
	f := &scopedProductsFixture{products: map[string]accountclient.DeviceItemProfile{}, runs: map[string]accountclient.ProductionRun{}, allowed: true, clouds: clouds}
	f.resetDevices()
	for i := 0; i < 27; i++ {
		id := fmt.Sprintf("33333333-3333-4333-8333-%012d", i)
		if i == 0 {
			id = productA
		}
		pkiStatus := ""
		if i == 0 {
			pkiStatus = "ready"
		}
		f.products[id] = accountclient.DeviceItemProfile{ID: id, BrandCloudID: cloudA, ProfileKey: fmt.Sprintf("camera-%02d", i), DisplayName: fmt.Sprintf("Camera %02d", i), Status: "active", PKIStatus: pkiStatus, Category: "ip_camera", Model: "R1", ServiceOptions: []string{"mqtt"}, CurrentUserRole: "product_owner"}
	}
	f.products[sharedProductID] = accountclient.DeviceItemProfile{ID: sharedProductID, BrandCloudID: cloudB, ProfileKey: "shared-product", DisplayName: "Shared sensor", Status: "active", Category: "mqtt_device", ServiceOptions: []string{"mqtt"}, CurrentUserRole: "product_owner", MetadataDefaults: map[string]any{"private_key": "never-project-this"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/platform/service-options" {
			if r.URL.Query().Get("brand_cloud_id") != cloudA {
				http.Error(w, "wrong cloud", 403)
				return
			}
			writeJSON(w, map[string]any{"catalog_revision": 7, "product_writes_enabled": true, "options": []map[string]any{{"code": "mqtt", "display_name": "MQTT", "selectable": true}, {"code": "iot_shadow", "display_name": "IoT Shadow", "selectable": true, "requires": []string{"mqtt"}}, {"code": "video_storage", "display_name": "Video storage", "selectable": true, "requires": []string{"mqtt"}}}})
			return
		}
		f.mu.Lock()
		revoked := f.revoked
		f.mu.Unlock()
		if revoked && r.URL.Path == "/v1/developer/brand-clouds/"+cloudA {
			http.Error(w, "revoked", 403)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/v1/orgs/") {
			base.Config.Handler.ServeHTTP(w, r)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) < 4 {
			http.NotFound(w, r)
			return
		}
		cloud := parts[2]
		if len(parts) >= 6 && parts[3] == "device-item-profiles" && parts[5] == "production-runs" {
			product, ok := f.products[parts[4]]
			if !ok || product.BrandCloudID != cloud {
				http.NotFound(w, r)
				return
			}
			if r.Method == http.MethodGet && len(parts) == 6 {
				runs := []accountclient.ProductionRun{}
				for _, run := range f.runs {
					if run.DeviceItemProfileID == product.ID {
						runs = append(runs, run)
					}
				}
				writeJSON(w, map[string]any{"production_runs": runs})
				return
			}
			if r.Method == http.MethodPost && len(parts) == 8 && parts[7] == "stop" {
				run, ok := f.runs[parts[6]]
				if !ok {
					http.NotFound(w, r)
					return
				}
				run.Status = "disabled"
				f.runs[run.ID] = run
				writeJSON(w, map[string]any{"production_run": run})
				return
			}
			if r.Method == http.MethodPost && len(parts) == 6 {
				var input productionRunInput
				if json.NewDecoder(r.Body).Decode(&input) != nil {
					http.Error(w, "bad run", 400)
					return
				}
				run := accountclient.ProductionRun{ID: fixtureProductionRunID, DeviceItemProfileID: product.ID, FactoryID: input.FactoryID, BatchID: input.BatchID, Status: "active", AllowedQuantity: input.AllowedQuantity, ValidUntil: time.Now().Add(time.Duration(input.ValidHours) * time.Hour).Format(time.RFC3339)}
				f.runs[run.ID] = run
				writeJSONStatus(w, http.StatusCreated, map[string]any{"production_run": run, "factory_jwt": "fixture-secret-shown-once", "expires_at": run.ValidUntil})
				return
			}
			http.NotFound(w, r)
			return
		}
		if f.serveProductDevices(w, r, parts) {
			return
		}
		if len(parts) == 5 && parts[3] == "access" && parts[4] == "check" {
			writeJSON(w, map[string]bool{"allowed": f.allowed})
			return
		}
		if parts[3] != "device-item-profiles" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Billing-Owner-User-ID") != "" {
			t.Error("browser authority header reached upstream")
		}
		if r.Method == "GET" {
			if len(parts) == 4 {
				items := []accountclient.DeviceItemProfile{}
				for _, p := range f.products {
					if p.BrandCloudID == cloud && (r.URL.Query().Get("status") == "" || r.URL.Query().Get("status") == p.Status) {
						items = append(items, p)
					}
				}
				sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
				total := len(items)
				limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
				offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
				if limit < 1 {
					limit = 25
				}
				start := min(offset, total)
				end := min(start+limit, total)
				items = items[start:end]
				if f.badScope && len(items) > 0 {
					items[0].BrandCloudID = cloudB
				}
				writeJSON(w, map[string]any{"device_item_profiles": items, "pagination": accountclient.Pagination{Limit: limit, Offset: offset, Total: total}})
				return
			}
			p, ok := f.products[parts[4]]
			if !ok || p.BrandCloudID != cloud {
				http.NotFound(w, r)
				return
			}
			if f.badScope {
				p.BrandCloudID = cloudB
			}
			writeJSON(w, map[string]any{"device_item_profile": p})
			return
		}
		var body map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad fixture JSON", 400)
			return
		}
		f.writes = append(f.writes, r.Method+" "+r.URL.Path)
		f.keys = append(f.keys, r.Header.Get("Idempotency-Key"))
		p := accountclient.DeviceItemProfile{ID: createdProductID, BrandCloudID: cloud, Status: "active", CurrentUserRole: "product_owner"}
		code := 201
		if len(parts) > 4 {
			var ok bool
			p, ok = f.products[parts[4]]
			if !ok || p.BrandCloudID != cloud {
				http.NotFound(w, r)
				return
			}
			code = 200
		}
		for key, value := range body {
			switch key {
			case "profile_key":
				_ = json.Unmarshal(value, &p.ProfileKey)
			case "display_name":
				_ = json.Unmarshal(value, &p.DisplayName)
			case "category":
				_ = json.Unmarshal(value, &p.Category)
			case "model":
				_ = json.Unmarshal(value, &p.Model)
			case "service_options":
				_ = json.Unmarshal(value, &p.ServiceOptions)
			}
		}
		if len(parts) > 5 && parts[5] == "disable" {
			p.Status = "disabled"
		}
		f.products[p.ID] = p
		writeJSONStatus(w, code, map[string]any{"device_item_profile": p})
	}))
	t.Cleanup(server.Close)
	return server, f
}

func TestScopedProductCRUDUsesRequestedCloudAndCurrentAuthority(t *testing.T) {
	upstream, f := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	request := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "product-intent")
		r.Header.Set("X-Billing-Owner-User-ID", "forged")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	root := "/api/developer/brand-clouds/" + cloudA + "/products"
	catalog := request("GET", "/api/developer/brand-clouds/"+cloudA+"/service-options", "")
	if catalog.Code != 200 || !strings.Contains(catalog.Body.String(), `"catalog_revision":7`) || !strings.Contains(catalog.Body.String(), `"product_writes_enabled":true`) || !strings.Contains(catalog.Body.String(), `"iot_shadow"`) {
		t.Fatalf("service catalog %d %s", catalog.Code, catalog.Body)
	}
	list := request("GET", root+"?limit=25&offset=25", "")
	if list.Code != 200 || !strings.Contains(list.Body.String(), `"total":27`) {
		t.Fatalf("pagination %d %s", list.Code, list.Body)
	}
	create := request("POST", root, `{"name":"Created camera","profile_key":"created-camera","product_model":"M1","category":"ip_camera","service_options":["mqtt"]}`)
	if create.Code != 201 || !strings.Contains(create.Body.String(), createdProductID) {
		t.Fatalf("create %d %s", create.Code, create.Body)
	}
	update := request("PATCH", root+"/"+createdProductID, `{"name":"Updated camera","service_options":["mqtt","video_storage"]}`)
	if update.Code != 200 || !strings.Contains(update.Body.String(), "Updated camera") {
		t.Fatalf("update %d %s", update.Code, update.Body)
	}
	plugin := request("PATCH", root+"/"+createdProductID, `{"service_options":["mqtt","iot_shadow","custom_option"],"catalog_revision":7}`)
	if plugin.Code != 200 || !strings.Contains(plugin.Body.String(), "custom_option") {
		t.Fatalf("catalog-driven option %d %s", plugin.Code, plugin.Body)
	}
	disabled := request("POST", root+"/"+createdProductID+"/disable", `{}`)
	if disabled.Code != 200 || !strings.Contains(disabled.Body.String(), `"status":"disabled"`) {
		t.Fatalf("disable %d %s", disabled.Code, disabled.Body)
	}
	fresh := request("GET", root+"/"+createdProductID, "")
	if fresh.Code != 200 || !strings.Contains(fresh.Body.String(), `"status":"disabled"`) {
		t.Fatal("write did not survive readback")
	}
	for _, tc := range []struct {
		method, path, body string
		code               int
	}{
		{"PATCH", root + "/" + sharedProductID, `{"name":"wrong cloud"}`, 404},
		{"POST", "/api/developer/brand-clouds/" + cloudB + "/products", `{"name":"viewer write"}`, 403},
		{"PATCH", "/api/developer/brand-clouds/" + cloudB + "/products/" + sharedProductID, `{"name":"viewer write"}`, 403},
		{"GET", root + "?brand_cloud_id=" + cloudB, "", 400},
		{"GET", root + "?limit=25&limit=50", "", 400},
		{"PATCH", root + "/" + createdProductID, `{"name":"a","name":"b"}`, 400},
		{"PATCH", root + "/" + createdProductID, `{"owner_user_id":"forged"}`, 400},
		{"PATCH", root + "/" + createdProductID, `{"name":null}`, 400},
		{"PATCH", root + "/" + createdProductID, `{"profile_key":"changed"}`, 400},
		{"PATCH", root + "/" + createdProductID, `{"service_options":[]}`, 400},
		{"PATCH", root + "/" + createdProductID, `{"service_options":["mqtt","mqtt"]}`, 400},
	} {
		w := request(tc.method, tc.path, tc.body)
		if w.Code != tc.code {
			t.Errorf("%s %s: %d want %d", tc.method, tc.path, w.Code, tc.code)
		}
	}
	viewer := request("GET", "/api/developer/brand-clouds/"+cloudB+"/products/"+sharedProductID, "")
	if viewer.Code != 200 || strings.Contains(viewer.Body.String(), "private_key") || strings.Contains(viewer.Body.String(), `"edit"`) {
		t.Fatalf("viewer ceiling/projection %d %s", viewer.Code, viewer.Body)
	}
	current, _ := st.GetSession(session.ID)
	if current.ActiveOrgID != cloudB {
		t.Fatal("Product request mutated session scope")
	}
	f.mu.Lock()
	if len(f.writes) != 4 {
		t.Errorf("unauthorized mutation delivered: %v", f.writes)
	}
	for _, key := range f.keys {
		if key != "product-intent" {
			t.Error("lost retry key")
		}
	}
	f.allowed = false
	f.mu.Unlock()
	if w := request("PATCH", root+"/"+createdProductID, `{"name":"revoked"}`); w.Code != 403 {
		t.Fatalf("revoked ACL %d", w.Code)
	}
	f.mu.Lock()
	f.badScope = true
	f.mu.Unlock()
	if w := request("GET", root, ""); w.Code != 502 {
		t.Fatalf("wrong upstream cloud %d", w.Code)
	}
}

func TestScopedProductWriteBoundaryAndEditorCeiling(t *testing.T) {
	upstream, f := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("account", "owner-1", "owner@example.test", "global", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	path := "/api/developer/brand-clouds/" + cloudA + "/products/" + productA
	for _, tc := range []struct {
		name, origin, key string
		code              int
	}{
		{"foreign origin", "https://other.example", "intent", 403},
		{"missing key", "", "", 400},
		{"invalid key", "", "invalid key", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("PATCH", path, strings.NewReader(`{"name":"forbidden"}`))
			r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			r.Header.Set("Content-Type", "application/json")
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.key != "" {
				r.Header.Set("Idempotency-Key", tc.key)
			}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != tc.code {
				t.Fatalf("status=%d want %d", w.Code, tc.code)
			}
		})
	}
	f.clouds.mu.Lock()
	c := f.clouds.clouds[cloudA]
	c.MyRole = "member"
	c.Capabilities = []string{"product.read"}
	f.clouds.clouds[cloudA] = c
	f.clouds.mu.Unlock()
	f.mu.Lock()
	p := f.products[productA]
	p.CurrentUserRole = "product_editor"
	f.products[productA] = p
	f.mu.Unlock()
	for _, tc := range []struct {
		method, suffix, body string
		code                 int
	}{
		{"POST", "/disable", `{}`, 403},
		{"PATCH", "", `{"name":"` + strings.Repeat("雲", 255) + `"}`, 200},
		{"PATCH", "", `{"name":"` + strings.Repeat("雲", 256) + `"}`, 400},
	} {
		r := httptest.NewRequest(tc.method, path+tc.suffix, strings.NewReader(tc.body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "editor-intent")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != tc.code {
			t.Fatalf("%s %s: status=%d want %d: %s", tc.method, tc.suffix, w.Code, tc.code, w.Body)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.writes) != 1 {
		t.Fatalf("only the valid editor update may reach upstream: %v", f.writes)
	}
}

func TestScopedProductBrowserFixture(t *testing.T) {
	if os.Getenv("SCOPED_PRODUCT_UI_FIXTURE") != "1" {
		t.Skip("opt-in disposable UI fixture")
	}
	t.Chdir("../..")
	upstream, f := newScopedProductsFixture(t)
	st := mustOpenStore(t)
	session, err := st.CreateSession("account", "owner-1", "demo@example.test", "fixture-access", "", cloudB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	port := os.Getenv("SCOPED_PRODUCT_UI_PORT")
	s.cfg.FactoryEnrollPublicBaseURL = "https://factory-enroll.video-cloud-dev.example.test"
	if port == "" {
		port = "18197"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	fmt.Printf("Disposable Product UI fixture: http://%s\n", listener.Addr())
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && (r.URL.Path == "/__fixture__/revoke" || r.URL.Path == "/__fixture__/reset" || r.URL.Path == "/__fixture__/invalid-products") {
			f.mu.Lock()
			f.revoked = r.URL.Path == "/__fixture__/revoke"
			f.badScope = r.URL.Path == "/__fixture__/invalid-products"
			if r.URL.Path == "/__fixture__/reset" {
				delete(f.products, createdProductID)
				clear(f.runs)
				f.resetDevices()
				f.clouds.mu.Lock()
				clear(f.clouds.sharingInvites)
				f.clouds.mu.Unlock()
			}
			f.mu.Unlock()
			w.WriteHeader(204)
			return
		}
		r.Header.Set("Cookie", "rtk_admin_session="+session.ID)
		s.ServeHTTP(w, r)
	})
	// CI launches the compiled test binary directly. Graceful termination lets
	// testing run cleanup for the temporary SQLite store and upstream server.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		t.Fatal(err)
	}
}
