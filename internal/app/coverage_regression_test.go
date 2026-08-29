package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"

	cloudlogger "github.com/hkt999rtk/rtk_cloud_logger"
)

func TestCustomerScopedFallbackEndpointsAndLogout(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	if err := st.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: "ops@example.com", Action: "DeviceProvisionRequested", Target: "dev-001", OrganizationID: "org-acme"}); err != nil {
		t.Fatalf("CreateAuditEventWithMetadata acme returned error: %v", err)
	}
	if err := st.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: "ops@example.com", Action: "DeviceProvisionRequested", Target: "dev-004", OrganizationID: "org-nova"}); err != nil {
		t.Fatalf("CreateAuditEventWithMetadata nova returned error: %v", err)
	}
	session, err := st.CreateSession("customer", "u1", "user@example.com", "access", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	srv := NewWithOptions(st, Options{})

	summaryRec := requestWithCookie(t, srv, http.MethodGet, "/api/summary", nil, cookie)
	if summaryRec.Code != http.StatusOK {
		t.Fatalf("summary status = %d, body=%s", summaryRec.Code, summaryRec.Body.String())
	}
	var summary contracts.Summary
	decodeJSON(t, summaryRec, &summary)
	if summary.Customers != 1 || summary.TotalDevices != 2 || summary.ActivatedDevices != 2 {
		t.Fatalf("customer summary = %#v", summary)
	}

	customersRec := requestWithCookie(t, srv, http.MethodGet, "/api/customers", nil, cookie)
	if customersRec.Code != http.StatusOK {
		t.Fatalf("customers status = %d, body=%s", customersRec.Code, customersRec.Body.String())
	}
	var customers []contracts.CustomerSummary
	decodeJSON(t, customersRec, &customers)
	if len(customers) != 1 || customers[0].OrganizationID != "org-acme" {
		t.Fatalf("customers = %#v", customers)
	}

	opsRec := requestWithCookie(t, srv, http.MethodGet, "/api/operations", nil, cookie)
	if opsRec.Code != http.StatusOK {
		t.Fatalf("operations status = %d, body=%s", opsRec.Code, opsRec.Body.String())
	}
	var ops []contracts.Operation
	decodeJSON(t, opsRec, &ops)
	for _, op := range ops {
		if op.DeviceID != "dev-001" && op.DeviceID != "dev-002" {
			t.Fatalf("operation leaked out-of-org device: %#v", op)
		}
	}

	auditRec := requestWithCookie(t, srv, http.MethodGet, "/api/audit", nil, cookie)
	if auditRec.Code != http.StatusOK {
		t.Fatalf("audit status = %d, body=%s", auditRec.Code, auditRec.Body.String())
	}
	var audit []contracts.AuditEvent
	decodeJSON(t, auditRec, &audit)
	if len(audit) == 0 {
		t.Fatalf("audit events = %#v, want at least one org-scoped event", audit)
	}
	for _, event := range audit {
		if event.Target != "dev-001" && event.Target != "dev-002" {
			t.Fatalf("audit leaked out-of-org event: %#v", event)
		}
	}

	logoutRec := requestWithCookie(t, srv, http.MethodPost, "/api/auth/logout", nil, cookie)
	if logoutRec.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body=%s", logoutRec.Code, logoutRec.Body.String())
	}
	cleared := false
	for _, c := range logoutRec.Result().Cookies() {
		if c.Name == "rtk_admin_session" && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatalf("logout did not clear session cookie: %#v", logoutRec.Result().Cookies())
	}
	if _, err := st.GetSession(session.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetSession after logout err = %v, want sql.ErrNoRows", err)
	}

	repeatLogout := requestWithCookie(t, srv, http.MethodPost, "/api/auth/logout", nil, cookie)
	if repeatLogout.Code != http.StatusOK {
		t.Fatalf("repeat logout status = %d, body=%s", repeatLogout.Code, repeatLogout.Body.String())
	}
}

func TestAdminReadModelsAndRouteGuards(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{})
	customerSession, err := st.CreateSession("customer", "u1", "user@example.com", "", "", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	adminSession, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession admin returned error: %v", err)
	}

	unauth := requestWithCookie(t, srv, http.MethodGet, "/api/admin/summary", nil, nil)
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauth admin summary status = %d", unauth.Code)
	}
	blocked := requestWithCookie(t, srv, http.MethodGet, "/api/admin/devices", nil, &http.Cookie{Name: "rtk_admin_session", Value: customerSession.ID})
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("customer admin devices status = %d", blocked.Code)
	}

	adminCookie := &http.Cookie{Name: "rtk_admin_session", Value: adminSession.ID}
	for _, path := range []string{"/api/admin/summary", "/api/admin/customers", "/api/admin/devices", "/api/admin/service-health"} {
		rec := requestWithCookie(t, srv, http.MethodGet, path, nil, adminCookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%s content type = %q", path, rec.Header().Get("Content-Type"))
		}
	}
}

func TestMiscHandlerEdgesForCoverageGate(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	customerSession, err := st.CreateSession("customer", "u1", "user@example.com", "", "", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession customer returned error: %v", err)
	}
	badOrgSession, err := st.CreateSession("customer", "u2", "bad@example.com", "", "", "org-missing", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession bad org returned error: %v", err)
	}
	adminSession, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession admin returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{})

	if rec := requestWithCookie(t, srv, http.MethodGet, "/assets/missing.js", nil, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d", rec.Code)
	}
	if rec := requestWithCookie(t, srv, http.MethodGet, "/api/summary", nil, nil); rec.Code != http.StatusOK {
		t.Fatalf("demo summary status = %d, body=%s", rec.Code, rec.Body.String())
	}

	customerCookie := &http.Cookie{Name: "rtk_admin_session", Value: customerSession.ID}
	badOrgCookie := &http.Cookie{Name: "rtk_admin_session", Value: badOrgSession.ID}
	adminCookie := &http.Cookie{Name: "rtk_admin_session", Value: adminSession.ID}
	if rec := requestWithCookie(t, srv, http.MethodGet, "/api/summary", nil, badOrgCookie); rec.Code != http.StatusForbidden {
		t.Fatalf("bad org summary status = %d, body=%s", rec.Code, rec.Body.String())
	}
	for _, path := range []string{"/api/fleet/health-summary?window=90d", "/api/fleet/stream-stats?window=90d"} {
		rec := requestWithCookie(t, srv, http.MethodGet, path, nil, customerCookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
	}
	if rec := requestWithCookie(t, srv, http.MethodPost, "/api/devices/dev-002/deactivate", nil, adminCookie); rec.Code != http.StatusForbidden {
		t.Fatalf("admin deactivate status = %d", rec.Code)
	}
	if rec := requestWithCookie(t, srv, http.MethodPost, "/api/devices/dev-002/deactivate", nil, customerCookie); rec.Code != http.StatusCreated {
		t.Fatalf("customer deactivate status = %d, body=%s", rec.Code, rec.Body.String())
	}

	okUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer okUpstream.Close()
	downUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer downUpstream.Close()
	if got := srv.upstreamHealth(t.Context(), "Custom", okUpstream.URL, func(context.Context) error { return nil }); got.Status != "ok" {
		t.Fatalf("upstreamHealth ok = %#v", got)
	}
	if got := srv.httpHealth(t.Context(), "Video Cloud", downUpstream.URL); got.Status != "down" {
		t.Fatalf("httpHealth down = %#v", got)
	}
}

func TestCoverageGovernancePureHelpers(t *testing.T) {
	t.Parallel()

	original := map[string]any{"query": "online", "keep": true}
	merged := mergeBatchJobScope(original, map[string]any{"query": "offline", "added": 2})
	if merged["query"] != "offline" || merged["keep"] != true || merged["added"] != 2 {
		t.Fatalf("mergeBatchJobScope = %#v", merged)
	}
	if original["query"] != "online" {
		t.Fatalf("mergeBatchJobScope mutated input: %#v", original)
	}
	if maxInt(3, 2) != 3 || maxInt(-1, 0) != 0 {
		t.Fatal("maxInt returned an unexpected result")
	}

	if got := stringSetDiff([]string{"mqtt", "video", "ota"}, []string{"video"}); strings.Join(got, ",") != "mqtt,ota" {
		t.Fatalf("stringSetDiff = %#v", got)
	}
	if got := customerServiceOptions([]string{"影像服務", "即時觀看", "錄影與保存", "設備回報", "unknown"}); len(got) != 3 {
		t.Fatalf("customerServiceOptions = %#v", got)
	}
	if got := customerServiceOptions([]string{"video_streaming", "video_storage", "mqtt", "ota"}); len(got) != 4 {
		t.Fatalf("stable customer service option codes must remain accepted: %#v", got)
	}

	profile := accountclient.DeviceItemProfile{
		ID:                 "product-1",
		DisplayName:        "Camera",
		Model:              "RTK-CAM",
		Category:           "camera",
		Status:             "active",
		ServiceOptions:     []string{"video", "webrtc", "clips", "mqtt", "ota", "unknown"},
		ClaimPolicy:        map[string]any{"enabled": true},
		ProvisioningPolicy: map[string]any{"enabled": true},
		UpdatedAt:          "2026-07-24T00:00:00Z",
	}
	summary := &accountclient.FleetSummary{
		ByProduct:         map[string]int{"product-1": 7},
		ByProductRegion:   map[string]map[string]int{"product-1": {"ap-northeast": 7}},
		ByProductFirmware: map[string]map[string]int{"product-1": {"1.0.0": 7}},
	}
	product := customerProductWithActionsAndSummary(profile, []string{
		"registry_device.manage",
		"ota_campaign:create",
		"report.read",
	}, summary)
	if product.ID != "product-1" || product.DeviceCount != 7 || len(product.ServiceCapabilities) != 5 || len(product.AllowedActions) != 4 {
		t.Fatalf("customerProductWithActionsAndSummary = %#v", product)
	}
	if got := customerProduct(profile); got.ID != profile.ID {
		t.Fatalf("customerProduct = %#v", got)
	}
	for role, wantActions := range map[string]int{
		"product_owner":  7,
		"brand_owner":    6,
		"product_editor": 5,
		"product_viewer": 2,
	} {
		if actions := productAllowedActionsForRole(role, nil); len(actions) != wantActions {
			t.Fatalf("productAllowedActionsForRole(%q) = %#v, want %d actions", role, actions, wantActions)
		}
	}

	if got := scopeStringSlice([]any{" a ", 1, "", "b"}); strings.Join(got, ",") != "a,b" {
		t.Fatalf("scopeStringSlice([]any) = %#v", got)
	}
	if got := scopeStringSlice([]string{" a ", "", "b"}); strings.Join(got, ",") != "a,b" {
		t.Fatalf("scopeStringSlice([]string) = %#v", got)
	}
	device := accountclient.Device{
		DeviceItemProfileID: "product-1",
		Category:            "camera",
		Model:               "RTK-CAM",
		Status:              "online",
		Readiness:           "ready",
		Metadata:            map[string]any{"region": "ap-northeast", "firmware": "1.0.0"},
	}
	if !deviceMatchesScopeQuery(device, map[string]any{
		"product_id": "product-1", "region": []string{"ap-northeast"}, "status": "online",
	}) {
		t.Fatal("deviceMatchesScopeQuery rejected matching device")
	}
	if deviceMatchesScopeQuery(device, map[string]any{"model": "other"}) {
		t.Fatal("deviceMatchesScopeQuery accepted mismatching device")
	}
	if deviceMatchesScopeQuery(accountclient.Device{}, map[string]any{"region": "ap-northeast"}) {
		t.Fatal("deviceMatchesScopeQuery accepted missing device field")
	}

	orgs := []accountclient.Organization{{ID: "org-1", Role: "owner"}}
	if role, ok := organizationRole(orgs, "org-1"); !ok || role != "owner" {
		t.Fatalf("organizationRole found = %q, %v", role, ok)
	}
	if _, ok := organizationRole(orgs, "missing"); ok {
		t.Fatal("organizationRole unexpectedly found missing organization")
	}
	if workloadNameFromPod("video-cloud-api-7d6f4c9f8b-abc12") != "video-cloud-api" ||
		workloadNameFromPod("redis-0") != "redis" ||
		workloadNameFromPod("postgres") != "postgres" {
		t.Fatal("workloadNameFromPod returned an unexpected workload")
	}
}

func TestImmutableOTAScopeValidationWithoutUpstream(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New("")})
	query := map[string]any{"product_id": "product-1", "region": []any{"ap-northeast"}}
	scope := map[string]any{
		"expires_at":          time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
		"query":               query,
		"excluded_device_ids": []any{"dev-1"},
	}
	scope["scope_hash"] = batchScopeHash(map[string]any{
		"query": query, "excluded_device_ids": scope["excluded_device_ids"],
	})
	if err := srv.validateImmutableOTAScope(t.Context(), "token", "org-1", scope); err != nil {
		t.Fatalf("validateImmutableOTAScope valid scope: %v", err)
	}

	for name, mutate := range map[string]func(map[string]any){
		"expired": func(candidate map[string]any) {
			candidate["expires_at"] = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
		},
		"invalid timestamp": func(candidate map[string]any) { candidate["expires_at"] = "not-a-time" },
		"missing query":     func(candidate map[string]any) { delete(candidate, "query") },
		"invalid hash":      func(candidate map[string]any) { candidate["scope_hash"] = "sha256:invalid" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := make(map[string]any, len(scope))
			for key, value := range scope {
				candidate[key] = value
			}
			mutate(candidate)
			if err := srv.validateImmutableOTAScope(t.Context(), "token", "org-1", candidate); err == nil {
				t.Fatalf("validateImmutableOTAScope(%s) returned nil", name)
			}
		})
	}
}

func TestVideoCloudGatewayErrorClassification(t *testing.T) {
	t.Parallel()

	srv := &Server{logger: cloudlogger.Nop()}
	for name, test := range map[string]struct {
		err  error
		code int
	}{
		"timeout": {context.DeadlineExceeded, http.StatusGatewayTimeout},
		"gateway": {errVideoCloudRequestFailed, http.StatusBadGateway},
		"generic": {errors.New("unexpected"), http.StatusInternalServerError},
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			srv.writeVideoCloudGatewayError(rec, test.err)
			if rec.Code != test.code {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, test.code, rec.Body.String())
			}
		})
	}
}

func TestLegacyUpstreamCustomerAndDeviceHelpers(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer access" {
			t.Fatalf("Authorization = %q, want Bearer access", got)
		}
		switch r.URL.Path {
		case "/v1/orgs":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"organizations": []map[string]any{
					{"id": "org-a", "name": "Alpha", "role": "owner"},
					{"id": "org-b", "name": "Beta", "role": "operator"},
				},
			})
		case "/v1/orgs/org-a/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "dev-a1", "organization_id": "org-a", "organization": "Alpha", "name": "alpha-one", "model": "RTK-CAM-A", "serial_number": "A1", "status": "online", "readiness": "online", "last_seen_at": "2026-05-09T00:00:00Z"},
					{"id": "dev-a2", "organization_id": "org-a", "organization": "Alpha", "name": "alpha-two", "model": "RTK-CAM-A", "serial_number": "A2", "status": "ready", "readiness": "activated", "last_seen_at": "2026-05-08T00:00:00Z"},
				},
			})
		case "/v1/orgs/org-b/devices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "dev-b1", "organization_id": "org-b", "organization": "Beta", "name": "beta-one", "model": "RTK-CAM-B", "serial_number": "B1", "status": "failed", "readiness": "failed", "last_seen_at": "2026-05-07T00:00:00Z"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "user@example.com", "access", "refresh", "org-a", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	req := httptest.NewRequest(http.MethodGet, "/legacy", nil)
	req.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})

	customers, handled := srv.upstreamCustomers(httptest.NewRecorder(), req)
	if !handled {
		t.Fatalf("upstreamCustomers handled = false")
	}
	if len(customers) != 2 || customers[0].TotalDevices != 2 || customers[0].OnlineDevices != 1 || customers[0].ActivatedDevices != 2 || customers[1].FailedDevices != 1 {
		t.Fatalf("customers = %#v", customers)
	}

	devices, handled := srv.upstreamDevices(httptest.NewRecorder(), req)
	if !handled {
		t.Fatalf("upstreamDevices handled = false")
	}
	if len(devices) != 3 || devices[0].ID != "dev-a1" || devices[2].Readiness != contracts.ReadinessFailed {
		t.Fatalf("devices = %#v", devices)
	}

	plainReq := httptest.NewRequest(http.MethodGet, "/legacy", nil)
	if customers, handled := srv.upstreamCustomers(httptest.NewRecorder(), plainReq); handled || customers != nil {
		t.Fatalf("upstreamCustomers without session customers=%#v handled=%v", customers, handled)
	}
}

func TestBrandFleetReadRoutesUseActiveOrganization(t *testing.T) {
	t.Parallel()

	var upstreamPaths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamPaths = append(upstreamPaths, r.Method+" "+r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/me" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{"id": "developer-1", "email": "developer@example.com"},
				"organizations": []map[string]any{{
					"id": "org-1", "name": "Brand One", "role": "owner",
					"capabilities": []string{
						capabilityFleetRead, capabilityFleetDeviceManage, capabilityFleetBatchManage,
						capabilityProductRead, capabilityProductManage, capabilityProductPolicyManage,
						capabilityFirmwareReleaseRead, capabilityFirmwareReleaseManage,
						capabilityOTAPlanRead, capabilityOTAPlanManage,
						capabilityReportsRead, capabilityReportsCreate,
						capabilityTeamRead, capabilityTeamManage,
						capabilityProvisioningRead, capabilityProvisioningCreate,
					},
				}},
				"capabilities": []string{capabilityFleetRead},
			})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/access/check") {
			_, _ = w.Write([]byte(`{"allowed":true}`))
			return
		}
		if r.URL.Path == "/v1/developer/product-collaborator-invitations/accept" && r.Header.Get("Authorization") == "Bearer error-access" {
			http.Error(w, "upstream Product invitation acceptance failure", http.StatusInternalServerError)
			return
		}
		if strings.Contains(r.URL.Path, "/products/product-error/") {
			http.Error(w, "upstream Product collaboration failure", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "developer-1", "developer@example.com", "access", "refresh", "org-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	paths := []string{
		"/api/developer/brand-clouds?limit=25",
		"/api/developer/brand-clouds/brand-1",
		"/api/developer/brand-clouds/brand-1/members?limit=25",
		"/api/developer/brand-clouds/brand-1/members/invitations",
		"/api/fleet/devices?limit=25&status=online",
		"/api/fleet/summary",
		"/api/groups?limit=25",
		"/api/groups/group-1",
		"/api/tags?limit=25",
		"/api/roles?limit=25",
		"/api/permissions?limit=25",
		"/api/role-assignments?limit=25",
		"/api/jobs/job-1",
		"/api/jobs/job-1/result",
		"/api/jobs?limit=25",
		"/api/reports?limit=25",
		"/api/reports/report-1",
		"/api/products?limit=25",
		"/api/products/product-1",
		"/api/products/product-1/collaborators",
		"/api/products/product-1/releases",
		"/api/products/product-1/releases/release-1",
		"/api/products/product-1/permissions",
		"/api/update-plans?limit=25",
		"/api/update-plans/plan-1",
	}
	for _, path := range paths {
		rec := requestWithCookie(t, srv, http.MethodGet, path, nil, cookie)
		expectedBoundary := (strings.Contains(path, "/releases") && (rec.Code == http.StatusForbidden || rec.Code == http.StatusServiceUnavailable)) ||
			(path == "/api/update-plans/plan-1" && rec.Code == http.StatusServiceUnavailable)
		if !expectedBoundary && (rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden || rec.Code >= 500) {
			t.Errorf("%s status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
	}
	writeHeaders := http.Header{"Content-Type": {"application/json"}, "Idempotency-Key": {"coverage-route"}}
	writes := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations", `{"email":"new@example.com","role":"observer"}`},
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations/invitation-1/resend", `{}`},
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations/invitation-1/cancel", `{}`},
		{http.MethodPost, "/api/developer/brand-cloud-member-invitations/accept", `{"token":"invitation-token"}`},
		{http.MethodPatch, "/api/developer/brand-clouds/brand-1/members/user-1", `{"role":"operations"}`},
		{http.MethodPatch, "/api/developer/brand-clouds/brand-1/members/user-1/disable", `{}`},
		{http.MethodPatch, "/api/developer/brand-clouds/brand-1/members/user-1/enable", `{}`},
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/owner-transfer", `{"target_email":"owner@example.com"}`},
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/owner-transfer/transfer-1/cancel", `{}`},
		{http.MethodPost, "/api/developer/brand-cloud-owner-transfers/accept", `{"token":"owner-token"}`},
		{http.MethodPost, "/api/developer/product-collaborator-invitations/accept", `{"token":"product-invitation-token"}`},
		{http.MethodPost, "/api/groups", `{"name":"Cameras","device_ids":["device-1"]}`},
		{http.MethodPatch, "/api/groups/group-1", `{"name":"Updated Cameras","device_ids":["device-1"]}`},
		{http.MethodDelete, "/api/groups/group-1", ``},
		{http.MethodPost, "/api/role-assignments", `{"principal_id":"user-1","role_id":"operator","scope_type":"organization","scope_id":"org-1"}`},
		{http.MethodDelete, "/api/role-assignments/assignment-1", ``},
		{http.MethodPost, "/api/jobs", `{"type":"report_export","name":"Coverage job","scope":{"device_ids":["device-1"]}}`},
		{http.MethodPost, "/api/jobs/job-1/retry", `{}`},
		{http.MethodPost, "/api/jobs/job-1/cancel", `{}`},
		{http.MethodPost, "/api/reports", `{"name":"Coverage report","type":"fleet","scope":{"device_ids":["device-1"]}}`},
		{http.MethodPost, "/api/products", `{"id":"product-coverage","name":"Coverage Product","service_options":["mqtt"]}`},
		{http.MethodPatch, "/api/products/product-1", `{"name":"Updated Product","service_options":["mqtt"]}`},
		{http.MethodPost, "/api/products/product-1/disable", `{}`},
		{http.MethodPost, "/api/products/product-1/impact-preview", `{"service_options":["mqtt","video"]}`},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations", `{"email":"collaborator@example.com","role":"product_editor"}`},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations/invitation-1/resend", `{}`},
		{http.MethodPatch, "/api/products/product-1/collaborators/user-1", `{"role":"product_viewer"}`},
		{http.MethodDelete, "/api/products/product-1/collaborators/user-1", ``},
		{http.MethodPost, "/api/products/product-1/owner-transfer", `{"target_user_id":"user-1"}`},
		{http.MethodPost, "/api/update-plans/scope-preview", `{"product_id":"product-1","device_ids":["device-1"]}`},
	}
	for _, write := range writes {
		rec := authenticatedRequest(srv, session.ID, write.method, write.path, strings.NewReader(write.body), writeHeaders)
		if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden || rec.Code >= 500 {
			t.Errorf("%s %s status = %d, body=%s", write.method, write.path, rec.Code, rec.Body.String())
		}
	}
	invitationUnknownAction := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations/invitation-1/unknown", strings.NewReader(`{}`), writeHeaders)
	if invitationUnknownAction.Code != http.StatusNotFound {
		t.Errorf("unknown invitation action status = %d, want 404", invitationUnknownAction.Code)
	}
	invitationInvalidToken := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/developer/brand-cloud-member-invitations/accept", strings.NewReader(`{"token":""}`), writeHeaders)
	if invitationInvalidToken.Code != http.StatusBadRequest {
		t.Errorf("invalid invitation token status = %d, want 400", invitationInvalidToken.Code)
	}
	productInvitationUnknownAction := authenticatedRequest(srv, session.ID, http.MethodPost, "/api/products/product-1/collaborator-invitations/invitation-1/unknown", strings.NewReader(`{}`), writeHeaders)
	if productInvitationUnknownAction.Code != http.StatusNotFound {
		t.Errorf("unknown Product invitation action status = %d, want 404", productInvitationUnknownAction.Code)
	}
	for _, invalid := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/api/developer/product-collaborator-invitations/accept", `{"token":""}`},
		{http.MethodPost, "/api/developer/product-collaborator-invitations/accept", `{`},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations", `{"email":""}`},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations", `{`},
		{http.MethodPatch, "/api/products/product-1/collaborators/user-1", `{`},
		{http.MethodPost, "/api/products/product-1/owner-transfer", `{"target_user_id":""}`},
		{http.MethodPost, "/api/products/product-1/owner-transfer", `{`},
	} {
		rec := authenticatedRequest(srv, session.ID, invalid.method, invalid.path, strings.NewReader(invalid.body), writeHeaders)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("invalid Product collaboration request %s status = %d, want 400", invalid.path, rec.Code)
		}
	}
	for _, request := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations"},
		{http.MethodPost, "/api/developer/brand-cloud-member-invitations/accept"},
		{http.MethodPost, "/api/developer/product-collaborator-invitations/accept"},
		{http.MethodGet, "/api/products/product-1/collaborators"},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations"},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations/invitation-1/resend"},
		{http.MethodPatch, "/api/products/product-1/collaborators/user-1"},
		{http.MethodPost, "/api/products/product-1/owner-transfer"},
	} {
		if rec := requestWithCookie(t, srv, request.method, request.path, strings.NewReader(`{}`), nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("unauthenticated invitation route %s status = %d, want 401", request.path, rec.Code)
		}
	}
	for _, request := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/developer/brand-clouds/brand-1/members/invitations/invitation-1/resend"},
		{http.MethodPost, "/api/developer/brand-cloud-member-invitations/accept"},
		{http.MethodPost, "/api/developer/product-collaborator-invitations/accept"},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations"},
		{http.MethodPost, "/api/products/product-1/collaborator-invitations/invitation-1/resend"},
		{http.MethodPatch, "/api/products/product-1/collaborators/user-1"},
		{http.MethodPost, "/api/products/product-1/owner-transfer"},
	} {
		if rec := authenticatedRequest(srv, session.ID, request.method, request.path, strings.NewReader(`{}`), nil); rec.Code != http.StatusPreconditionRequired {
			t.Errorf("invitation route %s without idempotency key status = %d, want 428", request.path, rec.Code)
		}
	}
	for _, request := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/products/product-error/collaborators", ``},
		{http.MethodPost, "/api/products/product-error/collaborator-invitations", `{"email":"collaborator@example.com","role":"product_editor"}`},
		{http.MethodPost, "/api/products/product-error/collaborator-invitations/invitation-1/resend", `{}`},
		{http.MethodPatch, "/api/products/product-error/collaborators/user-1", `{"role":"product_viewer"}`},
		{http.MethodDelete, "/api/products/product-error/collaborators/user-1", ``},
		{http.MethodPost, "/api/products/product-error/owner-transfer", `{"target_user_id":"user-1"}`},
	} {
		rec := authenticatedRequest(srv, session.ID, request.method, request.path, strings.NewReader(request.body), writeHeaders)
		if rec.Code < http.StatusBadRequest {
			t.Errorf("upstream Product collaboration failure %s status = %d, want error", request.path, rec.Code)
		}
	}
	errorSession, err := st.CreateSession("customer", "developer-2", "error@example.com", "error-access", "refresh", "org-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	acceptFailure := authenticatedRequest(srv, errorSession.ID, http.MethodPost, "/api/developer/product-collaborator-invitations/accept", strings.NewReader(`{"token":"product-invitation-token"}`), writeHeaders)
	if acceptFailure.Code < http.StatusBadRequest {
		t.Errorf("upstream Product invitation acceptance status = %d, want error", acceptFailure.Code)
	}
	missingOrgSession, err := st.CreateSession("customer", "developer-3", "missing@example.com", "access", "refresh", "org-missing", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	missingOrg := requestWithCookie(t, srv, http.MethodGet, "/api/products/product-1/collaborators", nil, &http.Cookie{Name: "rtk_admin_session", Value: missingOrgSession.ID})
	if missingOrg.Code < http.StatusBadRequest {
		t.Errorf("missing active organization status = %d, want error", missingOrg.Code)
	}
	if len(upstreamPaths) < 15 {
		t.Fatalf("upstream requests = %d, want broad Brand Fleet route coverage", len(upstreamPaths))
	}
}

func TestCustomerErrorMappingResponses(t *testing.T) {
	t.Parallel()

	srv := NewWithOptions(mustOpenStore(t), Options{})
	tests := []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{"invalid session", errCustomerSessionInvalid, http.StatusUnauthorized, "customer session expired"},
		{"invalid active org", errCustomerActiveOrgInvalid, http.StatusForbidden, "active organization"},
		{"video cloud", errVideoCloudRequestFailed, http.StatusBadGateway, "Video Cloud request failed"},
		{"upstream forbidden", &accountclient.HTTPError{StatusCode: http.StatusForbidden}, http.StatusForbidden, "denied access"},
		{"upstream not found", &accountclient.HTTPError{StatusCode: http.StatusNotFound}, http.StatusBadGateway, "request failed"},
		{"upstream timeout", context.DeadlineExceeded, http.StatusGatewayTimeout, "timed out"},
		{"generic", errors.New("disk full"), http.StatusInternalServerError, "disk full"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			srv.writeCustomerError(rec, tt.err)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.status, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.body) {
				t.Fatalf("body = %q, want substring %q", rec.Body.String(), tt.body)
			}
		})
	}
}

func TestTelemetryPayloadAndSummaryHelpers(t *testing.T) {
	t.Parallel()

	payload := json.RawMessage(`{"summary":"explicit summary","enabled":"true","low_memory":true,"rssi_dbm":"-81","quality":"poor","signals":["low_rssi","bad","recent_crash","low_rssi"]}`)
	if got := telemetryStringPayload(payload, "summary"); got != "explicit summary" {
		t.Fatalf("telemetryStringPayload = %q", got)
	}
	if !telemetryBoolPayload(payload, "enabled") || !telemetryBoolPayload(payload, "low_memory") || telemetryBoolPayload(json.RawMessage(`{`), "enabled") {
		t.Fatalf("telemetryBoolPayload did not handle bool/string/invalid payload")
	}
	rssi := telemetryIntPayload(payload, "rssi_dbm")
	if rssi == nil || *rssi != -81 {
		t.Fatalf("telemetryIntPayload string = %v", rssi)
	}
	if got := telemetryIntPayload(json.RawMessage(`{"rssi_dbm":-81.5}`), "rssi_dbm"); got != nil {
		t.Fatalf("telemetryIntPayload fractional = %v, want nil", got)
	}
	signals := telemetrySignalsFromPayload(payload)
	if len(signals) != 3 || signals[0] != "low_rssi" || signals[1] != "recent_crash" || signals[2] != "low_rssi" {
		t.Fatalf("telemetrySignalsFromPayload = %#v", signals)
	}

	events := []videoclient.DeviceTelemetryEvent{
		{EventType: "device.health.rssi_sample", Payload: json.RawMessage(`{"rssi_dbm":-82,"quality":"poor"}`)},
		{EventType: "device.health.memory_sample", Payload: json.RawMessage(`{"low_memory":"true"}`)},
		{EventType: "device.reboot.reported", Payload: json.RawMessage(`{"reason":"ota"}`)},
		{EventType: "device.crash.reported", Payload: json.RawMessage(`{"reason":"segfault"}`)},
		{EventType: "device.health.offline_risk", Payload: json.RawMessage(`{}`)},
	}
	upstreamSignals := telemetrySignalsFromUpstream(&videoclient.DeviceTelemetryHealth{State: "mystery", Payload: payload}, events)
	for _, want := range []string{"low_rssi", "recent_crash", "low_memory", "recent_reboot", "offline_risk"} {
		if !containsString(upstreamSignals, want) {
			t.Fatalf("signals = %#v, missing %s", upstreamSignals, want)
		}
	}

	if got := telemetryHealthFromUpstream(&videoclient.DeviceTelemetryHealth{State: "good"}, nil); got != "healthy" {
		t.Fatalf("health good = %q", got)
	}
	if got := telemetryHealthFromUpstream(nil, []string{"recent_reboot"}); got != "warning" {
		t.Fatalf("health reboot = %q", got)
	}
	if got := telemetryHealthFromUpstream(nil, []string{"recent_crash"}); got != "critical" {
		t.Fatalf("health crash = %q", got)
	}
	if got := telemetryHealthFromUpstream(nil, nil); got != "unknown" {
		t.Fatalf("health unknown = %q", got)
	}
	for raw, want := range map[string]string{
		"warn":     "warning",
		"fair":     "warning",
		"crit":     "critical",
		"offline":  "critical",
		"unknown":  "unknown",
		"nonsense": "",
	} {
		if got := canonicalTelemetryHealthState(raw); got != want {
			t.Fatalf("canonicalTelemetryHealthState(%q) = %q, want %q", raw, got, want)
		}
	}
	for readiness, want := range map[contracts.ReadinessState]string{
		contracts.ReadinessOnline:                 "healthy",
		contracts.ReadinessActivated:              "warning",
		contracts.ReadinessCloudActivationPending: "warning",
		contracts.ReadinessClaimPending:           "warning",
		contracts.ReadinessFailed:                 "critical",
		contracts.ReadinessRegistered:             "unknown",
		contracts.ReadinessDeactivated:            "unknown",
	} {
		if got := telemetryHealthFromReadiness(readiness); got != want {
			t.Fatalf("telemetryHealthFromReadiness(%q) = %q, want %q", readiness, got, want)
		}
	}
	if got := telemetryOnlinePctFromUptimeSec(-1); got != 0 {
		t.Fatalf("negative uptime pct = %v", got)
	}
	if got := telemetryOnlinePctFromUptimeSec(2 * telemetrySecondsPerDay); got != 100 {
		t.Fatalf("large uptime pct = %v", got)
	}

	summaryCases := map[string]videoclient.DeviceTelemetryEvent{
		"Signal quality is poor at -82 dBm":      events[0],
		"Device reboot reported: ota":            events[2],
		"Crash reported: segfault":               events[3],
		"Firmware version observed: v1.2.4":      {EventType: "firmware.version.observed", Payload: json.RawMessage(`{"current_version":"v1.2.4"}`)},
		"custom event":                           {EventType: "custom.event", Payload: json.RawMessage(`{}`)},
		"explicit summary":                       {EventType: "ignored", Payload: payload},
		"Signal quality measured at -80 dBm":     {EventType: "device.health.rssi_sample", Payload: json.RawMessage(`{"rssi_dbm":-80}`)},
		"Firmware version observed":              {EventType: "firmware.version.observed", Payload: json.RawMessage(`{}`)},
		"Firmware version observed: v1.2.3-beta": {EventType: "firmware.version.observed", Payload: json.RawMessage(`{"firmware_version":"v1.2.3-beta"}`)},
	}
	for want, event := range summaryCases {
		if got := telemetryEventSummary(event); got != want {
			t.Fatalf("telemetryEventSummary(%s) = %q, want %q", event.EventType, got, want)
		}
	}
}

func TestFirmwareReadModelHelpers(t *testing.T) {
	t.Parallel()

	if got := latestFirmwareVersion(videoclient.FirmwareEnumResponse{Versions: []string{"v1.0.0", " v1.2.0 "}}); got != "v1.2.0" {
		t.Fatalf("latestFirmwareVersion versions = %q", got)
	}
	if got := latestFirmwareVersion(videoclient.FirmwareEnumResponse{Releases: []videoclient.FirmwareRelease{{Version: "v1.2.9"}, {Version: "v1.10.0"}, {Version: ""}}}); got != "v1.10.0" {
		t.Fatalf("latestFirmwareVersion releases = %q", got)
	}
	for _, state := range []string{"draft", "scheduled", "active", "paused", "completed", "canceled"} {
		if !isVisibleFirmwareCampaignState(state) {
			t.Fatalf("campaign state %q should be visible", state)
		}
	}
	for _, state := range []string{"archived", "unknown", ""} {
		if isVisibleFirmwareCampaignState(state) {
			t.Fatalf("campaign state %q should not be visible", state)
		}
	}

	rollouts := []videoclient.FirmwareRolloutRecord{
		{DeviceID: "vc-2", AccountDeviceID: "dev-2", DeviceName: "Camera B", CurrentVersion: "v1.0.0", TargetVersion: "v1.2.0", RolloutStatus: "applied", UpdatedAt: "2026-05-08T00:00:00Z"},
		{DeviceID: "vc-1", DeviceName: "Camera A", TargetVersion: "v1.2.0", Status: "failed", Reason: "offline", LastUpdated: "2026-05-07T00:00:00Z"},
		{DeviceID: "vc-3", DeviceName: "Camera C", TargetVersion: "v1.2.0", Status: "eligible", LastUpdated: "2026-05-06T00:00:00Z"},
		{DeviceID: "vc-4", DeviceName: "Camera D", TargetVersion: "v1.2.0", Status: "mystery"},
	}
	campaign := summarizeFirmwareCampaign(videoclient.FirmwareCampaignRecord{CampaignID: "camp-1", TargetVersion: "v1.2.0", UpdatedAt: "2026-05-09T00:00:00Z"}, rollouts)
	if campaign.CampaignID != "camp-1" || campaign.Policy != "normal" || campaign.State != "active" {
		t.Fatalf("campaign defaults = %#v", campaign)
	}
	if campaign.Applied != 1 || campaign.Failed != 1 || campaign.Pending != 2 || campaign.Total != 4 {
		t.Fatalf("campaign counts = %#v", campaign)
	}
	if campaign.UpdatedAt != "2026-05-09T00:00:00Z" {
		t.Fatalf("campaign updated_at = %q", campaign.UpdatedAt)
	}
	if campaign.Rollouts[0].DeviceName != "Camera B" || campaign.Rollouts[1].FailureReason != "offline" {
		t.Fatalf("rollout ordering/details = %#v", campaign.Rollouts)
	}
	if got := summarizeFirmwareCampaign(videoclient.FirmwareCampaignRecord{}, nil); got.CampaignID != "" {
		t.Fatalf("empty campaign = %#v", got)
	}
	if got := oldestFirmwareTimestamp(rollouts); got.Format(time.RFC3339) != "2026-05-06T00:00:00Z" {
		t.Fatalf("oldestFirmwareTimestamp = %s", got.Format(time.RFC3339))
	}
	if !parseFirmwareTimestamp("not-a-time").IsZero() {
		t.Fatalf("invalid timestamp should parse to zero")
	}

	devices := []contracts.Device{
		{ID: "dev-1", VideoCloudDevID: "vc-1"},
		{ID: "dev-2", VideoCloudDevID: "vc-2"},
		{ID: "dev-3"},
	}
	dist := buildFirmwareDistribution("org-acme", devices, map[string]string{"vc-1": "v1.2.0", "dev-2": "v1.1.0"}, map[string]bool{"v1.2.0": true}, []contracts.FirmwareDistributionCampaign{campaign})
	if dist.OrgID != "org-acme" || len(dist.Versions) != 3 || dist.Versions[0].Version != "v1.2.0" || !dist.Versions[0].IsLatest {
		t.Fatalf("firmware distribution = %#v", dist)
	}
	if !matchesFirmwareRolloutDevice(devices[0], videoclient.FirmwareRolloutRecord{DeviceID: "vc-1"}) || !matchesFirmwareRolloutDevice(devices[1], videoclient.FirmwareRolloutRecord{AccountDeviceID: "dev-2"}) {
		t.Fatalf("matchesFirmwareRolloutDevice failed")
	}
	keys := firmwareCampaignKeys("camp-1", " ", "camp-1", "camp-2")
	if len(keys) != 2 || keys[0] != "camp-1" || keys[1] != "camp-2" {
		t.Fatalf("firmwareCampaignKeys = %#v", keys)
	}
}

func TestCanonicalFirmwareCampaignSummary(t *testing.T) {
	t.Parallel()
	campaign := videoclient.OTACampaignRecord{ID: "ota-1", ReleaseID: "release-1", State: "completed", TargetSnapshotCount: 4, CreatedAt: "2026-08-28T01:00:00Z", UpdatedAt: "2026-08-28T01:04:00Z", ActivatedAt: "2026-08-28T01:01:00Z"}
	deployments := []videoclient.OTADeploymentRecord{
		{DeviceID: "device-1", Status: "succeeded", CurrentVersion: "v1.2.4", TargetVersion: "v1.2.4", UpdatedAt: "2026-08-28T01:03:00Z"},
		{DeviceID: "device-2", Status: "failed", CurrentVersion: "v1.2.3", ErrorReason: "checksum", UpdatedAt: "2026-08-28T01:05:00Z"},
	}
	summary := videoclient.OTACampaignSummary{CampaignID: "ota-1", State: "completed", Total: 4, ByStatus: map[string]int{"succeeded": 1, "failed": 1, "skipped": 1, "pending": 1}, UpdatedAt: "2026-08-28T01:04:00Z"}
	devices := map[string]contracts.Device{"device-1": {ID: "device-1", Name: "Camera A"}, "device-2": {ID: "device-2", Name: "Camera B"}}
	got := summarizeCanonicalFirmwareCampaign(campaign, "v1.2.4", deployments, summary, devices)
	if got.CampaignID != "ota-1" || got.TargetVersion != "v1.2.4" || got.State != "completed" {
		t.Fatalf("canonical campaign identity = %#v", got)
	}
	if got.Applied != 1 || got.Failed != 1 || got.Skipped != 1 || got.Pending != 1 || got.Total != 4 {
		t.Fatalf("canonical campaign counts = %#v", got)
	}
	if got.UpdatedAt != "2026-08-28T01:05:00Z" || got.Rollouts[0].DeviceName != "Camera B" || got.Rollouts[0].FailureReason != "checksum" {
		t.Fatalf("canonical rollout details = %#v", got)
	}
	for input, want := range map[string]string{"succeeded": "applied", "offered": "eligible", "failed": "failed", "timed_out": "failed", "rolled_back": "failed", "skipped": "skipped", "canceled": "canceled", "downloading": "downloading", "installing": "downloading"} {
		if value := canonicalDeploymentRolloutStatus(input); value != want {
			t.Fatalf("canonicalDeploymentRolloutStatus(%q) = %q, want %q", input, value, want)
		}
	}
	if got := canonicalDeploymentSummaryBucket("canceled"); got != "skipped" {
		t.Fatalf("canonicalDeploymentSummaryBucket(canceled) = %q", got)
	}
}

func requestWithCookie(t *testing.T, srv *Server, method, path string, body *strings.Reader, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body != nil {
		reader = body
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(out); err != nil {
		t.Fatalf("decode JSON body %q: %v", rec.Body.String(), err)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
