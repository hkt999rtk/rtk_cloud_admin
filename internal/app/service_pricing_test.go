package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
)

func TestPricingReferencesRequireCurrentCloudOwnerAndWorkWithoutBillingService(t *testing.T) {
	const cloudID = "11111111-1111-4111-8111-111111111111"
	const ownerID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const viewerID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	var version atomic.Int64
	version.Store(7)
	var ownerActive atomic.Bool
	ownerActive.Store(true)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/developer/brand-clouds/"+cloudID {
			t.Fatalf("unexpected account route %s", r.URL.Path)
		}
		role, subject := "viewer", viewerID
		if r.Header.Get("Authorization") == "Bearer owner-access" && ownerActive.Load() {
			role, subject = "owner", ownerID
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"brand_cloud":{"id":"` + cloudID + `","owner_user_id":"` + ownerID + `","my_role":"` + role + `","ownership_version":` + strconv.FormatInt(version.Load(), 10) + `,"capabilities":["billing_account.read"],"test_subject":"` + subject + `"}}`))
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	owner, err := st.CreateSession("customer", ownerID, "owner@example.com", "owner-access", "refresh", cloudID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := st.CreateSession("customer", viewerID, "viewer@example.com", "viewer-access", "refresh", cloudID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{
		Config:        config.Config{AccountManagerBaseURL: upstream.URL},
		AccountClient: accountclient.New(upstream.URL),
	})
	if srv.billingClient != nil && srv.billingClient.Enabled() {
		t.Fatal("test must exercise pricing without a configured Billing service")
	}
	path := "/api/developer/brand-clouds/" + cloudID + "/billing/pricing-references"
	request := func(sessionID, locale string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if sessionID != "" {
			req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: sessionID})
		}
		if locale != "" {
			req.Header.Set("X-RTK-Locale", locale)
		}
		res := httptest.NewRecorder()
		srv.ServeHTTP(res, req)
		return res
	}
	if got := request("", ""); got.Code != http.StatusUnauthorized || strings.Contains(got.Body.String(), "reference_price") {
		t.Fatalf("anonymous pricing response: %d %s", got.Code, got.Body.String())
	}
	accountReq := httptest.NewRequest(http.MethodGet, "/api/developer/brand-clouds/"+cloudID+"/billing/account", nil)
	accountRes := httptest.NewRecorder()
	srv.ServeHTTP(accountRes, accountReq)
	if accountRes.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous Billing access during service outage: %d", accountRes.Code)
	}
	if got := request(viewer.ID, ""); got.Code != http.StatusForbidden || strings.Contains(got.Body.String(), "reference_price") {
		t.Fatalf("viewer pricing response: %d %s", got.Code, got.Body.String())
	}
	got := request(owner.ID, "zh-TW")
	if got.Code != http.StatusOK || got.Header().Get("Cache-Control") != "no-store" || got.Header().Get("X-Cloud-Ownership-Version") != "7" || got.Header().Get("Content-Language") != "zh-TW" {
		t.Fatalf("owner pricing response: %d headers=%v body=%s", got.Code, got.Header(), got.Body.String())
	}
	var result struct {
		CloudID string                  `json:"cloud_id"`
		Catalog pricingReferenceCatalog `json:"catalog"`
	}
	if err := json.Unmarshal(got.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.CloudID != cloudID || len(result.Catalog.Rows) != 15 || result.Catalog.FXNoteLocalized == "" {
		t.Fatalf("incomplete scoped pricing catalog: %#v", result)
	}
	approved := 0
	for _, row := range result.Catalog.Rows {
		if row.Price != nil {
			approved++
		}
		if row.ReferencePrice <= 0 || row.BenchmarkLocalized == "" {
			t.Fatalf("missing localized benchmark for %s", row.ID)
		}
	}
	if approved != 4 {
		t.Fatalf("approved but inactive OTA prices=%d, want 4", approved)
	}
	version.Store(8)
	if changed := request(owner.ID, "en"); changed.Code != http.StatusOK || changed.Header().Get("X-Cloud-Ownership-Version") != "8" {
		t.Fatalf("pricing request did not recheck ownership version: %d headers=%v", changed.Code, changed.Header())
	}
	ownerActive.Store(false)
	if revoked := request(owner.ID, "en"); revoked.Code != http.StatusForbidden || strings.Contains(revoked.Body.String(), "reference_price") {
		t.Fatalf("revoked owner still received prices: %d %s", revoked.Code, revoked.Body.String())
	}
}
