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
	if !isVisibleFirmwareCampaignState(" scheduled ") || isVisibleFirmwareCampaignState("archived") {
		t.Fatalf("visible campaign state mapping failed")
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
