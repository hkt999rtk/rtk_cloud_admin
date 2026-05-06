package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
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
	s.mux.HandleFunc("POST /api/auth/customer/signup", s.apiCustomerSignup)
	s.mux.HandleFunc("POST /api/auth/customer/login", s.apiCustomerLogin)
	s.mux.HandleFunc("POST /api/auth/customer/verify-email", s.apiCustomerVerifyEmail)
	s.mux.HandleFunc("POST /api/auth/customer/resend-verification", s.apiCustomerResendVerification)
	s.mux.HandleFunc("POST /api/auth/platform/login", s.apiPlatformLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.apiLogout)
	s.mux.HandleFunc("POST /api/orgs/{orgId}/quota-raise-requests", s.apiQuotaRaiseRequest)
	s.mux.HandleFunc("GET /api/customers", s.apiCustomers)
	s.mux.HandleFunc("GET /api/admin/customers", s.apiAdminCustomers)
	s.mux.HandleFunc("GET /api/devices", s.apiDevices)
	s.mux.HandleFunc("GET /api/admin/devices", s.apiAdminDevices)
	s.mux.HandleFunc("GET /api/devices/{id}", s.apiDevice)
	s.mux.HandleFunc("GET /api/devices/{id}/telemetry", s.apiDeviceTelemetry)
	s.mux.HandleFunc("GET /api/fleet/health-summary", s.apiFleetHealthSummary)
	s.mux.HandleFunc("GET /api/fleet/stream-stats", s.apiFleetStreamStats)
	s.mux.HandleFunc("GET /api/fleet/firmware-distribution", s.apiFleetFirmwareDistribution)
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
	for _, path := range []string{
		"/signup",
		"/signup/check-email",
		"/verify",
		"/console",
		"/console/overview",
		"/console/devices",
		"/console/firmware-ota",
		"/console/stream-health",
		"/console/groups",
		"/console/customers",
		"/console/operations",
		"/console/audit",
		"/admin",
		"/admin/ops",
		"/admin/operations",
		"/admin/audit",
	} {
		s.mux.HandleFunc("GET "+path, s.shell)
	}
}

const (
	streamModeRTSP   = "rtsp"
	streamModeRelay  = "relay"
	streamModeWebRTC = "webrtc"
)

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
    <p>Fleet Health Overview</p>
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
				{OrganizationID: "org-acme", Organization: "Acme Smart Camera", Role: "owner", Tier: "evaluation", EvaluationDeviceQuota: 5},
				{OrganizationID: "org-nova", Organization: "Nova Home Labs", Role: "operator", Tier: "commercial"},
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
			me.Memberships = append(me.Memberships, membershipFromOrganization(org))
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

func (s *Server) apiCustomerSignup(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid signup request", http.StatusBadRequest)
		return
	}
	result, err := s.accountClient.Signup(r.Context(), body)
	if err != nil {
		s.writeCustomerError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, result)
}

func (s *Server) apiCustomerVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.AuthTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}
	result, err := s.accountClient.VerifyEmail(r.Context(), body.Token)
	if err != nil {
		s.writeCustomerError(w, err)
		return
	}
	if result.Tokens.AccessToken != "" {
		session, sessionErr := s.store.CreateSession("customer", result.User.ID, result.User.Email, result.Tokens.AccessToken, result.Tokens.RefreshToken, "", tokenTTL(result.Tokens))
		if sessionErr != nil {
			writeError(w, sessionErr)
			return
		}
		setSessionCookie(w, session.ID)
	}
	writeJSONStatus(w, http.StatusOK, result)
}

func (s *Server) apiCustomerResendVerification(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.EmailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Email) == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	if err := s.accountClient.ResendVerification(r.Context(), body.Email); err != nil {
		s.writeCustomerError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) apiQuotaRaiseRequest(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	orgID, err := s.customerOrgIDForSession(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if orgID != r.PathValue("orgId") {
		http.Error(w, "quota raise requests must target the active organization", http.StatusForbidden)
		return
	}
	var body accountclient.QuotaRaiseRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid quota raise request", http.StatusBadRequest)
		return
	}
	result, err := s.accountClient.CreateQuotaRaiseRequest(r.Context(), session.AccessToken, orgID, body)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, result)
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
		writeJSON(w, devicesWithFirmwareVersion(devices))
		return
	}
	devices, err := s.store.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, devicesWithFirmwareVersion(devices))
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
	writeJSON(w, devicesWithFirmwareVersion(devices))
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
				writeJSON(w, deviceWithFirmwareVersion(device))
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
	writeJSON(w, deviceWithFirmwareVersion(device))
}

func (s *Server) apiFleetHealthSummary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	_, days, err := parseFleetWindow(r.URL.Query().Get("window"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	orgID, err := s.customerOrgIDForSession(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var devices []contracts.Device
	if s.accountClient.Enabled() {
		allDevices, err := s.customerDevices(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		for _, device := range allDevices {
			if device.OrganizationID == orgID {
				devices = append(devices, device)
			}
		}
	} else {
		allDevices, err := s.store.ListDevices()
		if err != nil {
			writeError(w, err)
			return
		}
		for _, device := range allDevices {
			if device.OrganizationID == orgID {
				devices = append(devices, device)
			}
		}
	}
	writeJSON(w, fleetHealthSummary(orgID, devices, days))
}

func (s *Server) apiFleetStreamStats(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	window, days, err := parseFleetWindow(r.URL.Query().Get("window"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	orgID, err := s.customerOrgIDForSession(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var devices []contracts.Device
	if s.accountClient.Enabled() {
		allDevices, err := s.customerDevices(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		devices = append(devices, allDevices...)
	} else {
		allDevices, err := s.store.ListDevices()
		if err != nil {
			writeError(w, err)
			return
		}
		for _, device := range allDevices {
			if device.OrganizationID == orgID {
				devices = append(devices, device)
			}
		}
	}
	writeJSON(w, fleetStreamStats(orgID, devices, days, window))
}

func (s *Server) apiFleetFirmwareDistribution(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if ok && session.Kind == "customer" {
		orgID, err := s.customerOrgIDForSession(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		devices, err := s.firmwareDistributionDevices(r.Context(), session, orgID)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		if dist, ok, err := s.proxyFirmwareDistribution(r.Context(), devices, orgID); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		} else if ok {
			writeJSON(w, dist)
			return
		}
		writeJSON(w, demoFirmwareDistribution(orgID, devices))
		return
	}

	devices, err := s.store.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, demoFirmwareDistribution("org-acme", devices))
}

func (s *Server) firmwareDistributionDevices(ctx context.Context, session store.Session, orgID string) ([]contracts.Device, error) {
	if s.accountClient.Enabled() {
		devices, err := s.customerDevices(ctx, session)
		if err != nil {
			return nil, err
		}
		filtered := make([]contracts.Device, 0, len(devices))
		for _, device := range devices {
			if device.OrganizationID == orgID {
				filtered = append(filtered, device)
			}
		}
		return filtered, nil
	}
	devices, err := s.store.ListDevices()
	if err != nil {
		return nil, err
	}
	filtered := make([]contracts.Device, 0, len(devices))
	for _, device := range devices {
		if device.OrganizationID == orgID {
			filtered = append(filtered, device)
		}
	}
	return filtered, nil
}

func (s *Server) proxyFirmwareDistribution(ctx context.Context, devices []contracts.Device, orgID string) (contracts.FirmwareDistribution, bool, error) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
		return contracts.FirmwareDistribution{}, false, nil
	}

	type deviceVersion struct {
		version   string
		updatedAt time.Time
	}

	deviceVersions := make(map[string]deviceVersion, len(devices))
	for _, device := range devices {
		version := firmwareVersionFromDevice(device)
		deviceVersions[firmwareDistributionDeviceKey(device)] = deviceVersion{version: version}
		if id := strings.TrimSpace(device.ID); id != "" {
			deviceVersions[id] = deviceVersion{version: version}
		}
	}

	models := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		model := strings.TrimSpace(device.Model)
		if model != "" {
			models[model] = struct{}{}
		}
	}

	latestVersions := map[string]bool{}
	campaigns := make([]contracts.FirmwareDistributionCampaign, 0)
	for model := range models {
		enumResp, err := s.videoClient.EnumFirmware(ctx, s.cfg.VideoCloudAdminToken, model)
		if err != nil {
			return contracts.FirmwareDistribution{}, true, err
		}
		if latest := latestFirmwareVersion(enumResp); latest != "" {
			latestVersions[latest] = true
		}

		rolloutResp, err := s.videoClient.QueryFirmwareRollout(ctx, s.cfg.VideoCloudAdminToken, model, "")
		if err != nil {
			return contracts.FirmwareDistribution{}, true, err
		}
		for _, rollout := range rolloutResp.Rollouts {
			version := strings.TrimSpace(rollout.CurrentVersion)
			if version == "" {
				version = strings.TrimSpace(rollout.TargetVersion)
			}
			if version == "" {
				continue
			}
			updatedAt := parseFirmwareTimestamp(rollout.UpdatedAt)
			if updatedAt.IsZero() {
				updatedAt = parseFirmwareTimestamp(rollout.LastUpdated)
			}
			matched := false
			for _, device := range devices {
				if rollout.DeviceID != device.ID && rollout.DeviceID != strings.TrimSpace(device.VideoCloudDevID) {
					continue
				}
				for _, key := range []string{firmwareDistributionDeviceKey(device), strings.TrimSpace(device.ID)} {
					if key == "" {
						continue
					}
					if prev, ok := deviceVersions[key]; !ok || updatedAt.After(prev.updatedAt) || prev.version == "" {
						deviceVersions[key] = deviceVersion{version: version, updatedAt: updatedAt}
					}
				}
				matched = true
			}
			if !matched {
				if prev, ok := deviceVersions[rollout.DeviceID]; !ok || updatedAt.After(prev.updatedAt) || prev.version == "" {
					deviceVersions[rollout.DeviceID] = deviceVersion{version: version, updatedAt: updatedAt}
				}
			}
		}

		campaignResp, err := s.videoClient.QueryFirmwareCampaigns(ctx, s.cfg.VideoCloudAdminToken, model, false)
		if err != nil {
			return contracts.FirmwareDistribution{}, true, err
		}
		rolloutsByCampaign := make(map[string][]videoclient.FirmwareRolloutRecord)
		for _, rollout := range rolloutResp.Rollouts {
			if campaignID := strings.TrimSpace(rollout.CampaignID); campaignID != "" {
				rolloutsByCampaign[campaignID] = append(rolloutsByCampaign[campaignID], rollout)
			}
		}
		for _, campaign := range campaignResp {
			if !isVisibleFirmwareCampaignState(campaign.State) {
				continue
			}
			if campaignSummary := summarizeFirmwareCampaign(campaign, rolloutsByCampaign[campaign.ID]); campaignSummary.CampaignID != "" {
				campaigns = append(campaigns, campaignSummary)
			}
		}
	}

	facts := make(map[string]string, len(deviceVersions))
	for deviceID, fact := range deviceVersions {
		version := strings.TrimSpace(fact.version)
		if version == "" {
			version = "unknown"
		}
		facts[deviceID] = version
	}
	dist := buildFirmwareDistribution(orgID, devices, facts, latestVersions, campaigns)
	return dist, true, nil
}

func demoFirmwareDistribution(orgID string, devices []contracts.Device) contracts.FirmwareDistribution {
	currentVersions := make(map[string]string, len(devices))
	latestVersions := map[string]bool{}
	topVersion := ""
	for _, device := range devices {
		version := firmwareVersionFromDevice(device)
		if strings.TrimSpace(version) == "" {
			version = "unknown"
		}
		currentVersions[firmwareDistributionDeviceKey(device)] = version
		if id := strings.TrimSpace(device.ID); id != "" {
			currentVersions[id] = version
		}
		if version != "unknown" && (topVersion == "" || compareFirmwareVersions(version, topVersion) > 0) {
			topVersion = version
		}
	}
	if topVersion != "" {
		latestVersions[topVersion] = true
	}
	dist := buildFirmwareDistribution(orgID, devices, currentVersions, latestVersions, nil)
	if len(dist.Campaigns) == 0 {
		total := len(devices)
		if total == 0 {
			dist.Campaigns = []contracts.FirmwareDistributionCampaign{{
				CampaignID:    "campaign-demo",
				TargetVersion: "unknown",
				Policy:        "normal",
				State:         "active",
				StartedAt:     time.Now().UTC().Format(time.RFC3339),
			}}
			return dist
		}
		if topVersion == "" {
			topVersion = "unknown"
		}
		applied := 0
		failed := 0
		skipped := 0
		rollouts := make([]contracts.FirmwareDistributionRollout, 0, len(devices))
		for _, device := range devices {
			version := strings.TrimSpace(currentVersions[device.ID])
			if version == "" {
				version = strings.TrimSpace(currentVersions[firmwareDistributionDeviceKey(device)])
			}
			status := "pending"
			failureReason := ""
			switch device.Readiness {
			case contracts.ReadinessFailed:
				status = "failed"
				failed++
				failureReason = "device readiness is failed"
			case contracts.ReadinessDeactivated:
				status = "skipped"
				skipped++
			default:
				if strings.EqualFold(version, topVersion) {
					status = "applied"
					applied++
				}
			}
			if status == "pending" {
				// Pending devices are those not yet on the latest version.
			}
			rollouts = append(rollouts, contracts.FirmwareDistributionRollout{
				DeviceID:       device.ID,
				DeviceName:     device.Name,
				CurrentVersion: version,
				TargetVersion:  topVersion,
				RolloutStatus:  status,
				FailureReason:  failureReason,
				LastUpdated:    fallback(device.LastSeenAt, time.Now().UTC().Format(time.RFC3339)),
			})
		}
		pending := max(0, total-applied-failed-skipped)
		dist.Campaigns = []contracts.FirmwareDistributionCampaign{{
			CampaignID:    "campaign-demo",
			TargetVersion: topVersion,
			Policy:        "normal",
			State:         "active",
			Applied:       applied,
			Pending:       pending,
			Failed:        failed,
			Skipped:       skipped,
			Total:         total,
			StartedAt:     time.Now().UTC().AddDate(0, 0, -7).Format(time.RFC3339),
			Rollouts:      rollouts,
		}}
	}
	return dist
}

func buildFirmwareDistribution(orgID string, devices []contracts.Device, currentVersions map[string]string, latestVersions map[string]bool, campaigns []contracts.FirmwareDistributionCampaign) contracts.FirmwareDistribution {
	counts := make(map[string]int)
	for _, device := range devices {
		version := strings.TrimSpace(currentVersions[firmwareDistributionDeviceKey(device)])
		if version == "" {
			version = strings.TrimSpace(currentVersions[strings.TrimSpace(device.ID)])
		}
		if version == "" {
			version = "unknown"
		}
		counts[version]++
	}

	versionRows := make([]contracts.FirmwareDistributionVersion, 0, len(counts))
	for version, count := range counts {
		versionRows = append(versionRows, contracts.FirmwareDistributionVersion{
			Version:  version,
			Count:    count,
			IsLatest: latestVersions[version],
		})
	}
	sort.Slice(versionRows, func(i, j int) bool {
		if versionRows[i].IsLatest != versionRows[j].IsLatest {
			return versionRows[i].IsLatest
		}
		if versionRows[i].Count != versionRows[j].Count {
			return versionRows[i].Count > versionRows[j].Count
		}
		return compareFirmwareVersions(versionRows[i].Version, versionRows[j].Version) > 0
	})
	assignFirmwareDistributionPercents(versionRows)

	if len(campaigns) > 0 {
		sort.Slice(campaigns, func(i, j int) bool {
			if campaigns[i].StartedAt != campaigns[j].StartedAt {
				return campaigns[i].StartedAt > campaigns[j].StartedAt
			}
			return campaigns[i].CampaignID < campaigns[j].CampaignID
		})
	}

	return contracts.FirmwareDistribution{
		OrgID:     orgID,
		Versions:  versionRows,
		Campaigns: campaigns,
	}
}

func assignFirmwareDistributionPercents(rows []contracts.FirmwareDistributionVersion) {
	if len(rows) == 0 {
		return
	}
	total := 0
	for _, row := range rows {
		total += row.Count
	}
	if total == 0 {
		for i := range rows {
			rows[i].Pct = 0
		}
		return
	}
	sum := 0.0
	for i := range rows {
		if i == len(rows)-1 {
			rows[i].Pct = toTwoDecimal(100 - sum)
			continue
		}
		rows[i].Pct = toTwoDecimal(float64(rows[i].Count) / float64(total) * 100)
		sum += rows[i].Pct
	}
}

func latestFirmwareVersion(resp videoclient.FirmwareEnumResponse) string {
	if len(resp.Versions) > 0 {
		return strings.TrimSpace(resp.Versions[len(resp.Versions)-1])
	}
	latest := ""
	for _, release := range resp.Releases {
		version := strings.TrimSpace(release.Version)
		if version == "" {
			continue
		}
		if latest == "" || compareFirmwareVersions(version, latest) > 0 {
			latest = version
		}
	}
	return latest
}

func summarizeFirmwareCampaign(campaign videoclient.FirmwareCampaignRecord, rollouts []videoclient.FirmwareRolloutRecord) contracts.FirmwareDistributionCampaign {
	summary := contracts.FirmwareDistributionCampaign{
		CampaignID:    firstNonEmpty(strings.TrimSpace(campaign.ID), strings.TrimSpace(campaign.CampaignID)),
		TargetVersion: strings.TrimSpace(campaign.TargetVersion),
		Policy:        strings.TrimSpace(campaign.Policy.Name),
		State:         strings.TrimSpace(campaign.State),
		StartedAt:     campaign.CreatedAt,
	}
	if summary.Policy == "" {
		summary.Policy = "normal"
	}
	if summary.State == "" {
		summary.State = "active"
	}
	if summary.CampaignID == "" {
		return contracts.FirmwareDistributionCampaign{}
	}
	if summary.StartedAt == "" {
		summary.StartedAt = campaign.UpdatedAt
	}
	summary.Rollouts = make([]contracts.FirmwareDistributionRollout, 0, len(rollouts))
	for _, rollout := range rollouts {
		status := rolloutStatus(rollout)
		summary.Total++
		switch strings.ToLower(status) {
		case "applied":
			summary.Applied++
		case "failed":
			summary.Failed++
		case "skipped":
			summary.Skipped++
		case "pending", "eligible", "downloading":
			summary.Pending++
		default:
			summary.Pending++
		}
		summary.Rollouts = append(summary.Rollouts, contracts.FirmwareDistributionRollout{
			DeviceID:       firstNonEmpty(strings.TrimSpace(rollout.DeviceID), strings.TrimSpace(rollout.AccountDeviceID)),
			DeviceName:     firstNonEmpty(strings.TrimSpace(rollout.DeviceName), strings.TrimSpace(rollout.DeviceID)),
			CurrentVersion: firstNonEmpty(strings.TrimSpace(rollout.CurrentVersion), strings.TrimSpace(rollout.TargetVersion)),
			TargetVersion:  strings.TrimSpace(rollout.TargetVersion),
			RolloutStatus:  firstNonEmpty(status, "pending"),
			FailureReason:  strings.TrimSpace(rollout.Reason),
			LastUpdated:    firstNonEmpty(strings.TrimSpace(rollout.UpdatedAt), strings.TrimSpace(rollout.LastUpdated)),
		})
	}
	sort.Slice(summary.Rollouts, func(i, j int) bool {
		if summary.Rollouts[i].LastUpdated != summary.Rollouts[j].LastUpdated {
			return summary.Rollouts[i].LastUpdated > summary.Rollouts[j].LastUpdated
		}
		return summary.Rollouts[i].DeviceName < summary.Rollouts[j].DeviceName
	})
	if summary.StartedAt == "" && len(rollouts) > 0 {
		summary.StartedAt = oldestFirmwareTimestamp(rollouts).Format(time.RFC3339)
	}
	if summary.StartedAt == "" {
		summary.StartedAt = time.Now().UTC().Format(time.RFC3339)
	}
	return summary
}

func isVisibleFirmwareCampaignState(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "active", "scheduled":
		return true
	default:
		return false
	}
}

func rolloutStatus(rollout videoclient.FirmwareRolloutRecord) string {
	if status := strings.TrimSpace(rollout.RolloutStatus); status != "" {
		return status
	}
	return strings.TrimSpace(rollout.Status)
}

func oldestFirmwareTimestamp(rollouts []videoclient.FirmwareRolloutRecord) time.Time {
	var oldest time.Time
	for _, rollout := range rollouts {
		ts := parseFirmwareTimestamp(firstNonEmpty(rollout.UpdatedAt, rollout.LastUpdated))
		if ts.IsZero() {
			continue
		}
		if oldest.IsZero() || ts.Before(oldest) {
			oldest = ts
		}
	}
	return oldest
}

func parseFirmwareTimestamp(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func firmwareDistributionDeviceKey(device contracts.Device) string {
	if key := strings.TrimSpace(device.VideoCloudDevID); key != "" {
		return key
	}
	return strings.TrimSpace(device.ID)
}

func compareFirmwareVersions(a, b string) int {
	left, okLeft := parseFirmwareVersionParts(a)
	right, okRight := parseFirmwareVersionParts(b)
	if okLeft && okRight {
		n := len(left)
		if len(right) > n {
			n = len(right)
		}
		for i := 0; i < n; i++ {
			li := 0
			ri := 0
			if i < len(left) {
				li = left[i]
			}
			if i < len(right) {
				ri = right[i]
			}
			if li < ri {
				return -1
			}
			if li > ri {
				return 1
			}
		}
		return 0
	}
	return strings.Compare(strings.TrimSpace(a), strings.TrimSpace(b))
}

func parseFirmwareVersionParts(raw string) ([]int, bool) {
	raw = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(raw), "v"))
	if raw == "" {
		return nil, false
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r < '0' || r > '9'
	})
	if len(parts) == 0 {
		return nil, false
	}
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		value, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseFleetWindow(raw string) (string, int, error) {
	window := raw
	if window == "" {
		window = "7d"
	}
	switch window {
	case "7d":
		return window, 7, nil
	case "30d":
		return window, 30, nil
	default:
		return "", 0, fmt.Errorf("window must be 7d or 30d")
	}
}

func fleetStreamStats(orgID string, devices []contracts.Device, days int, window string) contracts.FleetStreamStats {
	byMode := map[string]contracts.FleetStreamStatsMode{
		streamModeRTSP:   {Requests: 0, SuccessRatePct: 0},
		streamModeRelay:  {Requests: 0, SuccessRatePct: 0},
		streamModeWebRTC: {Requests: 0, SuccessRatePct: 0},
	}
	modeTrendRequests := map[string][]int{
		streamModeRTSP:   make([]int, days),
		streamModeRelay:  make([]int, days),
		streamModeWebRTC: make([]int, days),
	}
	modeTrendSuccesses := map[string][]int{
		streamModeRTSP:   make([]int, days),
		streamModeRelay:  make([]int, days),
		streamModeWebRTC: make([]int, days),
	}
	type modeAccumulator struct {
		requests  int
		successes int
	}
	type deviceAccumulator struct {
		deviceID     string
		deviceName   string
		mode         string
		readiness    contracts.ReadinessState
		requests     int
		successes    int
		lastStreamAt string
		never        bool
	}
	modeStats := map[string]modeAccumulator{
		streamModeRTSP:   {},
		streamModeRelay:  {},
		streamModeWebRTC: {},
	}
	deviceStats := make(map[string]*deviceAccumulator, len(devices))
	for idx, device := range devices {
		profile := streamProfile(idx, device)
		deviceStats[device.ID] = &deviceAccumulator{
			deviceID:   device.ID,
			deviceName: device.Name,
			mode:       profile.mode,
			readiness:  device.Readiness,
			never:      profile.never,
		}
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	trend := make([]contracts.FleetStreamTrendPoint, 0, days)
	dailyRequestsByDay := make([]int, days)
	dailySuccessesByDay := make([]int, days)
	var totalRequests, totalSuccesses, totalDuration int
	activeSessions := 0
	neverStreamedCount := 0
	for idx, device := range devices {
		if device.Readiness == contracts.ReadinessOnline {
			activeSessions++
		}
		agg := deviceStats[device.ID]
		if agg == nil {
			continue
		}
		for day := 0; day < days; day++ {
			requests, successes, duration := streamDevicesForDay(day, len(devices), idx, device, agg.never)
			if requests > 0 {
				agg.lastStreamAt = streamDayTimestamp(today, day, days)
			}
			dailyRequestsByDay[day] += requests
			dailySuccessesByDay[day] += successes
			totalRequests += requests
			totalSuccesses += successes
			agg.requests += requests
			agg.successes += successes
			mode := modeStats[agg.mode]
			mode.requests += requests
			mode.successes += successes
			modeStats[agg.mode] = mode
			modeTrendRequests[agg.mode][day] += requests
			modeTrendSuccesses[agg.mode][day] += successes
			totalDuration += duration
		}
	}
	for _, agg := range deviceStats {
		if agg.readiness == contracts.ReadinessOnline && agg.requests == 0 && agg.never {
			neverStreamedCount++
		}
	}
	for day := 0; day < days; day++ {
		date := today.AddDate(0, 0, day-days+1).Format("2006-01-02")
		successRate := streamRate(dailySuccessesByDay[day], dailyRequestsByDay[day])
		trend = append(trend, contracts.FleetStreamTrendPoint{
			Date:           date,
			Requests:       dailyRequestsByDay[day],
			SuccessRatePct: successRate,
		})
	}
	for mode, stats := range modeStats {
		byMode[mode] = contracts.FleetStreamStatsMode{
			Requests:       stats.requests,
			SuccessRatePct: streamRate(stats.successes, stats.requests),
		}
	}
	modeTrendSeries := make([]contracts.FleetStreamModeTrend, 0, 3)
	for _, mode := range []string{streamModeRTSP, streamModeRelay, streamModeWebRTC} {
		series := make([]contracts.FleetStreamTrendPoint, 0, days)
		for day := 0; day < days; day++ {
			requests := modeTrendRequests[mode][day]
			successes := modeTrendSuccesses[mode][day]
			series = append(series, contracts.FleetStreamTrendPoint{
				Date:           today.AddDate(0, 0, day-days+1).Format("2006-01-02"),
				Requests:       requests,
				SuccessRatePct: streamRate(successes, requests),
			})
		}
		modeTrendSeries = append(modeTrendSeries, contracts.FleetStreamModeTrend{Mode: mode, Points: series})
	}

	worst := make([]contracts.FleetStreamWorstDevice, 0, len(deviceStats))
	for _, agg := range deviceStats {
		if agg.requests == 0 {
			continue
		}
		worst = append(worst, contracts.FleetStreamWorstDevice{
			DeviceID:       agg.deviceID,
			DeviceName:     agg.deviceName,
			ModeUsed:       agg.mode,
			Readiness:      string(agg.readiness),
			Requests:       agg.requests,
			SuccessRatePct: streamRate(agg.successes, agg.requests),
			LastStreamAt:   agg.lastStreamAt,
		})
	}
	sort.Slice(worst, func(i, j int) bool {
		if worst[i].SuccessRatePct != worst[j].SuccessRatePct {
			return worst[i].SuccessRatePct < worst[j].SuccessRatePct
		}
		if worst[i].Requests != worst[j].Requests {
			return worst[i].Requests > worst[j].Requests
		}
		return worst[i].DeviceName < worst[j].DeviceName
	})
	if len(worst) > 10 {
		worst = worst[:10]
	}

	return contracts.FleetStreamStats{
		OrgID:              orgID,
		Window:             window,
		SuccessRatePct:     streamRate(totalSuccesses, totalRequests),
		AvgDurationSeconds: averageDuration(totalDuration, totalRequests),
		ActiveSessions:     activeSessions,
		NeverStreamedCount: neverStreamedCount,
		ByMode:             byMode,
		Trend:              trend,
		TrendByMode:        modeTrendSeries,
		WorstDevices:       worst,
	}
}

type streamProfileData struct {
	mode        string
	baseRequest int
	successRate float64
	never       bool
}

func streamProfile(index int, device contracts.Device) streamProfileData {
	baseRequests := 4
	baseSuccess := 84.0
	never := false
	switch device.Readiness {
	case contracts.ReadinessOnline:
		baseRequests = 6
		baseSuccess = 94
		if strings.HasSuffix(device.VideoCloudDevID, "-1") || strings.HasSuffix(device.ID, "-1") || strings.HasSuffix(device.ID, "1") {
			never = true
		}
	case contracts.ReadinessActivated, contracts.ReadinessCloudActivationPending:
		baseRequests = 4
		baseSuccess = 78
	case contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
		baseRequests = 3
		baseSuccess = 68
	case contracts.ReadinessFailed:
		baseRequests = 1
		baseSuccess = 40
	default:
		baseRequests = 2
		baseSuccess = 55
	}
	switch index % 3 {
	case 0:
		return streamProfileData{mode: streamModeRTSP, baseRequest: baseRequests, successRate: baseSuccess, never: never}
	case 1:
		return streamProfileData{mode: streamModeRelay, baseRequest: baseRequests - 1, successRate: math.Min(baseSuccess+4, 100), never: never}
	default:
		return streamProfileData{mode: streamModeWebRTC, baseRequest: baseRequests - 2, successRate: math.Max(baseSuccess-8, 0), never: never}
	}
}

func streamDevicesForDay(day, totalDevices, index int, device contracts.Device, _ bool) (int, int, int) {
	profile := streamProfile(index, device)
	if profile.never {
		return 0, 0, 0
	}
	requests := profile.baseRequest + ((day * 3) % 5) + (totalDevices % 4)
	if requests < 0 {
		return 0, 0, 0
	}
	variable := float64((day % 7) * 2)
	successRate := profile.successRate + (float64(day%3) - variable/6)
	successRate = math.Min(100, math.Max(0, successRate))
	successes := int(math.Round(float64(requests) * (successRate / 100)))
	if successes < 0 {
		successes = 0
	}
	if successes > requests {
		successes = requests
	}
	baseDuration := 80 + int(profile.successRate)/2 + (len(device.ID) % 4) + (day % 3)
	successBoost := successes * 3
	failurePenalty := requests*2 - successes
	duration := requests*baseDuration + successBoost - failurePenalty
	return requests, successes, duration
}

func streamDayTimestamp(today time.Time, day, days int) string {
	streamDay := today.AddDate(0, 0, day-days+1)
	return streamDay.Add(15 * time.Hour).Format(time.RFC3339)
}

func streamRate(successes, requests int) float64 {
	if requests <= 0 {
		return 0
	}
	return toTwoDecimal(float64(successes) * 100 / float64(requests))
}

func averageDuration(totalDuration, totalRequests int) float64 {
	if totalRequests <= 0 {
		return 0
	}
	return toTwoDecimal(float64(totalDuration) / float64(totalRequests))
}

func (s *Server) customerOrgIDForSession(ctx context.Context, session store.Session) (string, error) {
	if session.ActiveOrgID != "" {
		return session.ActiveOrgID, nil
	}
	if !s.accountClient.Enabled() {
		return "", errCustomerActiveOrgInvalid
	}
	org, tokens, err := s.activeCustomerOrg(ctx, session)
	if err != nil {
		return "", err
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.store.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	return org.ID, nil
}

// fleetHealthSummary summarizes the local device projection so the endpoint can
// stay stable in both demo mode and connected account-manager mode.
func fleetHealthSummary(orgID string, devices []contracts.Device, days int) contracts.FleetHealthSummary {
	current := contracts.FleetHealthCurrent{}
	for _, device := range devices {
		switch telemetryHealthFromReadiness(device.Readiness) {
		case "healthy":
			current.Healthy++
		case "warning":
			current.Warning++
		case "critical":
			current.Critical++
		default:
			current.Unknown++
		}
	}
	total := len(devices)
	trend := fleetHealthTrend(current, total, days)
	onlineRate7dPct := 0.0
	if total > 0 {
		onlineRate7dPct = toTwoDecimal(float64(current.Healthy) / float64(total) * 100)
	}
	return contracts.FleetHealthSummary{
		OrgID:           orgID,
		Current:         current,
		OnlineRate7dPct: onlineRate7dPct,
		Trend:           trend,
	}
}

func fleetHealthTrend(current contracts.FleetHealthCurrent, total, days int) []contracts.FleetHealthTrendPoint {
	trend := make([]contracts.FleetHealthTrendPoint, 0, days)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	if total == 0 {
		for i := days - 1; i >= 0; i-- {
			trend = append(trend, contracts.FleetHealthTrendPoint{
				Date:          today.AddDate(0, 0, -i).Format("2006-01-02"),
				OnlinePct:     0,
				WarningCount:  0,
				CriticalCount: 0,
			})
		}
		return trend
	}

	baseWarning := current.Warning / max(1, total)
	baseCritical := current.Critical / max(1, total)
	onlineBase := float64(current.Healthy) / float64(total) * 100
	for i := days - 1; i >= 0; i-- {
		date := today.AddDate(0, 0, -i).Format("2006-01-02")
		warningCount := current.Warning + i%4 - baseWarning
		criticalCount := current.Critical + i%2 - baseCritical
		if warningCount < 0 {
			warningCount = 0
		}
		if criticalCount < 0 {
			criticalCount = 0
		}
		if warningCount+criticalCount > total {
			warningCount = max(0, total-criticalCount)
		}
		online := onlineBase - float64(i%6)*1.05
		if online < 0 {
			online = 0
		}
		trend = append(trend, contracts.FleetHealthTrendPoint{
			Date:          date,
			OnlinePct:     toTwoDecimal(online),
			WarningCount:  warningCount,
			CriticalCount: criticalCount,
		})
	}
	return trend
}

func telemetryHealthFromReadiness(readiness contracts.ReadinessState) string {
	switch readiness {
	case contracts.ReadinessOnline:
		return "healthy"
	case contracts.ReadinessFailed:
		return "critical"
	case contracts.ReadinessActivated, contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
		return "warning"
	case contracts.ReadinessRegistered:
		return "unknown"
	default:
		return "unknown"
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func toTwoDecimal(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func (s *Server) apiDeviceTelemetry(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if s.accountClient.Enabled() {
		devices, err := s.customerDevices(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		for _, device := range devices {
			if device.ID == r.PathValue("id") {
				if telemetry, ok, err := s.proxyTelemetryForDevice(r.Context(), session, device); err != nil {
					s.writeCustomerErrorForSession(w, session.ID, err)
					return
				} else if ok {
					writeJSON(w, telemetry)
					return
				}
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
	telemetryDevice := contracts.Device{
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
	}
	if telemetry, ok, err := s.proxyTelemetryForDevice(r.Context(), session, telemetryDevice); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	} else if ok {
		writeJSON(w, telemetry)
		return
	}
	writeJSON(w, demoTelemetryForDevice(telemetryDevice))
}

func (s *Server) proxyTelemetryForDevice(ctx context.Context, session store.Session, device contracts.Device) (contracts.DeviceTelemetry, bool, error) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" || strings.TrimSpace(device.VideoCloudDevID) == "" {
		return contracts.DeviceTelemetry{}, false, nil
	}
	upstream, err := s.videoClient.DeviceTelemetry(ctx, s.cfg.VideoCloudAdminToken, device.VideoCloudDevID, session.ActiveOrgID)
	if err != nil {
		return contracts.DeviceTelemetry{}, true, err
	}
	info, err := s.videoClient.GetDeviceInfo(ctx, s.cfg.VideoCloudAdminToken, device.VideoCloudDevID)
	firmwareVersion := firmwareVersionFromDevice(device)
	if err == nil && strings.TrimSpace(info.FirmwareVersion) != "" {
		firmwareVersion = strings.TrimSpace(info.FirmwareVersion)
	}
	return telemetryFromVideoCloud(device, firmwareVersion, upstream), true, nil
}

func telemetryFromVideoCloud(device contracts.Device, firmwareVersion string, upstream videoclient.DeviceTelemetryResponse) contracts.DeviceTelemetry {
	signals := telemetrySignalsFromUpstream(upstream.LatestHealth, upstream.RecentEvents)
	health := telemetryHealthFromUpstream(upstream.LatestHealth, signals)
	if strings.TrimSpace(firmwareVersion) == "" {
		firmwareVersion = "unknown"
	}
	return contracts.DeviceTelemetry{
		DeviceID:        device.ID,
		DeviceName:      fallback(strings.TrimSpace(upstream.DeviceName), device.Name),
		Organization:    device.Organization,
		SerialNumber:    device.SerialNumber,
		Model:           device.Model,
		LastSeenAt:      fallback(device.LastSeenAt, telemetryLastSeenAt(upstream)),
		Health:          health,
		Signals:         signals,
		FirmwareVersion: strings.TrimSpace(firmwareVersion),
		RSSI7D:          telemetryRSSI7D(upstream.RSSIHistory),
		Uptime7D:        telemetryUptime7D(upstream.UptimeHistory),
		RecentEvents:    telemetryRecentEvents(upstream.RecentEvents, 10),
	}
}

func telemetryHealthFromUpstream(latest *videoclient.DeviceTelemetryHealth, signals []string) string {
	if latest != nil {
		if health := canonicalTelemetryHealthState(latest.State); health != "" {
			return health
		}
	}
	if len(signals) > 0 {
		for _, signal := range signals {
			switch signal {
			case "recent_crash", "offline_risk", "low_memory":
				return "critical"
			case "low_rssi", "recent_reboot":
				return "warning"
			}
		}
		return "warning"
	}
	return "unknown"
}

func canonicalTelemetryHealthState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "healthy", "ok", "good", "normal":
		return "healthy"
	case "warning", "warn", "degraded", "fair":
		return "warning"
	case "critical", "crit", "bad", "error", "offline":
		return "critical"
	case "unknown":
		return "unknown"
	default:
		return ""
	}
}

func telemetrySignalsFromUpstream(latest *videoclient.DeviceTelemetryHealth, events []videoclient.DeviceTelemetryEvent) []string {
	signals := make([]string, 0, 5)
	seen := map[string]bool{}
	add := func(signal string) {
		if signal == "" || seen[signal] {
			return
		}
		seen[signal] = true
		signals = append(signals, signal)
	}
	if latest != nil {
		addValidatedTelemetrySignals(&signals, seen, telemetrySignalsFromPayload(latest.Payload))
	}
	for _, event := range events {
		switch event.EventType {
		case "device.health.rssi_sample":
			if quality := telemetryStringPayload(event.Payload, "quality"); quality == "poor" {
				add("low_rssi")
			}
			if rssi := telemetryIntPayload(event.Payload, "rssi_dbm"); rssi != nil && *rssi <= -75 {
				add("low_rssi")
			}
		case "device.reboot.reported":
			add("recent_reboot")
		case "device.crash.reported":
			add("recent_crash")
		case "device.health.memory_sample":
			if telemetryBoolPayload(event.Payload, "low_memory") {
				add("low_memory")
			}
		case "device.health.offline_risk":
			add("offline_risk")
		}
	}
	if len(signals) == 0 && latest != nil {
		addValidatedTelemetrySignals(&signals, seen, telemetrySignalsFromPayload(latest.Payload))
	}
	return signals
}

func addValidatedTelemetrySignals(out *[]string, seen map[string]bool, signals []string) {
	for _, signal := range signals {
		switch signal {
		case "low_rssi", "recent_reboot", "low_memory", "recent_crash", "offline_risk":
			if seen[signal] {
				continue
			}
			seen[signal] = true
			*out = append(*out, signal)
		}
	}
}

func telemetrySignalsFromPayload(payload json.RawMessage) []string {
	var decoded struct {
		Signals []string `json:"signals"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	out := make([]string, 0, len(decoded.Signals))
	for _, signal := range decoded.Signals {
		signal = strings.TrimSpace(signal)
		switch signal {
		case "low_rssi", "recent_reboot", "low_memory", "recent_crash", "offline_risk":
			out = append(out, signal)
		}
	}
	return out
}

func telemetryStringPayload(payload json.RawMessage, key string) string {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return ""
	}
	if value, ok := decoded[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func telemetryBoolPayload(payload json.RawMessage, key string) bool {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return false
	}
	value, ok := decoded[key]
	if !ok {
		return false
	}
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func telemetryIntPayload(payload json.RawMessage, key string) *int {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	value, ok := decoded[key]
	if !ok {
		return nil
	}
	switch v := value.(type) {
	case float64:
		if math.Trunc(v) != v {
			return nil
		}
		out := int(v)
		return &out
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return nil
		}
		return &parsed
	default:
		return nil
	}
}

func telemetryRSSI7D(samples []videoclient.DeviceTelemetryRSSI) []contracts.TelemetryRssiSample {
	dates := telemetryLastSevenDates()
	buckets := make(map[string][]int, len(dates))
	for _, sample := range samples {
		if sample.RSSIDBm == nil {
			continue
		}
		date := sample.OccurredAt.UTC().Format("2006-01-02")
		buckets[date] = append(buckets[date], *sample.RSSIDBm)
	}
	out := make([]contracts.TelemetryRssiSample, 0, len(dates))
	lastAvg := -70
	for _, date := range dates {
		values := buckets[date]
		if len(values) > 0 {
			sum := 0
			for _, value := range values {
				sum += value
			}
			lastAvg = int(math.Round(float64(sum) / float64(len(values))))
		}
		out = append(out, contracts.TelemetryRssiSample{
			Date:    date,
			AvgDBM:  lastAvg,
			Quality: telemetryQualityFromDBM(lastAvg),
		})
	}
	return out
}

func telemetryUptime7D(samples []videoclient.DeviceTelemetryUptime) []contracts.TelemetryUptimeSample {
	dates := telemetryLastSevenDates()
	buckets := make(map[string][]float64, len(dates))
	for _, sample := range samples {
		date := sample.OccurredAt.UTC().Format("2006-01-02")
		buckets[date] = append(buckets[date], float64(sample.UptimeSec))
	}
	out := make([]contracts.TelemetryUptimeSample, 0, len(dates))
	lastPct := 96.0
	for _, date := range dates {
		values := buckets[date]
		if len(values) > 0 {
			sum := 0.0
			for _, value := range values {
				sum += value
			}
			lastPct = telemetryOnlinePctFromUptimeSec(sum / float64(len(values)))
		}
		out = append(out, contracts.TelemetryUptimeSample{
			Date:      date,
			OnlinePct: lastPct,
		})
	}
	return out
}

func telemetryRecentEvents(events []videoclient.DeviceTelemetryEvent, limit int) []contracts.TelemetryEvent {
	out := make([]contracts.TelemetryEvent, 0, len(events))
	for _, event := range events {
		out = append(out, contracts.TelemetryEvent{
			OccurredAt: event.OccurredAt.UTC().Format(time.RFC3339),
			EventType:  event.EventType,
			Summary:    telemetryEventSummary(event),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		left, err := time.Parse(time.RFC3339, out[i].OccurredAt)
		if err != nil {
			return false
		}
		right, err := time.Parse(time.RFC3339, out[j].OccurredAt)
		if err != nil {
			return false
		}
		if !left.Equal(right) {
			return left.After(right)
		}
		return out[i].EventType < out[j].EventType
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func telemetryEventSummary(event videoclient.DeviceTelemetryEvent) string {
	if summary := telemetryStringPayload(event.Payload, "summary"); summary != "" {
		return summary
	}
	switch event.EventType {
	case "device.health.rssi_sample":
		rssi := telemetryIntPayload(event.Payload, "rssi_dbm")
		quality := telemetryStringPayload(event.Payload, "quality")
		if rssi != nil && quality != "" {
			return fmt.Sprintf("Signal quality is %s at %d dBm", quality, *rssi)
		}
		if rssi != nil {
			return fmt.Sprintf("Signal quality measured at %d dBm", *rssi)
		}
	case "device.reboot.reported":
		if reason := telemetryStringPayload(event.Payload, "reason"); reason != "" {
			return fmt.Sprintf("Device reboot reported: %s", reason)
		}
		return "Device reboot reported"
	case "device.crash.reported":
		if reason := telemetryStringPayload(event.Payload, "reason"); reason != "" {
			return fmt.Sprintf("Crash reported: %s", reason)
		}
		return "Crash reported"
	case "firmware.version.observed":
		if version := telemetryStringPayload(event.Payload, "current_version"); version != "" {
			return fmt.Sprintf("Firmware version observed: %s", version)
		}
		if version := telemetryStringPayload(event.Payload, "firmware_version"); version != "" {
			return fmt.Sprintf("Firmware version observed: %s", version)
		}
		return "Firmware version observed"
	}
	return strings.ReplaceAll(event.EventType, ".", " ")
}

func telemetryLastSevenDates() []string {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	out := make([]string, 0, 7)
	for i := 6; i >= 0; i-- {
		out = append(out, today.AddDate(0, 0, -i).Format("2006-01-02"))
	}
	return out
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
		uptimeSeconds := float64((96.0 + float64(i)/10.0) / 100.0 * telemetrySecondsPerDay)
		uptime = append(uptime, contracts.TelemetryUptimeSample{
			Date:      date,
			OnlinePct: telemetryOnlinePctFromUptimeSec(uptimeSeconds),
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
		DeviceName:      device.Name,
		Organization:    device.Organization,
		SerialNumber:    device.SerialNumber,
		Model:           device.Model,
		LastSeenAt:      device.LastSeenAt,
		Health:          health,
		Signals:         signals,
		FirmwareVersion: version,
		RSSI7D:          rssi,
		Uptime7D:        uptime,
		RecentEvents:    recent,
	}
}

func telemetryLastSeenAt(upstream videoclient.DeviceTelemetryResponse) string {
	latest := time.Time{}
	if upstream.LatestHealth != nil && !upstream.LatestHealth.OccurredAt.IsZero() {
		latest = upstream.LatestHealth.OccurredAt.UTC()
	}
	for _, event := range upstream.RecentEvents {
		if event.OccurredAt.IsZero() {
			continue
		}
		occurredAt := event.OccurredAt.UTC()
		if occurredAt.After(latest) {
			latest = occurredAt
		}
	}
	if latest.IsZero() {
		return ""
	}
	return latest.Format(time.RFC3339)
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

func deviceWithFirmwareVersion(device contracts.Device) contracts.Device {
	device.FirmwareVersion = firmwareVersionFromDevice(device)
	return device
}

func devicesWithFirmwareVersion(devices []contracts.Device) []contracts.Device {
	out := make([]contracts.Device, len(devices))
	for i, device := range devices {
		out[i] = deviceWithFirmwareVersion(device)
	}
	return out
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

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
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
		FirmwareVersion: firmwareVersionFromDevice(contracts.Device{
			ID:    device.ID,
			Model: fallback(device.Model, metadataString(device.Metadata, "model", "unknown")),
		}),
		Status:     status,
		Readiness:  readiness,
		LastSeenAt: fallback(device.LastSeenAt, metadataString(device.Metadata, "last_seen_at", "")),
		UpdatedAt:  updatedAt,
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

func membershipFromOrganization(org accountclient.Organization) contracts.Membership {
	return contracts.Membership{
		OrganizationID:        org.ID,
		Organization:          org.Name,
		Role:                  org.Role,
		Tier:                  org.Tier,
		EvaluationDeviceQuota: org.EvaluationDeviceQuota,
	}
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

const telemetrySecondsPerDay = 24 * 60 * 60

func telemetryOnlinePctFromUptimeSec(uptimeSec float64) float64 {
	pct := uptimeSec / float64(telemetrySecondsPerDay) * 100
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return math.Round(pct*10) / 10
}
