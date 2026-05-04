package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/readinessfacts"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"
)

type Server struct {
	store         *store.Store
	mux           *http.ServeMux
	cfg           config.Config
	accountClient *accountclient.Client
	videoClient   *videoclient.Client
}

type Options struct {
	Config        config.Config
	AccountClient *accountclient.Client
	VideoClient   *videoclient.Client
}

func NewTestServer(dbPath string) (*Server, error) {
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, err
	}
	if err := st.Migrate(); err != nil {
		_ = st.Close()
		return nil, err
	}
	if err := st.SeedDemoData(); err != nil {
		_ = st.Close()
		return nil, err
	}
	return New(st), nil
}

func New(st *store.Store) *Server {
	return NewWithOptions(st, Options{})
}

func NewWithOptions(st *store.Store, opts Options) *Server {
	if opts.AccountClient == nil && opts.Config.AccountManagerBaseURL != "" {
		opts.AccountClient = accountclient.New(opts.Config.AccountManagerBaseURL)
	}
	if opts.VideoClient == nil && opts.Config.VideoCloudBaseURL != "" {
		opts.VideoClient = videoclient.New(opts.Config.VideoCloudBaseURL)
	}
	s := &Server{store: st, mux: http.NewServeMux(), cfg: opts.Config, accountClient: opts.AccountClient, videoClient: opts.VideoClient}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /api/summary", s.apiSummary)
	s.mux.HandleFunc("GET /api/admin/summary", s.apiAdminSummary)
	s.mux.HandleFunc("GET /api/me", s.apiMe)
	s.mux.HandleFunc("POST /api/me/active-org", s.apiActiveOrg)
	s.mux.HandleFunc("POST /api/auth/customer/login", s.apiCustomerLogin)
	s.mux.HandleFunc("POST /api/auth/platform/login", s.apiPlatformLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.apiLogout)
	s.mux.HandleFunc("GET /api/customers", s.apiCustomers)
	s.mux.HandleFunc("GET /api/admin/customers", s.apiAdminCustomers)
	s.mux.HandleFunc("GET /api/devices", s.apiDevices)
	s.mux.HandleFunc("GET /api/admin/devices", s.apiAdminDevices)
	s.mux.HandleFunc("GET /api/devices/{id}", s.apiDevice)
	s.mux.HandleFunc("GET /api/devices/{id}/telemetry", s.apiDeviceTelemetry)
	s.mux.HandleFunc("GET /api/operations", s.apiOperations)
	s.mux.HandleFunc("GET /api/admin/operations", s.apiAdminOperations)
	s.mux.HandleFunc("GET /api/service-health", s.apiServiceHealth)
	s.mux.HandleFunc("GET /api/admin/service-health", s.apiAdminServiceHealth)
	s.mux.HandleFunc("GET /api/audit", s.apiAudit)
	s.mux.HandleFunc("GET /api/admin/audit", s.apiAdminAudit)
	s.mux.HandleFunc("POST /api/devices/{id}/provision", s.apiProvisionDevice)
	s.mux.HandleFunc("POST /api/devices/{id}/deactivate", s.apiDeactivateDevice)
	s.mux.HandleFunc("GET /assets/", s.assets)
	s.mux.HandleFunc("GET /", s.home)
	s.mux.HandleFunc("GET /console", s.shell)
	s.mux.HandleFunc("GET /console/devices", s.shell)
	s.mux.HandleFunc("GET /admin", s.shell)
	s.mux.HandleFunc("GET /admin/operations", s.shell)
	s.mux.HandleFunc("GET /console/customers", s.shell)
	s.mux.HandleFunc("GET /console/operations", s.shell)
	s.mux.HandleFunc("GET /console/audit", s.shell)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok\n"))
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		http.Redirect(w, r, "/console", http.StatusFound)
		return
	}
	http.NotFound(w, r)
}

func (s *Server) shell(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}
	if served := serveDistIndex(w, r); served {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RTK Cloud Admin</title>
</head>
<body>
  <div id="root">
    <h1>RTK Cloud Admin</h1>
    <p>Customer Fleet</p>
    <p>Platform Operations</p>
    <p>cam-a-001</p>
    <p>DeviceProvisionRequested</p>
  </div>
</body>
</html>`))
}

func (s *Server) assets(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join("web", "dist", strings.TrimPrefix(r.URL.Path, "/"))
	if _, err := os.Stat(path); err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, path)
}

func serveDistIndex(w http.ResponseWriter, r *http.Request) bool {
	path := filepath.Join("web", "dist", "index.html")
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false
		}
		return false
	}
	http.ServeFile(w, r, path)
	return true
}

func (s *Server) apiSummary(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		summary, err := s.customerSummary(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, summary)
		return
	}
	summary, err := s.store.Summary()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, summary)
}

func (s *Server) apiAdminSummary(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	summary, err := s.store.Summary()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, summary)
}

func (s *Server) apiMe(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok {
		writeJSON(w, contracts.Me{
			UserID:        "demo-user",
			Email:         "demo@example.local",
			Name:          "Demo User",
			Kind:          "demo",
			ActiveOrgID:   "org-acme",
			DemoMode:      !s.accountClient.Enabled(),
			Authenticated: false,
			Memberships: []contracts.Membership{
				{OrganizationID: "org-acme", Organization: "Acme Smart Camera", Role: "owner"},
				{OrganizationID: "org-nova", Organization: "Nova Home Labs", Role: "operator"},
			},
		})
		return
	}
	if session.Kind == "platform_admin" {
		writeJSON(w, contracts.Me{UserID: session.Subject, Email: session.Email, Name: session.Email, Kind: session.Kind, Authenticated: true})
		return
	}
	me := contracts.Me{UserID: session.Subject, Email: session.Email, Name: session.Email, Kind: session.Kind, ActiveOrgID: session.ActiveOrgID, Authenticated: true}
	if s.accountClient.Enabled() {
		upstream, tokens, err := s.resolveCustomerProfile(r.Context(), accountclient.Tokens{
			AccessToken:  session.AccessToken,
			RefreshToken: session.RefreshToken,
		})
		if tokens.AccessToken != "" && (tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken) {
			_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		if err != nil {
			if errors.Is(err, errCustomerSessionInvalid) {
				s.invalidateCustomerSession(w, session.ID)
			}
			s.writeCustomerError(w, err)
			return
		}
		me.UserID = upstream.User.ID
		me.Email = upstream.User.Email
		me.Name = fallback(upstream.User.Name, upstream.User.Email)
		for _, org := range upstream.Organizations {
			me.Memberships = append(me.Memberships, contracts.Membership{OrganizationID: org.ID, Organization: org.Name, Role: org.Role})
		}
	}
	writeJSON(w, me)
}

func (s *Server) apiActiveOrg(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if session.Kind != "customer" {
		http.Error(w, "customer session required", http.StatusForbidden)
		return
	}
	var body struct {
		OrganizationID string `json:"organization_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OrganizationID == "" {
		http.Error(w, "organization_id is required", http.StatusBadRequest)
		return
	}
	if s.accountClient.Enabled() && session.Kind == "customer" {
		orgs, tokens, err := s.customerOrganizations(r.Context(), accountclient.Tokens{
			AccessToken:  session.AccessToken,
			RefreshToken: session.RefreshToken,
		})
		if err != nil {
			if errors.Is(err, errCustomerSessionInvalid) {
				s.invalidateCustomerSession(w, session.ID)
			}
			s.writeCustomerError(w, err)
			return
		}
		if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
			_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		if !organizationAllowed(orgs, body.OrganizationID) {
			http.Error(w, "organization is not part of the current customer memberships", http.StatusForbidden)
			return
		}
	}
	if err := s.store.UpdateSessionActiveOrg(session.ID, body.OrganizationID); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]string{"active_org_id": body.OrganizationID})
}

func (s *Server) apiCustomerLogin(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid login request", http.StatusBadRequest)
		return
	}
	login, err := s.accountClient.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		if status, ok := customerUpstreamStatus(err); ok {
			if status == http.StatusUnauthorized {
				http.Error(w, "invalid credentials", http.StatusUnauthorized)
				return
			}
			s.writeCustomerError(w, err)
			return
		}
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	me, tokens, err := s.resolveCustomerProfile(r.Context(), login.Tokens)
	if err != nil {
		if tokens.AccessToken == "" {
			tokens = login.Tokens
		}
	}
	activeOrgID := ""
	if err == nil && len(me.Organizations) > 0 {
		activeOrgID = me.Organizations[0].ID
	}
	session, err := s.store.CreateSession("customer", login.User.ID, login.User.Email, tokens.AccessToken, tokens.RefreshToken, activeOrgID, tokenTTL(tokens))
	if err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, session.ID)
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) apiPlatformLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid login request", http.StatusBadRequest)
		return
	}
	admin, err := s.store.VerifyPlatformAdmin(body.Email, body.Password)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	session, err := s.store.CreateSession("platform_admin", admin.ID, admin.Email, "", "", "", 12*time.Hour)
	if err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, session.ID)
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("rtk_admin_session"); err == nil {
		_ = s.store.DeleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "rtk_admin_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) apiDevices(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		devices, err := s.customerDevices(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, devices)
		return
	}
	devices, err := s.store.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, devices)
}

func (s *Server) apiAdminDevices(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	devices, err := s.store.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, devices)
}

func (s *Server) apiDevice(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		devices, err := s.customerDevices(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		for _, device := range devices {
			if device.ID == r.PathValue("id") {
				writeJSON(w, device)
				return
			}
		}
		http.NotFound(w, r)
		return
	}
	device, err := s.store.GetDevice(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, device)
}

func (s *Server) apiDeviceTelemetry(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	devices, err := s.customerDevices(r.Context(), session)
	if s.accountClient.Enabled() {
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		for _, device := range devices {
			if device.ID == r.PathValue("id") {
				writeJSON(w, demoTelemetryForDevice(device))
				return
			}
		}
		http.NotFound(w, r)
		return
	}
	if session.ActiveOrgID == "" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	device, err := s.store.GetDevice(r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if device.OrganizationID != session.ActiveOrgID {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, demoTelemetryForDevice(contracts.Device{
		ID:              device.ID,
		OrganizationID:  device.OrganizationID,
		Organization:    device.Organization,
		Name:            device.Name,
		Category:        device.Category,
		Model:           device.Model,
		SerialNumber:    device.SerialNumber,
		VideoCloudDevID: device.VideoCloudDevID,
		Status:          device.Status,
		Readiness:       device.Readiness,
		LastSeenAt:      device.LastSeenAt,
		UpdatedAt:       device.UpdatedAt,
	}))
}

func demoTelemetryForDevice(device contracts.Device) contracts.DeviceTelemetry {
	health := "healthy"
	signals := []string{}
	switch device.Readiness {
	case contracts.ReadinessFailed, contracts.ReadinessCloudActivationPending:
		health = "critical"
		signals = append(signals, "low_rssi", "offline_risk", "low_memory")
	case contracts.ReadinessActivated:
		health = "warning"
		signals = append(signals, "low_rssi")
	case contracts.ReadinessLocalOnboardingPending, contracts.ReadinessClaimPending, contracts.ReadinessDeactivationPending:
		health = "warning"
		signals = append(signals, "recent_reboot")
	default:
		health = "healthy"
	}

	rssi := make([]contracts.TelemetryRssiSample, 0, 7)
	uptime := make([]contracts.TelemetryUptimeSample, 0, 7)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	baseDBM := -64
	for i := 6; i >= 0; i-- {
		date := today.AddDate(0, 0, -i).Format("2006-01-02")
		avg := baseDBM - (6-i)*2
		rssi = append(rssi, contracts.TelemetryRssiSample{
			Date:    date,
			AvgDBM:  avg,
			Quality: telemetryQualityFromDBM(avg),
		})
		uptime = append(uptime, contracts.TelemetryUptimeSample{
			Date:      date,
			OnlinePct: 96.0 + float64(i)/10.0,
		})
	}

	recent := []contracts.TelemetryEvent{
		{
			OccurredAt: time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339),
			EventType:  "device.health.summary",
			Summary:    "Health summary indicates elevated wifi variance",
		},
		{
			OccurredAt: time.Now().UTC().Add(-3 * time.Hour).Format(time.RFC3339),
			EventType:  "device.health.rssi_sample",
			Summary:    "Signal quality dropped to fair due interference",
		},
		{
			OccurredAt: time.Now().UTC().Add(-6 * time.Hour).Format(time.RFC3339),
			EventType:  "device.reboot.reported",
			Summary:    "Device reboot reported by endpoint",
		},
		{
			OccurredAt: time.Now().UTC().Add(-10 * time.Hour).Format(time.RFC3339),
			EventType:  "device.crash.reported",
			Summary:    "Crash event recovered automatically",
		},
	}
	sort.Slice(recent, func(i, j int) bool {
		left, err := time.Parse(time.RFC3339, recent[i].OccurredAt)
		if err != nil {
			return false
		}
		right, err := time.Parse(time.RFC3339, recent[j].OccurredAt)
		if err != nil {
			return false
		}
		return left.After(right)
	})

	version := firmwareVersionFromDevice(device)
	return contracts.DeviceTelemetry{
		DeviceID:        device.ID,
		Health:          health,
		Signals:         signals,
		FirmwareVersion: version,
		RSSI7D:          rssi,
		Uptime7D:        uptime,
		RecentEvents:    recent,
	}
}

func telemetryQualityFromDBM(avgDBM int) string {
	if avgDBM >= -60 {
		return "good"
	}
	if avgDBM >= -75 {
		return "fair"
	}
	return "poor"
}

func firmwareVersionFromDevice(device contracts.Device) string {
	suffix := strings.TrimPrefix(device.ID, "dev-")
	if parsed, err := strconv.Atoi(suffix); err == nil {
		return fmt.Sprintf("v1.2.%d", parsed)
	}
	return fmt.Sprintf("v1.2.%d", len(device.Model))
}

func (s *Server) apiCustomers(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		customers, err := s.customerCustomers(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, customers)
		return
	}
	customers, err := s.store.ListCustomers()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, customers)
}

func (s *Server) apiAdminCustomers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	customers, err := s.store.ListCustomers()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, customers)
}

func (s *Server) apiOperations(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		ops, err := s.customerOperations(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, ops)
		return
	}
	ops, err := s.store.ListOperations()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ops)
}

func (s *Server) apiAdminOperations(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	ops, err := s.store.ListOperations()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ops)
}

func (s *Server) apiServiceHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.serviceHealth(r.Context()))
}

func (s *Server) apiAdminServiceHealth(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	writeJSON(w, s.serviceHealth(r.Context()))
}

func (s *Server) apiAudit(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.customerSession(r); ok {
		events, err := s.customerAudit(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, events)
		return
	}
	events, err := s.store.ListAuditEvents()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, events)
}

func (s *Server) apiAdminAudit(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	events, err := s.store.ListAuditEvents()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, events)
}

func (s *Server) requirePlatformAdmin(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	session, ok := s.requestSession(r)
	if !ok {
		http.Error(w, "platform admin authentication required", http.StatusUnauthorized)
		return store.Session{}, false
	}
	if session.Kind != "platform_admin" {
		http.Error(w, "platform admin authentication required", http.StatusForbidden)
		return store.Session{}, false
	}
	return session, true
}

func (s *Server) customerSession(r *http.Request) (store.Session, bool) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" || !s.accountClient.Enabled() {
		return store.Session{}, false
	}
	return session, true
}

func (s *Server) serviceHealth(ctx context.Context) []contracts.ServiceHealth {
	return []contracts.ServiceHealth{
		s.upstreamHealth(ctx, "Account Manager", s.cfg.AccountManagerBaseURL, func(ctx context.Context) error {
			if !s.accountClient.Enabled() {
				return nil
			}
			return s.accountClient.Health(ctx)
		}),
		s.httpHealth(ctx, "Video Cloud", s.cfg.VideoCloudBaseURL),
		{Name: "SQLite", Status: "ok", Detail: "Local console cache is available.", LastCheckedAt: time.Now().UTC().Format(time.RFC3339)},
	}
}

func (s *Server) customerDevices(ctx context.Context, session store.Session) ([]contracts.Device, error) {
	org, tokens, err := s.activeCustomerOrg(ctx, session)
	if err != nil {
		return nil, err
	}
	var devices []accountclient.Device
	tokens, err = s.customerCall(ctx, tokens, func(token string) error {
		var callErr error
		devices, callErr = s.accountClient.Devices(ctx, token, org.ID)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	vcFacts := s.videoCloudFacts(ctx, devices)
	out := make([]contracts.Device, 0, len(devices))
	for _, device := range devices {
		vid := fallback(device.VideoCloudDevID, metadataString(device.Metadata, "video_cloud_devid", ""))
		out = append(out, mapUpstreamDevice(org, device, vcFacts[vid]))
	}
	return out, nil
}

func (s *Server) customerCustomers(ctx context.Context, session store.Session) ([]contracts.CustomerSummary, error) {
	org, _, err := s.activeCustomerOrg(ctx, session)
	if err != nil {
		return nil, err
	}
	devices, err := s.customerDevices(ctx, session)
	if err != nil {
		return nil, err
	}
	summary := contracts.CustomerSummary{
		OrganizationID: org.ID,
		Organization:   org.Name,
	}
	for _, device := range devices {
		summary.TotalDevices++
		switch device.Readiness {
		case contracts.ReadinessOnline:
			summary.OnlineDevices++
			summary.ActivatedDevices++
		case contracts.ReadinessActivated:
			summary.ActivatedDevices++
		case contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
			summary.PendingDevices++
		case contracts.ReadinessFailed:
			summary.FailedDevices++
		}
		if device.LastSeenAt > summary.LastSeenAt {
			summary.LastSeenAt = device.LastSeenAt
		}
	}
	return []contracts.CustomerSummary{summary}, nil
}

func (s *Server) customerSummary(ctx context.Context, session store.Session) (contracts.Summary, error) {
	devices, err := s.customerDevices(ctx, session)
	if err != nil {
		return contracts.Summary{}, err
	}
	summary := contracts.Summary{Customers: 1}
	for _, device := range devices {
		summary.TotalDevices++
		switch device.Readiness {
		case contracts.ReadinessOnline:
			summary.OnlineDevices++
			summary.ActivatedDevices++
		case contracts.ReadinessActivated:
			summary.ActivatedDevices++
		case contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
			summary.PendingDevices++
		case contracts.ReadinessFailed:
			summary.FailedDevices++
		}
	}
	return summary, nil
}

func (s *Server) customerOperations(ctx context.Context, session store.Session) ([]contracts.Operation, error) {
	devices, err := s.customerDevices(ctx, session)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		allowed[device.ID] = struct{}{}
	}
	ops, err := s.store.ListOperations()
	if err != nil {
		return nil, err
	}
	if len(allowed) == 0 {
		return []contracts.Operation{}, nil
	}
	filtered := make([]contracts.Operation, 0, len(ops))
	for _, op := range ops {
		if _, ok := allowed[op.DeviceID]; ok {
			filtered = append(filtered, op)
		}
	}
	return filtered, nil
}

func (s *Server) customerAudit(ctx context.Context, session store.Session) ([]contracts.AuditEvent, error) {
	devices, err := s.customerDevices(ctx, session)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		allowed[device.ID] = struct{}{}
	}
	events, err := s.store.ListAuditEvents()
	if err != nil {
		return nil, err
	}
	if len(allowed) == 0 {
		return []contracts.AuditEvent{}, nil
	}
	filtered := make([]contracts.AuditEvent, 0, len(events))
	for _, event := range events {
		if _, ok := allowed[event.Target]; ok {
			filtered = append(filtered, event)
		}
	}
	return filtered, nil
}

func (s *Server) activeCustomerOrg(ctx context.Context, session store.Session) (accountclient.Organization, accountclient.Tokens, error) {
	tokens := accountclient.Tokens{
		AccessToken:  session.AccessToken,
		RefreshToken: session.RefreshToken,
	}
	var me accountclient.MeResult
	nextTokens, err := s.customerCall(ctx, tokens, func(token string) error {
		var callErr error
		me, callErr = s.accountClient.Me(ctx, token)
		return callErr
	})
	if err != nil {
		return accountclient.Organization{}, accountclient.Tokens{}, err
	}
	if nextTokens.AccessToken != session.AccessToken || nextTokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, nextTokens.AccessToken, nextTokens.RefreshToken, tokenTTL(nextTokens))
	}
	if session.ActiveOrgID != "" {
		for _, org := range me.Organizations {
			if org.ID == session.ActiveOrgID {
				return org, nextTokens, nil
			}
		}
		return accountclient.Organization{}, nextTokens, errCustomerActiveOrgInvalid
	}
	if len(me.Organizations) > 0 {
		return me.Organizations[0], nextTokens, nil
	}
	return accountclient.Organization{}, accountclient.Tokens{}, fmt.Errorf("no accessible organizations available")
}

func (s *Server) apiProvisionDevice(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.requestSession(r); ok && session.Kind == "platform_admin" {
		http.Error(w, "customer session required", http.StatusForbidden)
		return
	}
	if s.tryUpstreamLifecycle(w, r, "provision") {
		return
	}
	op, err := s.store.CreateLifecycleOperation(r.PathValue("id"), "DeviceProvisionRequested")
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, op)
}

func (s *Server) apiDeactivateDevice(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.requestSession(r); ok && session.Kind == "platform_admin" {
		http.Error(w, "customer session required", http.StatusForbidden)
		return
	}
	if s.tryUpstreamLifecycle(w, r, "deactivate") {
		return
	}
	op, err := s.store.CreateLifecycleOperation(r.PathValue("id"), "DeviceDeactivateRequested")
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, op)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func writeError(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

func (s *Server) requestSession(r *http.Request) (store.Session, bool) {
	cookie, err := r.Cookie("rtk_admin_session")
	if err != nil || cookie.Value == "" {
		return store.Session{}, false
	}
	session, err := s.store.GetSession(cookie.Value)
	return session, err == nil
}

func setSessionCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{Name: "rtk_admin_session", Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func tokenTTL(tokens accountclient.Tokens) time.Duration {
	if tokens.ExpiresIn > 0 {
		return time.Duration(tokens.ExpiresIn) * time.Second
	}
	return time.Hour
}

var errCustomerSessionInvalid = errors.New("customer session is invalid")
var errCustomerActiveOrgInvalid = errors.New("active organization is not part of the current customer memberships")

func (s *Server) invalidateCustomerSession(w http.ResponseWriter, sessionID string) {
	_ = s.store.DeleteSession(sessionID)
	http.SetCookie(w, &http.Cookie{Name: "rtk_admin_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func (s *Server) resolveCustomerProfile(ctx context.Context, tokens accountclient.Tokens) (accountclient.MeResult, accountclient.Tokens, error) {
	var upstream accountclient.MeResult
	nextTokens, err := s.customerCall(ctx, tokens, func(token string) error {
		var callErr error
		upstream, callErr = s.accountClient.Me(ctx, token)
		return callErr
	})
	if err != nil {
		return upstream, nextTokens, err
	}
	return upstream, nextTokens, nil
}

func (s *Server) customerOrganizations(ctx context.Context, tokens accountclient.Tokens) ([]accountclient.Organization, accountclient.Tokens, error) {
	var orgs []accountclient.Organization
	nextTokens, err := s.customerCall(ctx, tokens, func(token string) error {
		var callErr error
		orgs, callErr = s.accountClient.Organizations(ctx, token)
		return callErr
	})
	if err != nil {
		return nil, accountclient.Tokens{}, err
	}
	return orgs, nextTokens, nil
}

func (s *Server) customerCall(ctx context.Context, tokens accountclient.Tokens, call func(token string) error) (accountclient.Tokens, error) {
	if !s.accountClient.Enabled() {
		return tokens, errors.New("ACCOUNT_MANAGER_BASE_URL is not configured")
	}
	err := call(tokens.AccessToken)
	if err == nil {
		return tokens, nil
	}
	if status, ok := customerUpstreamStatus(err); !ok || status != http.StatusUnauthorized {
		return tokens, err
	}
	if tokens.RefreshToken == "" {
		return accountclient.Tokens{}, errCustomerSessionInvalid
	}
	refreshed, refreshErr := s.accountClient.Refresh(ctx, tokens.RefreshToken)
	if refreshErr != nil {
		if status, ok := customerUpstreamStatus(refreshErr); ok && status == http.StatusUnauthorized {
			return accountclient.Tokens{}, errCustomerSessionInvalid
		}
		return tokens, refreshErr
	}
	nextTokens := refreshed.Tokens
	if nextTokens.AccessToken == "" {
		return accountclient.Tokens{}, errCustomerSessionInvalid
	}
	err = call(nextTokens.AccessToken)
	if err == nil {
		return nextTokens, nil
	}
	if status, ok := customerUpstreamStatus(err); ok && status == http.StatusUnauthorized {
		return accountclient.Tokens{}, errCustomerSessionInvalid
	}
	return nextTokens, err
}

func customerUpstreamStatus(err error) (int, bool) {
	var httpErr *accountclient.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return httpErr.StatusCode, true
		case http.StatusNotFound, http.StatusBadRequest, http.StatusConflict, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
			return http.StatusBadGateway, true
		}
	}
	var timeoutErr interface{ Timeout() bool }
	if errors.As(err, &timeoutErr) && timeoutErr.Timeout() {
		return http.StatusGatewayTimeout, true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusGatewayTimeout, true
	}
	return 0, false
}

func (s *Server) writeCustomerErrorForSession(w http.ResponseWriter, sessionID string, err error) {
	if errors.Is(err, errCustomerSessionInvalid) {
		s.invalidateCustomerSession(w, sessionID)
	}
	s.writeCustomerError(w, err)
}

func (s *Server) writeCustomerError(w http.ResponseWriter, err error) {
	if errors.Is(err, errCustomerSessionInvalid) {
		http.Error(w, "customer session expired; please sign in again", http.StatusUnauthorized)
		return
	}
	if errors.Is(err, errCustomerActiveOrgInvalid) {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if status, ok := customerUpstreamStatus(err); ok {
		switch status {
		case http.StatusUnauthorized:
			http.Error(w, "customer session expired; please sign in again", http.StatusUnauthorized)
		case http.StatusForbidden:
			http.Error(w, "Account Manager denied access to the requested resource", http.StatusForbidden)
		case http.StatusGatewayTimeout:
			http.Error(w, "Account Manager request timed out", http.StatusGatewayTimeout)
		default:
			http.Error(w, "Account Manager request failed", http.StatusBadGateway)
		}
		return
	}
	writeError(w, err)
}

func organizationAllowed(orgs []accountclient.Organization, orgID string) bool {
	for _, org := range orgs {
		if org.ID == orgID {
			return true
		}
	}
	return false
}

func (s *Server) upstreamCustomers(w http.ResponseWriter, r *http.Request) ([]contracts.CustomerSummary, bool) {
	session, ok := s.requestSession(r)
	if !ok || !s.accountClient.Enabled() || session.Kind != "customer" {
		return nil, false
	}
	tokens := accountclient.Tokens{AccessToken: session.AccessToken, RefreshToken: session.RefreshToken}
	var orgs []accountclient.Organization
	var err error
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		orgs, callErr = s.accountClient.Organizations(r.Context(), token)
		return callErr
	})
	if err != nil {
		if errors.Is(err, errCustomerSessionInvalid) {
			s.invalidateCustomerSession(w, session.ID)
		}
		s.writeCustomerError(w, err)
		return nil, true
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	customers := make([]contracts.CustomerSummary, 0, len(orgs))
	for _, org := range orgs {
		customer := contracts.CustomerSummary{
			OrganizationID: org.ID,
			Organization:   org.Name,
		}
		var devices []accountclient.Device
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			devices, callErr = s.accountClient.Devices(r.Context(), token, org.ID)
			return callErr
		})
		if err != nil {
			if errors.Is(err, errCustomerSessionInvalid) {
				s.invalidateCustomerSession(w, session.ID)
			}
			s.writeCustomerError(w, err)
			return nil, true
		}
		if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
			_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		for _, device := range devices {
			mapped := mapUpstreamDevice(org, device, nil)
			customer.TotalDevices++
			switch mapped.Readiness {
			case contracts.ReadinessOnline:
				customer.OnlineDevices++
				customer.ActivatedDevices++
			case contracts.ReadinessActivated:
				customer.ActivatedDevices++
			case contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
				customer.PendingDevices++
			case contracts.ReadinessFailed:
				customer.FailedDevices++
			}
			if mapped.LastSeenAt > customer.LastSeenAt {
				customer.LastSeenAt = mapped.LastSeenAt
			}
		}
		customers = append(customers, customer)
	}
	return customers, true
}

func (s *Server) upstreamDevices(w http.ResponseWriter, r *http.Request) ([]contracts.Device, bool) {
	session, ok := s.requestSession(r)
	if !ok || !s.accountClient.Enabled() || session.Kind != "customer" {
		return nil, false
	}
	tokens := accountclient.Tokens{AccessToken: session.AccessToken, RefreshToken: session.RefreshToken}
	var orgs []accountclient.Organization
	var err error
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		orgs, callErr = s.accountClient.Organizations(r.Context(), token)
		return callErr
	})
	if err != nil {
		if errors.Is(err, errCustomerSessionInvalid) {
			s.invalidateCustomerSession(w, session.ID)
		}
		s.writeCustomerError(w, err)
		return nil, true
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	var out []contracts.Device
	for _, org := range orgs {
		var devices []accountclient.Device
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			devices, callErr = s.accountClient.Devices(r.Context(), token, org.ID)
			return callErr
		})
		if err != nil {
			if errors.Is(err, errCustomerSessionInvalid) {
				s.invalidateCustomerSession(w, session.ID)
			}
			s.writeCustomerError(w, err)
			return nil, true
		}
		if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
			_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		vcFacts := s.videoCloudFacts(r.Context(), devices)
		for _, device := range devices {
			vid := fallback(device.VideoCloudDevID, metadataString(device.Metadata, "video_cloud_devid", ""))
			out = append(out, mapUpstreamDevice(org, device, vcFacts[vid]))
		}
	}
	return out, true
}

func (s *Server) tryUpstreamLifecycle(w http.ResponseWriter, r *http.Request, action string) bool {
	session, ok := s.requestSession(r)
	if !ok || !s.accountClient.Enabled() || session.Kind != "customer" || session.ActiveOrgID == "" {
		return false
	}
	tokens := accountclient.Tokens{AccessToken: session.AccessToken, RefreshToken: session.RefreshToken}
	var orgs []accountclient.Organization
	var err error
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		orgs, callErr = s.accountClient.Organizations(r.Context(), token)
		return callErr
	})
	if err != nil {
		if errors.Is(err, errCustomerSessionInvalid) {
			s.invalidateCustomerSession(w, session.ID)
		}
		s.writeCustomerError(w, err)
		return true
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	if !organizationAllowed(orgs, session.ActiveOrgID) {
		http.Error(w, "active organization is not part of the current customer memberships", http.StatusForbidden)
		return true
	}
	deviceID := r.PathValue("id")
	operationType := "DeviceProvisionRequested"
	if action == "deactivate" {
		operationType = "DeviceDeactivateRequested"
	}
	if existing, ok, err := s.store.GetOpenLifecycleOperation(deviceID, operationType); err == nil && ok {
		_ = s.store.CreateAuditEvent(session.Email, operationType+".idempotent", deviceID)
		writeJSON(w, existing)
		return true
	} else if err != nil {
		writeError(w, err)
		return true
	}

	var op accountclient.Operation
	if action == "deactivate" {
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			op, callErr = s.accountClient.Deactivate(r.Context(), token, session.ActiveOrgID, deviceID)
			return callErr
		})
	} else {
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			op, callErr = s.accountClient.Provision(r.Context(), token, session.ActiveOrgID, deviceID)
			return callErr
		})
	}
	_ = s.store.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:          session.Email,
		ActorKind:      session.Kind,
		Action:         operationType + ".attempted",
		Target:         deviceID,
		OrganizationID: session.ActiveOrgID,
		Result:         "attempted",
	})
	if err != nil {
		if errors.Is(err, errCustomerSessionInvalid) {
			s.invalidateCustomerSession(w, session.ID)
		}
		if _, createErr := s.store.CreateFailedUpstreamLifecycleOperation(deviceID, operationType, session.Email, err.Error()); createErr != nil {
			_ = s.store.CreateAuditEventWithMetadata(store.AuditEventInput{
				Actor:          session.Email,
				ActorKind:      session.Kind,
				Action:         operationType + ".failed",
				Target:         deviceID,
				OrganizationID: session.ActiveOrgID,
				Result:         "failed",
			})
		}
		_ = s.store.CreateAuditEventWithMetadata(store.AuditEventInput{
			Actor:          session.Email,
			ActorKind:      session.Kind,
			Action:         operationType + ".failed",
			Target:         deviceID,
			OrganizationID: session.ActiveOrgID,
			Result:         "failed",
		})
		if strings.Contains(err.Error(), "returned 409") {
			if existing, ok, lookupErr := s.store.GetOpenLifecycleOperation(deviceID, operationType); lookupErr == nil && ok {
				_ = s.store.CreateAuditEvent(session.Email, operationType+".idempotent", deviceID)
				writeJSON(w, existing)
				return true
			}
		}
		s.writeCustomerError(w, err)
		return true
	}

	operationState := mapOperationState(op.State)
	upstreamID := fallback(op.ID, fmt.Sprintf("op-%d", time.Now().UTC().UnixNano()))
	upstreamMessage := fallback(op.Message, "Accepted by Account Manager.")
	recorded, err := s.store.CreateUpstreamLifecycleOperation(deviceID, operationType, session.Email, upstreamID, string(operationState), upstreamMessage)
	if err != nil {
		writeError(w, err)
		return true
	}
	_ = s.store.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:               session.Email,
		ActorKind:           session.Kind,
		Action:              operationType + ".completed",
		Target:              deviceID,
		OrganizationID:      session.ActiveOrgID,
		Result:              "accepted",
		UpstreamOperationID: recorded.UpstreamOperationID,
	})
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	recorded.Message = fallback(recorded.Message, upstreamMessage)
	recorded.UpdatedAt = fallback(op.UpdatedAt, recorded.UpdatedAt)
	writeJSON(w, recorded)
	return true
}

func mapUpstreamDevice(org accountclient.Organization, device accountclient.Device, vcFacts *readinessfacts.VideoCloudFacts) contracts.Device {
	now := time.Now().UTC().Format(time.RFC3339)
	readiness := contracts.ReadinessState(fallback(device.Readiness, metadataString(device.Metadata, "readiness", string(contracts.ReadinessRegistered))))
	status := fallback(device.Status, metadataString(device.Metadata, "status", "unknown"))
	videoID := fallback(device.VideoCloudDevID, metadataString(device.Metadata, "video_cloud_devid", ""))
	updatedAt := fallback(device.UpdatedAt, now)
	mapped := contracts.Device{
		ID:              device.ID,
		OrganizationID:  fallback(device.OrganizationID, org.ID),
		Organization:    fallback(device.Organization, org.Name),
		Name:            fallback(device.Name, device.ID),
		Category:        fallback(device.Category, metadataString(device.Metadata, "category", "device")),
		Model:           fallback(device.Model, metadataString(device.Metadata, "model", "unknown")),
		SerialNumber:    fallback(device.SerialNumber, metadataString(device.Metadata, "serial_number", "")),
		VideoCloudDevID: videoID,
		Status:          status,
		Readiness:       readiness,
		LastSeenAt:      fallback(device.LastSeenAt, metadataString(device.Metadata, "last_seen_at", "")),
		UpdatedAt:       updatedAt,
	}
	mapped.SourceFacts = readinessfacts.Build(mapped, upstreamOperationFromMetadata(device, updatedAt), vcFacts)
	return mapped
}

func upstreamOperationFromMetadata(device accountclient.Device, fallbackUpdatedAt string) *contracts.Operation {
	operationID := metadataString(device.Metadata, "operation_id", "")
	if operationID == "" {
		return nil
	}
	return &contracts.Operation{
		ID:        operationID,
		Type:      metadataString(device.Metadata, "operation_type", "DeviceProvisionRequested"),
		State:     mapOperationState(metadataString(device.Metadata, "operation_state", string(contracts.OperationPublished))),
		Message:   metadataString(device.Metadata, "operation_message", "Account Manager projection metadata"),
		UpdatedAt: fallback(metadataString(device.Metadata, "operation_updated_at", ""), fallbackUpdatedAt),
	}
}

func mapOperationState(state string) contracts.OperationState {
	switch contracts.OperationState(state) {
	case contracts.OperationPending, contracts.OperationPublished, contracts.OperationSucceeded, contracts.OperationFailed, contracts.OperationRetrying, contracts.OperationDeadLettered:
		return contracts.OperationState(state)
	default:
		return contracts.OperationPublished
	}
}

func metadataString(metadata map[string]any, key, fallbackValue string) string {
	if metadata == nil {
		return fallbackValue
	}
	value, ok := metadata[key]
	if !ok {
		return fallbackValue
	}
	if text, ok := value.(string); ok && text != "" {
		return text
	}
	return fallbackValue
}

func fallback(value, fallbackValue string) string {
	if value != "" {
		return value
	}
	return fallbackValue
}

func (s *Server) httpHealth(ctx context.Context, name, baseURL string) contracts.ServiceHealth {
	return s.upstreamHealth(ctx, name, baseURL, func(ctx context.Context) error {
		if baseURL == "" {
			return nil
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/healthz", nil)
		if err != nil {
			return err
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("unexpected status %d", res.StatusCode)
		}
		return nil
	})
}

func (s *Server) upstreamHealth(ctx context.Context, name, baseURL string, check func(context.Context) error) contracts.ServiceHealth {
	if baseURL == "" {
		return contracts.ServiceHealth{Name: name, Status: "demo", Detail: name + " URL is not configured; using local demo/cache behavior.", LastCheckedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	start := time.Now()
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	err := check(checkCtx)
	status := "ok"
	detail := "Reachable."
	if err != nil {
		status = "down"
		detail = err.Error()
	}
	return contracts.ServiceHealth{Name: name, Status: status, Detail: detail, LatencyMillis: time.Since(start).Milliseconds(), LastCheckedAt: time.Now().UTC().Format(time.RFC3339)}
}

// videoCloudFacts queries Video Cloud for activation and transport facts for a
// batch of Account Manager devices. Returns a map keyed by VideoCloudDevID.
// Non-nil facts are only present for devices that have a VideoCloudDevID.
// Errors are logged and silently ignored — Video Cloud is best-effort.
func (s *Server) videoCloudFacts(ctx context.Context, devices []accountclient.Device) map[string]*readinessfacts.VideoCloudFacts {
	if !s.videoClient.Enabled() || s.cfg.VideoCloudAdminToken == "" {
		return nil
	}

	// Collect device IDs that have a VideoCloudDevID.
	var vcIDs []string
	idToVC := make(map[string]string) // accountclient device ID → video_cloud_devid
	for _, d := range devices {
		vid := fallback(d.VideoCloudDevID, metadataString(d.Metadata, "video_cloud_devid", ""))
		if vid != "" {
			vcIDs = append(vcIDs, vid)
			idToVC[d.ID] = vid
		}
	}
	if len(vcIDs) == 0 {
		return nil
	}

	qCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	activated, err := s.videoClient.QueryActivation(qCtx, s.cfg.VideoCloudAdminToken, vcIDs)
	if err != nil {
		return nil
	}

	updatedAt := time.Now().UTC().Format(time.RFC3339)

	// Fan out GetCameraInfo for activated devices concurrently.
	type transportResult struct {
		vcID      string
		transport string
	}
	resultsCh := make(chan transportResult, len(vcIDs))
	var wg sync.WaitGroup
	for _, vcID := range vcIDs {
		if !activated[vcID] {
			continue
		}
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			tCtx, tCancel := context.WithTimeout(ctx, 4*time.Second)
			defer tCancel()
			transport, err := s.videoClient.GetCameraInfo(tCtx, s.cfg.VideoCloudAdminToken, id)
			if err != nil {
				resultsCh <- transportResult{vcID: id}
				return
			}
			resultsCh <- transportResult{vcID: id, transport: transport}
		}(vcID)
	}
	wg.Wait()
	close(resultsCh)

	transports := make(map[string]string, len(vcIDs))
	for r := range resultsCh {
		transports[r.vcID] = r.transport
	}

	out := make(map[string]*readinessfacts.VideoCloudFacts, len(vcIDs))
	for _, vcID := range vcIDs {
		out[vcID] = &readinessfacts.VideoCloudFacts{
			Activated: activated[vcID],
			Transport: transports[vcID],
			UpdatedAt: updatedAt,
		}
	}
	return out
}
