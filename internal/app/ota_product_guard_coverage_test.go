package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/videoclient"
)

func TestOTACampaignGuardUsesCampaignProductServiceSelection(t *testing.T) {
	account, fixture := newScopedProductsFixture(t)
	fixture.mu.Lock()
	product := fixture.products[productA]
	product.ServiceOptions = append(product.ServiceOptions, "ota")
	fixture.products[productA] = product
	fixture.mu.Unlock()

	type campaignResponse struct {
		status int
		body   string
	}
	var upstreamResponse atomic.Value
	upstreamResponse.Store(campaignResponse{http.StatusOK, `{"product_id":"` + productA + `"}`})
	video := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/ota/campaigns/campaign-1" {
			t.Errorf("campaign lookup = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer bff-secret" || r.Header.Get("X-Brand-Cloud-ID") != cloudA {
			t.Errorf("campaign lookup lost trusted BFF credentials or cloud scope: %#v", r.Header)
		}
		response := upstreamResponse.Load().(campaignResponse)
		w.WriteHeader(response.status)
		_, _ = w.Write([]byte(response.body))
	}))
	defer video.Close()
	s := NewWithOptions(mustOpenStore(t), Options{
		AccountClient: accountclient.New(account.URL),
		VideoClient:   videoclient.New(video.URL),
		Config:        config.Config{VideoCloudOTABFFToken: "bff-secret"},
	})
	check := func(wantAllowed bool, wantStatus int, wantCode string) {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/api/ota/campaigns/campaign-1", nil)
		allowed := s.requireOTACampaignProduct(w, r, "customer-token", cloudA, "campaign-1")
		if allowed != wantAllowed || w.Code != wantStatus || (wantCode != "" && !strings.Contains(w.Body.String(), `"code":"`+wantCode+`"`)) {
			t.Fatalf("campaign guard allowed=%t status=%d body=%s; want allowed=%t status=%d code=%q", allowed, w.Code, w.Body.String(), wantAllowed, wantStatus, wantCode)
		}
	}

	check(true, http.StatusOK, "")
	upstreamResponse.Store(campaignResponse{http.StatusNotFound, `{"code":"MISSING"}`})
	check(false, http.StatusNotFound, "OTA_CAMPAIGN_UNAVAILABLE")
	upstreamResponse.Store(campaignResponse{http.StatusOK, `{invalid`})
	check(false, http.StatusBadGateway, "OTA_UPSTREAM_ERROR")
	upstreamResponse.Store(campaignResponse{http.StatusOK, `{}`})
	check(false, http.StatusBadGateway, "OTA_UPSTREAM_ERROR")
	upstreamResponse.Store(campaignResponse{http.StatusOK, `{"product_id":"missing-product"}`})
	check(false, http.StatusNotFound, "PRODUCT_NOT_FOUND")
	upstreamResponse.Store(campaignResponse{http.StatusOK, `{"product_id":"` + productA + `"}`})
	fixture.mu.Lock()
	product = fixture.products[productA]
	product.ServiceOptions = []string{"mqtt"}
	fixture.products[productA] = product
	fixture.mu.Unlock()
	check(false, http.StatusConflict, "PRODUCT_OTA_NOT_ENABLED")
}

func TestOTACampaignGuardHandlesUnavailableSourceAndLegacyCatalog(t *testing.T) {
	account, _ := newScopedProductsFixture(t)
	r := httptest.NewRequest(http.MethodGet, "/api/ota/campaigns/campaign-1", nil)
	s := NewWithOptions(mustOpenStore(t), Options{AccountClient: accountclient.New(account.URL)})
	w := httptest.NewRecorder()
	allowed := s.requireOTACampaignProduct(w, r, "customer-token", cloudA, "campaign-1")
	if allowed || w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), `"code":"OTA_UPSTREAM_ERROR"`) {
		t.Fatalf("unavailable OTA source allowed=%t status=%d body=%s", allowed, w.Code, w.Body.String())
	}

	legacy := NewWithOptions(mustOpenStore(t), Options{})
	w = httptest.NewRecorder()
	if !legacy.requireOTACampaignProduct(w, r, "", cloudA, "campaign-1") || w.Code != http.StatusOK {
		t.Fatalf("legacy catalog campaign guard status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	if !legacy.requireOTAProduct(w, r.Context(), "", cloudA, productA) || w.Code != http.StatusOK {
		t.Fatalf("legacy catalog product guard status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestProductOTABFFDoesNotProxyUnselectedService(t *testing.T) {
	var otaEnabled atomic.Bool
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer customer-token" {
			t.Errorf("account request lost customer token: %#v", r.Header)
		}
		switch r.URL.Path {
		case "/v1/me":
			_, _ = w.Write([]byte(`{"user":{"id":"owner-1"},"organizations":[{"id":"` + cloudA + `","role":"owner","capabilities":["ota.plan.read"]}]}`))
		case "/v1/orgs/" + cloudA + "/access/check":
			if r.URL.Query().Get("scope_id") != productA || r.URL.Query().Get("permission") != "registry_device.read" {
				t.Errorf("unexpected Product access check: %s", r.URL.String())
			}
			_, _ = w.Write([]byte(`{"allowed":true}`))
		case "/v1/orgs/" + cloudA + "/device-item-profiles/" + productA:
			options := `["mqtt"]`
			if otaEnabled.Load() {
				options = `["mqtt","ota"]`
			}
			_, _ = w.Write([]byte(`{"device_item_profile":{"id":"` + productA + `","brand_cloud_id":"` + cloudA + `","status":"active","service_options":` + options + `}}`))
		default:
			t.Errorf("unexpected account request: %s", r.URL.String())
			http.NotFound(w, r)
		}
	}))
	defer account.Close()
	var proxyCalls atomic.Int32
	video := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/v1/ota/products/"+productA+"/campaigns" || r.Header.Get("X-Brand-Cloud-ID") != cloudA {
			t.Errorf("unexpected OTA proxy request: %s %s %#v", r.Method, r.URL.Path, r.Header)
		}
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer video.Close()
	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "owner-1", "owner@example.test", "customer-token", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{
		AccountClient: accountclient.New(account.URL),
		VideoClient:   videoclient.New(video.URL),
		Config:        config.Config{VideoCloudOTABFFToken: "bff-secret"},
	})
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/ota/products/"+productA+"/campaigns", nil)
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	w := request()
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), `"code":"PRODUCT_OTA_NOT_ENABLED"`) || proxyCalls.Load() != 0 {
		t.Fatalf("OTA-disabled Product status=%d body=%s proxy_calls=%d", w.Code, w.Body.String(), proxyCalls.Load())
	}
	otaEnabled.Store(true)
	w = request()
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"items":[]`) || proxyCalls.Load() != 1 {
		t.Fatalf("OTA-enabled Product status=%d body=%s proxy_calls=%d", w.Code, w.Body.String(), proxyCalls.Load())
	}
}
