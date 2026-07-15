package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/correlation"
	"rtk_cloud_admin/internal/readinessfacts"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"

	cloudlogger "github.com/hkt999rtk/rtk_cloud_logger"
	"go.uber.org/zap"
)

type Server struct {
	sessions            sessionStore
	audit               auditStore
	projections         projectionStore
	lifecycleOperations lifecycleOperationStore
	jobs                batchJobStore
	mux                 *http.ServeMux
	handler             http.Handler
	cfg                 config.Config
	accountClient       *accountclient.Client
	videoClient         *videoclient.Client
	logger              *zap.Logger
}

type Options struct {
	Config        config.Config
	AccountClient *accountclient.Client
	VideoClient   *videoclient.Client
	Logger        *zap.Logger
}

var operationIDPattern = regexp.MustCompile(`(?i)\b(op|operation|upstream)[-_]?[a-z0-9][a-z0-9._:-]*\b`)

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
	if opts.Logger == nil {
		opts.Logger = cloudlogger.Nop()
	}
	s := &Server{
		sessions:            st,
		audit:               st,
		projections:         st,
		lifecycleOperations: st,
		jobs:                st,
		mux:                 http.NewServeMux(),
		cfg:                 opts.Config,
		accountClient:       opts.AccountClient,
		videoClient:         opts.VideoClient,
		logger:              opts.Logger,
	}
	s.routes()
	s.handler = requestContextMiddleware(cloudlogger.HTTPMiddleware(opts.Logger)(s.mux))
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) apiAdminGrafanaStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	status := contracts.PlatformGrafanaStatus{
		Enabled:       false,
		SourceStatus:  platformDashboardSourceUnconfigured,
		SourceMessage: "Grafana is not configured.",
	}
	baseURL := strings.TrimSpace(s.cfg.GrafanaBaseURL)
	if baseURL == "" {
		writeJSON(w, status)
		return
	}
	status.Enabled = true
	status.DashboardPath = grafanaDashboardPath(s.cfg.GrafanaDashboardPath)
	status.IframeURL = grafanaIframeURL(status.DashboardPath)
	status.SourceStatus = platformDashboardSourceConfigured
	status.SourceMessage = ""
	if err := grafanaHealthCheck(r.Context(), baseURL); err != nil {
		status.SourceStatus = platformDashboardSourceUnavailable
		status.SourceMessage = "Grafana source is unavailable."
	}
	writeJSON(w, status)
}

func (s *Server) apiAdminGrafanaProxy(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	baseURL := strings.TrimSpace(s.cfg.GrafanaBaseURL)
	if baseURL == "" {
		http.Error(w, "Grafana is not configured.", http.StatusServiceUnavailable)
		return
	}
	target, err := url.Parse(baseURL)
	if err != nil || target.Scheme == "" || target.Host == "" {
		http.Error(w, "Grafana is not configured.", http.StatusServiceUnavailable)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = singleJoiningSlash(target.Path, strings.TrimPrefix(r.URL.Path, "/api/admin/grafana"))
		req.URL.RawPath = ""
		req.URL.RawQuery = r.URL.RawQuery
		req.Host = target.Host
		stripGrafanaAuthProxyHeaders(req.Header)
		req.Header.Set("X-WEBAUTH-USER", session.Subject)
		req.Header.Set("X-WEBAUTH-EMAIL", session.Email)
		req.Header.Set("X-WEBAUTH-ROLE", "Viewer")
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "Grafana source is unavailable.", http.StatusServiceUnavailable)
	}
	proxy.ServeHTTP(w, r)
}

func grafanaHealthCheck(ctx context.Context, baseURL string) error {
	target, err := url.Parse(strings.TrimRight(baseURL, "/") + "/api/health")
	if err != nil || target.Scheme == "" || target.Host == "" {
		return errors.New("invalid Grafana base URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Grafana health status %d", resp.StatusCode)
	}
	return nil
}

func grafanaDashboardPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "/d/rtk-lke-staging/rtk-lke-staging-overview"
	}
	if !strings.HasPrefix(trimmed, "/") {
		return "/" + trimmed
	}
	return trimmed
}

func grafanaIframeURL(path string) string {
	return "/api/admin/grafana" + grafanaDashboardPath(path) + "?orgId=1&kiosk"
}

func stripGrafanaAuthProxyHeaders(header http.Header) {
	for key := range header {
		if strings.HasPrefix(strings.ToLower(key), "x-webauth-") {
			header.Del(key)
		}
	}
}

func singleJoiningSlash(base, path string) string {
	if base == "" || base == "/" {
		if path == "" {
			return "/"
		}
		if strings.HasPrefix(path, "/") {
			return path
		}
		return "/" + path
	}
	baseSlash := strings.HasSuffix(base, "/")
	pathSlash := strings.HasPrefix(path, "/")
	switch {
	case baseSlash && pathSlash:
		return base + path[1:]
	case !baseSlash && !pathSlash:
		return base + "/" + path
	default:
		return base + path
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /metrics/prometheus", s.metricsPrometheus)
	s.mux.HandleFunc("GET /api/summary", s.apiSummary)
	s.mux.HandleFunc("GET /api/admin/summary", s.apiAdminSummary)
	s.mux.HandleFunc("GET /api/admin/platform-dashboard", s.apiAdminPlatformDashboard)
	s.mux.HandleFunc("GET /api/admin/platform-resource-trends", s.apiAdminPlatformResourceTrends)
	s.mux.HandleFunc("GET /api/admin/grafana/status", s.apiAdminGrafanaStatus)
	s.mux.HandleFunc("GET /api/admin/grafana/", s.apiAdminGrafanaProxy)
	s.mux.HandleFunc("GET /api/me", s.apiMe)
	s.mux.HandleFunc("POST /api/me/active-org", s.apiActiveOrg)
	s.mux.HandleFunc("POST /api/auth/customer/signup", s.apiCustomerSignup)
	s.mux.HandleFunc("POST /api/auth/customer/login", s.apiCustomerLogin)
	s.mux.HandleFunc("POST /api/auth/customer/verify-email", s.apiCustomerVerifyEmail)
	s.mux.HandleFunc("POST /api/auth/customer/resend-verification", s.apiCustomerResendVerification)
	s.mux.HandleFunc("POST /api/auth/sign-in", s.apiAuthSignIn)
	s.mux.HandleFunc("POST /api/auth/login/activate", s.apiAuthLoginActivate)
	s.mux.HandleFunc("POST /api/auth/forgot-password", s.apiAuthForgotPassword)
	s.mux.HandleFunc("POST /api/auth/reset-password", s.apiAuthResetPassword)
	s.mux.HandleFunc("POST /api/auth/sso/start", s.apiSSOStart)
	s.mux.HandleFunc("GET /api/auth/sso/callback", s.apiSSOCallback)
	s.mux.HandleFunc("POST /api/auth/platform/login", s.apiPlatformLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.apiLogout)
	s.mux.HandleFunc("POST /api/orgs/{orgId}/quota-raise-requests", s.apiQuotaRaiseRequest)
	s.mux.HandleFunc("GET /api/customers", s.apiCustomers)
	s.mux.HandleFunc("GET /api/admin/customers", s.apiAdminCustomers)
	s.mux.HandleFunc("GET /api/devices", s.apiDevices)
	s.mux.HandleFunc("GET /api/fleet/devices", s.apiFleetDevices)
	s.mux.HandleFunc("GET /api/fleet/summary", s.apiFleetSummary)
	s.mux.HandleFunc("GET /api/groups", s.apiGroups)
	s.mux.HandleFunc("POST /api/groups", s.apiGroups)
	s.mux.HandleFunc("GET /api/groups/{id}", s.apiGroup)
	s.mux.HandleFunc("PATCH /api/groups/{id}", s.apiGroup)
	s.mux.HandleFunc("DELETE /api/groups/{id}", s.apiGroup)
	s.mux.HandleFunc("GET /api/tags", s.apiTags)
	s.mux.HandleFunc("GET /api/roles", s.apiRoles)
	s.mux.HandleFunc("GET /api/permissions", s.apiPermissions)
	s.mux.HandleFunc("GET /api/role-assignments", s.apiRoleAssignments)
	s.mux.HandleFunc("POST /api/role-assignments", s.apiRoleAssignments)
	s.mux.HandleFunc("DELETE /api/role-assignments/{id}", s.apiRoleAssignment)
	s.mux.HandleFunc("GET /api/jobs", s.apiJobs)
	s.mux.HandleFunc("POST /api/jobs", s.apiJobs)
	s.mux.HandleFunc("GET /api/jobs/{id}", s.apiJob)
	s.mux.HandleFunc("POST /api/jobs/{id}/retry", s.apiJobRetry)
	s.mux.HandleFunc("GET /api/jobs/{id}/result", s.apiJobResult)
	s.mux.HandleFunc("GET /api/reports", s.apiReports)
	s.mux.HandleFunc("POST /api/reports", s.apiReports)
	s.mux.HandleFunc("GET /api/reports/{id}", s.apiReport)
	s.mux.HandleFunc("GET /api/skus", s.apiSKUs)
	s.mux.HandleFunc("POST /api/skus", s.apiSKUWrite)
	s.mux.HandleFunc("GET /api/skus/{id}", s.apiSKU)
	s.mux.HandleFunc("PATCH /api/skus/{id}", s.apiSKUWrite)
	s.mux.HandleFunc("GET /api/skus/{id}/releases", s.apiSKUReleases)
	s.mux.HandleFunc("POST /api/skus/{id}/releases", s.apiSKUReleases)
	s.mux.HandleFunc("GET /api/skus/{id}/releases/{releaseId}", s.apiSKURelease)
	s.mux.HandleFunc("POST /api/skus/{id}/releases/{releaseId}/{action}", s.apiSKURelease)
	s.mux.HandleFunc("POST /api/skus/{id}/disable", s.apiSKUWrite)
	s.mux.HandleFunc("GET /api/skus/{id}/permissions", s.apiSKUPermissions)
	s.mux.HandleFunc("POST /api/skus/{id}/impact-preview", s.apiSKUImpactPreview)
	s.mux.HandleFunc("GET /api/admin/devices", s.apiAdminDevices)
	s.mux.HandleFunc("GET /api/admin/brand-clouds", s.apiAdminBrandClouds)
	s.mux.HandleFunc("POST /api/admin/brand-clouds", s.apiAdminBrandClouds)
	s.mux.HandleFunc("GET /api/admin/brand-clouds/{brandCloudId}", s.apiAdminBrandCloud)
	s.mux.HandleFunc("PATCH /api/admin/brand-clouds/{brandCloudId}", s.apiAdminBrandCloud)
	s.mux.HandleFunc("POST /api/admin/brand-clouds/{brandCloudId}/members", s.apiAdminBrandCloudMember)
	s.mux.HandleFunc("POST /api/admin/brand-clouds/{brandCloudId}/users", s.apiAdminBrandCloudUser)
	s.mux.HandleFunc("GET /api/admin/brand-clouds/{brandCloudId}/users", s.apiAdminBrandCloudUsers)
	s.mux.HandleFunc("POST /api/admin/brand-clouds/{brandCloudId}/users/{brandCloudUserId}/disable", s.apiAdminBrandCloudUserAction)
	s.mux.HandleFunc("POST /api/admin/brand-clouds/{brandCloudId}/users/{brandCloudUserId}/enable", s.apiAdminBrandCloudUserAction)
	s.mux.HandleFunc("POST /api/admin/brand-clouds/{brandCloudId}/users/{brandCloudUserId}/approve", s.apiAdminBrandCloudUserAction)
	s.mux.HandleFunc("DELETE /api/admin/brand-clouds/{brandCloudId}/users/{brandCloudUserId}", s.apiAdminBrandCloudUserAction)
	s.mux.HandleFunc("GET /api/admin/sso/providers", s.apiAdminSSOProviders)
	s.mux.HandleFunc("GET /api/admin/orgs/{orgId}/sso-provider", s.apiAdminSSOProvider)
	s.mux.HandleFunc("PUT /api/admin/orgs/{orgId}/sso-provider", s.apiAdminSSOProvider)
	s.mux.HandleFunc("GET /api/devices/{id}", s.apiDevice)
	s.mux.HandleFunc("GET /api/devices/{id}/telemetry", s.apiDeviceTelemetry)
	s.mux.HandleFunc("GET /api/fleet/health-summary", s.apiFleetHealthSummary)
	s.mux.HandleFunc("GET /api/fleet/stream-stats", s.apiFleetStreamStats)
	s.mux.HandleFunc("GET /api/fleet/firmware-distribution", s.apiFleetFirmwareDistribution)
	s.mux.HandleFunc("GET /api/ota/", s.apiSKUOTA)
	s.mux.HandleFunc("POST /api/ota/", s.apiSKUOTA)
	s.mux.HandleFunc("GET /api/update-plans", s.apiUpdatePlans)
	s.mux.HandleFunc("POST /api/update-plans", s.apiUpdatePlans)
	s.mux.HandleFunc("GET /api/update-plans/{id}", s.apiUpdatePlans)
	s.mux.HandleFunc("POST /api/update-plans/{id}/{action}", s.apiUpdatePlans)
	s.mux.HandleFunc("GET /api/operations", s.apiOperations)
	s.mux.HandleFunc("GET /api/admin/operations", s.apiAdminOperations)
	s.mux.HandleFunc("GET /api/service-health", s.apiServiceHealth)
	s.mux.HandleFunc("GET /api/admin/service-health", s.apiAdminServiceHealth)
	s.mux.HandleFunc("GET /api/admin/service-logs", s.apiAdminServiceLogs)
	s.mux.HandleFunc("GET /api/audit", s.apiAudit)
	s.mux.HandleFunc("GET /api/admin/audit", s.apiAdminAudit)
	s.mux.HandleFunc("POST /api/devices/{id}/provision", s.apiProvisionDevice)
	s.mux.HandleFunc("POST /api/devices/{id}/deactivate", s.apiDeactivateDevice)
	s.mux.HandleFunc("GET /assets/", s.assets)
	s.mux.HandleFunc("GET /", s.home)
	for _, path := range []string{
		"/login",
		"/login/check-email",
		"/login/activate",
		"/forgot-password",
		"/reset-password",
		"/signup",
		"/signup/check-email",
		"/verify",
		"/console",
		"/console/overview",
		"/console/devices",
		"/console/firmware-ota",
		"/console/stream-health",
		"/console/sku-services",
		"/console/jobs",
		"/console/reports",
		"/console/groups",
		"/console/customers",
		"/console/operations",
		"/console/audit",
		"/admin",
		"/admin/resources",
		"/admin/health",
		"/admin/brand-clouds",
		"/admin/ops",
		"/admin/operations",
		"/admin/audit",
		"/admin/logs",
		"/admin/sso",
	} {
		s.mux.HandleFunc("GET "+path, s.shell)
	}
}

const (
	streamModeWebRTC = "webrtc"
)

const (
	capabilityCustomerDevicesRead       = "customer.devices.read"
	capabilityCustomerDevicesProvision  = "customer.devices.provision"
	capabilityCustomerDevicesDeactivate = "customer.devices.deactivate"
	capabilityCustomerFirmwareRead      = "customer.firmware.read"
	capabilityCustomerFirmwareManage    = "customer.firmware.manage"
	capabilityCustomerStreamRead        = "customer.stream.read"
	capabilityPlatformAuditRead         = "platform.audit.read"
	capabilityPlatformSSOManage         = "platform.sso.manage"
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
	summary, err := s.projections.Summary()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, summary)
}

func (s *Server) apiAdminSummary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if s.usePlatformAdminUpstream(session) {
		summary, err := s.platformAdminSummary(r.Context(), session)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, summary)
		return
	}
	summary, err := s.projections.Summary()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, summary)
}

func (s *Server) apiMe(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok {
		me := s.meAuthSettings(contracts.Me{
			UserID:        "demo-user",
			Email:         "demo@example.local",
			Name:          "Demo User",
			Kind:          "demo",
			ActiveOrgID:   "org-acme",
			DemoMode:      !s.accountClient.Enabled(),
			Authenticated: false,
			Memberships: []contracts.Membership{
				{OrganizationID: "org-acme", Organization: "Acme Smart Camera", Role: "owner", Tier: "evaluation", EvaluationDeviceQuota: 5, Capabilities: fleetManagerCapabilities()},
				{OrganizationID: "org-nova", Organization: "Nova Home Labs", Role: "operator", Tier: "commercial", Capabilities: fleetManagerCapabilities()},
			},
		})
		me.Capabilities = aggregateMembershipCapabilities(me.Memberships, me.ActiveOrgID)
		writeJSON(w, me)
		return
	}
	if session.Kind == "platform_admin" {
		writeJSON(w, s.meAuthSettings(contracts.Me{
			UserID:                 session.Subject,
			Email:                  session.Email,
			Name:                   session.Email,
			Kind:                   session.Kind,
			Memberships:            []contracts.Membership{},
			Authenticated:          true,
			Capabilities:           platformAdminCompatibilityCapabilities(),
			UpstreamAccountManager: s.usePlatformAdminUpstream(session),
		}))
		return
	}
	me := s.meAuthSettings(contracts.Me{
		UserID:        session.Subject,
		Email:         session.Email,
		Name:          session.Email,
		Kind:          session.Kind,
		Memberships:   []contracts.Membership{},
		ActiveOrgID:   session.ActiveOrgID,
		DemoMode:      !s.accountClient.Enabled(),
		Authenticated: true,
	})
	if s.accountClient.Enabled() {
		upstream, tokens, err := s.resolveCustomerProfile(r.Context(), accountclient.Tokens{
			AccessToken:  session.AccessToken,
			RefreshToken: session.RefreshToken,
		})
		if tokens.AccessToken != "" && (tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken) {
			_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
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
		me.Capabilities = aggregateMembershipCapabilities(me.Memberships, me.ActiveOrgID)
	} else {
		memberships, err := s.demoMemberships()
		if err != nil {
			writeError(w, err)
			return
		}
		me.Memberships = memberships
		if me.ActiveOrgID == "" && len(memberships) > 0 {
			me.ActiveOrgID = memberships[0].OrganizationID
		}
		me.Capabilities = aggregateMembershipCapabilities(me.Memberships, me.ActiveOrgID)
	}
	writeJSON(w, me)
}

func (s *Server) meAuthSettings(me contracts.Me) contracts.Me {
	me.CustomerPasswordLoginEnabled = s.cfg.CustomerPasswordLoginEnabled
	return me
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
			_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		if !organizationAllowed(orgs, body.OrganizationID) {
			http.Error(w, "organization is not part of the current customer memberships", http.StatusForbidden)
			return
		}
	} else if !s.accountClient.Enabled() {
		allowed, err := s.demoOrganizationAllowed(body.OrganizationID)
		if err != nil {
			writeError(w, err)
			return
		}
		if !allowed {
			http.Error(w, "organization is not part of the current customer memberships", http.StatusForbidden)
			return
		}
	}
	if err := s.sessions.UpdateSessionActiveOrg(session.ID, body.OrganizationID); err != nil {
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
		session, sessionErr := s.sessions.CreateSession("customer", result.User.ID, result.User.Email, result.Tokens.AccessToken, result.Tokens.RefreshToken, "", tokenTTL(result.Tokens))
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

func (s *Server) apiAuthSignIn(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.EmailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Email) == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	if err := s.accountClient.SignIn(r.Context(), strings.TrimSpace(body.Email)); err != nil {
		s.writeAuthProxyError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) apiAuthLoginActivate(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.AuthTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}
	login, err := s.accountClient.ActivateLogin(r.Context(), strings.TrimSpace(body.Token))
	if err != nil {
		s.writeAuthProxyError(w, err)
		return
	}
	session, kind, err := s.createSessionFromActivatedLogin(r.Context(), login)
	if err != nil {
		s.writeAuthProxyError(w, err)
		return
	}
	setSessionCookie(w, session.ID)
	writeJSON(w, map[string]string{"status": "ok", "kind": kind})
}

func (s *Server) apiAuthForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.EmailRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Email) == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	if err := s.accountClient.ForgotPassword(r.Context(), strings.TrimSpace(body.Email)); err != nil {
		s.writeAuthProxyError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) apiAuthResetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" || len(body.NewPassword) < 8 {
		http.Error(w, "token and new_password are required", http.StatusBadRequest)
		return
	}
	if err := s.accountClient.ResetPassword(r.Context(), strings.TrimSpace(body.Token), body.NewPassword); err != nil {
		s.writeAuthProxyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiSSOStart(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.SSOStartRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid SSO start request", http.StatusBadRequest)
		return
	}
	body.Email = strings.TrimSpace(body.Email)
	if body.Email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	result, err := s.accountClient.StartSSO(r.Context(), body)
	if err != nil {
		writeSSOError(w, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiSSOCallback(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "ACCOUNT_MANAGER_BASE_URL is not configured", http.StatusServiceUnavailable)
		return
	}
	query := r.URL.Query()
	code := strings.TrimSpace(query.Get("code"))
	state := strings.TrimSpace(query.Get("state"))
	if code == "" || state == "" {
		http.Error(w, "code and state are required", http.StatusBadRequest)
		return
	}
	result, err := s.accountClient.CompleteSSO(r.Context(), accountclient.SSOCallbackRequest{
		Code:        code,
		State:       state,
		RedirectURI: strings.TrimSpace(query.Get("redirect_uri")),
	})
	if err != nil {
		writeSSOError(w, err)
		return
	}
	if result.Kind != "customer" && result.Kind != "platform_admin" {
		http.Error(w, "unsupported SSO session kind", http.StatusBadGateway)
		return
	}
	activeOrgID := result.ActiveOrgID
	if result.Kind == "customer" && activeOrgID == "" && len(result.Organizations) > 0 {
		activeOrgID = result.Organizations[0].ID
	}
	session, err := s.sessions.CreateSession(result.Kind, result.User.ID, result.User.Email, result.Tokens.AccessToken, result.Tokens.RefreshToken, activeOrgID, tokenTTL(result.Tokens))
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.auditSSOSession(result.User.Email, result.Kind, activeOrgID, "accepted"); err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, session.ID)
	if result.Kind == "platform_admin" {
		http.Redirect(w, r, "/admin", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/console", http.StatusFound)
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
	if !s.cfg.CustomerPasswordLoginEnabled {
		http.Error(w, "customer password sign-in is disabled", http.StatusForbidden)
		return
	}
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
	if err == nil && len(me.Organizations) == 0 {
		http.Error(w, errCustomerActiveOrgInvalid.Error(), http.StatusForbidden)
		return
	}
	activeOrgID := ""
	if err == nil && len(me.Organizations) > 0 {
		activeOrgID = me.Organizations[0].ID
	}
	session, err := s.sessions.CreateSession("customer", login.User.ID, login.User.Email, tokens.AccessToken, tokens.RefreshToken, activeOrgID, tokenTTL(tokens))
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
	body.Email = strings.TrimSpace(body.Email)
	session, err := s.createAccountManagerPlatformSession(r.Context(), body.Email, body.Password)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	setSessionCookie(w, session.ID)
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) createAccountManagerPlatformSession(ctx context.Context, email, password string) (store.Session, error) {
	if !s.accountClient.Enabled() {
		return store.Session{}, errCustomerSessionInvalid
	}
	login, err := s.accountClient.Login(ctx, email, password)
	if err != nil {
		return store.Session{}, err
	}
	if strings.TrimSpace(login.Tokens.AccessToken) == "" {
		return store.Session{}, errCustomerSessionInvalid
	}
	if _, err := s.accountClient.BrandClouds(ctx, login.Tokens.AccessToken); err != nil {
		return store.Session{}, err
	}
	return s.sessions.CreateSession("platform_admin", login.User.ID, login.User.Email, login.Tokens.AccessToken, login.Tokens.RefreshToken, "", tokenTTL(login.Tokens))
}

func (s *Server) createSessionFromActivatedLogin(ctx context.Context, login accountclient.LoginResult) (store.Session, string, error) {
	if strings.TrimSpace(login.Tokens.AccessToken) == "" {
		return store.Session{}, "", errCustomerSessionInvalid
	}
	if _, err := s.accountClient.BrandClouds(ctx, login.Tokens.AccessToken); err == nil {
		session, sessionErr := s.sessions.CreateSession("platform_admin", login.User.ID, login.User.Email, login.Tokens.AccessToken, login.Tokens.RefreshToken, "", tokenTTL(login.Tokens))
		return session, "platform_admin", sessionErr
	} else if !isAccessDeniedHTTPError(err) {
		return store.Session{}, "", err
	}
	me, tokens, err := s.resolveCustomerProfile(ctx, login.Tokens)
	if err != nil {
		return store.Session{}, "", err
	}
	if len(me.Organizations) == 0 {
		return store.Session{}, "", errCustomerActiveOrgInvalid
	}
	session, err := s.sessions.CreateSession("customer", login.User.ID, login.User.Email, tokens.AccessToken, tokens.RefreshToken, me.Organizations[0].ID, tokenTTL(tokens))
	return session, "customer", err
}

func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("rtk_admin_session"); err == nil {
		session, sessionErr := s.sessions.GetSession(cookie.Value)
		_ = s.sessions.DeleteSession(cookie.Value)
		if sessionErr == nil {
			_ = s.auditSessionLogout(session)
		}
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
		writeJSON(w, customerSafeDevices(devicesWithFirmwareVersion(devices)))
		return
	}
	devices, err := s.projections.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, devicesWithFirmwareVersion(devices))
}

func (s *Server) apiFleetDevices(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"source_status": "unconfigured", "source_message": "設備查詢服務尚未設定。"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	query := fleetDeviceQuery(r.URL.Query())
	var page accountclient.FleetDevicesPage
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		page, callErr = s.accountClient.FleetDevices(r.Context(), token, org.ID, query)
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	devices := make([]contracts.Device, 0, len(page.Devices))
	for _, device := range page.Devices {
		devices = append(devices, mapUpstreamDevice(org, device, nil))
	}
	writeJSON(w, map[string]any{
		"devices":       customerSafeDevices(devicesWithFirmwareVersion(devices)),
		"pagination":    page.Pagination,
		"query":         query,
		"source_status": "available",
	})
}

func (s *Server) apiFleetSummary(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSON(w, contracts.FleetSummary{ByStatus: map[string]int{}, BySKU: map[string]int{}, ByModel: map[string]int{}, ByFirmware: map[string]int{}, ByRegion: map[string]int{}, ServiceEnabled: map[string]int{}, SourceStatus: "unconfigured", SourceMessage: "Fleet 資料來源尚未設定。"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var summary accountclient.FleetSummary
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		summary, callErr = s.accountClient.FleetSummary(r.Context(), token, org.ID)
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	writeJSON(w, contracts.FleetSummary{
		Total: summary.Total, ByStatus: summary.ByStatus, BySKU: summary.BySKU, ByModel: summary.ByModel, ByFirmware: summary.ByFirmware, ByRegion: summary.ByRegion,
		ServiceEnabled: summary.ServiceEnabled, BySKURegion: summary.BySKURegion, BySKUFirmware: summary.BySKUFirmware, UpdatedAt: summary.UpdatedAt, SourceStatus: "available",
	})
}

func (s *Server) apiGroups(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSON(w, map[string]any{"groups": []accountclient.DeviceGroup{}, "source_status": "unconfigured"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if r.Method == http.MethodGet {
		var groups []accountclient.DeviceGroup
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			groups, callErr = s.accountClient.DeviceGroups(r.Context(), token, org.ID, r.URL.Query())
			return callErr
		})
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
			_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		tags, _ := s.accountClient.DeviceTags(r.Context(), tokens.AccessToken, org.ID, url.Values{"limit": []string{"250"}})
		writeJSON(w, map[string]any{"groups": groups, "tags": tags, "allowed_actions": groupAllowedActions(capabilitiesForOrganization(org)), "source_status": "available"})
		return
	}
	var request accountclient.DeviceGroupRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil || strings.TrimSpace(request.Name) == "" {
		http.Error(w, "群組資料格式不正確。", http.StatusBadRequest)
		return
	}
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		_, callErr = s.accountClient.CreateDeviceGroup(r.Context(), token, org.ID, request)
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]any{"source_status": "available"})
}

func (s *Server) apiTags(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	tags, err := s.accountClient.DeviceTags(r.Context(), tokens.AccessToken, org.ID, r.URL.Query())
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSON(w, map[string]any{"tags": tags, "source_status": "available"})
}

func groupAllowedActions(capabilities []string) []string {
	actions := []string{"view"}
	if hasCapability(capabilities, "device_group.manage") {
		actions = append(actions, "manage")
	}
	return actions
}

func (s *Server) apiGroup(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"source_status": "unconfigured", "source_message": "群組服務尚未設定。"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	id := r.PathValue("id")
	switch r.Method {
	case http.MethodGet:
		var group accountclient.DeviceGroup
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			var callErr error
			group, callErr = s.accountClient.DeviceGroup(r.Context(), token, org.ID, id)
			return callErr
		})
		if err == nil {
			writeJSON(w, map[string]any{"group": group, "source_status": "available"})
		}
	case http.MethodPatch:
		var request accountclient.DeviceGroupRequest
		if decodeErr := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); decodeErr != nil || strings.TrimSpace(request.Name) == "" {
			http.Error(w, "群組資料格式不正確。", http.StatusBadRequest)
			return
		}
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			_, callErr := s.accountClient.UpdateDeviceGroup(r.Context(), token, org.ID, id, request)
			return callErr
		})
		if err == nil {
			writeJSON(w, map[string]any{"source_status": "available"})
		}
	case http.MethodDelete:
		tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
			return s.accountClient.DeleteDeviceGroup(r.Context(), token, org.ID, id)
		})
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
}

func (s *Server) apiRoles(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	roles, err := s.accountClient.Roles(r.Context(), tokens.AccessToken, org.ID, r.URL.Query())
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSON(w, map[string]any{"roles": roles, "source_status": "available"})
}

func (s *Server) apiPermissions(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	permissions, err := s.accountClient.Permissions(r.Context(), tokens.AccessToken, org.ID, r.URL.Query())
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSON(w, map[string]any{"permissions": permissions, "source_status": "available"})
}

func (s *Server) apiRoleAssignments(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if r.Method == http.MethodGet {
		assignments, callErr := s.accountClient.RoleAssignments(r.Context(), tokens.AccessToken, org.ID, r.URL.Query())
		if callErr != nil {
			s.writeCustomerErrorForSession(w, session.ID, callErr)
			return
		}
		roles, roleErr := s.accountClient.Roles(r.Context(), tokens.AccessToken, org.ID, r.URL.Query())
		if roleErr != nil {
			s.writeCustomerErrorForSession(w, session.ID, roleErr)
			return
		}
		writeJSON(w, map[string]any{"role_assignments": assignments, "roles": roles, "source_status": "available"})
		return
	}
	var request accountclient.RoleAssignmentRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil || strings.TrimSpace(request.RoleName) == "" || strings.TrimSpace(request.ActorID) == "" || strings.TrimSpace(request.ScopeType) == "" {
		http.Error(w, "權限指派資料格式不正確。", http.StatusBadRequest)
		return
	}
	assignment, err := s.accountClient.CreateRoleAssignment(r.Context(), tokens.AccessToken, org.ID, request)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"role_assignment": assignment, "source_status": "available"})
}

func (s *Server) apiRoleAssignment(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if err := s.accountClient.DeleteRoleAssignment(r.Context(), tokens.AccessToken, org.ID, r.PathValue("id")); err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiJobs(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if r.Method == http.MethodGet {
		jobs, err := s.jobs.ListBatchJobs(org.ID, 250)
		if err != nil {
			http.Error(w, "批次工作暫時無法取得。", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, map[string]any{"jobs": jobs, "source_status": "available"})
		return
	}
	var request struct {
		Type  string         `json:"type"`
		Name  string         `json:"name"`
		Scope map[string]any `json:"scope"`
		Total int            `json:"total"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
		http.Error(w, "批次工作資料格式不正確。", http.StatusBadRequest)
		return
	}
	allowed := map[string]bool{"device_settings": true, "device_provision": true, "device_deactivation": true, "tag_update": true, "group_update": true, "firmware_retry": true, "report_export": true}
	if !allowed[strings.TrimSpace(request.Type)] || strings.TrimSpace(request.Name) == "" {
		http.Error(w, "批次工作類型或名稱不正確。", http.StatusBadRequest)
		return
	}
	if request.Total < 0 {
		http.Error(w, "批次工作範圍不正確。", http.StatusBadRequest)
		return
	}
	job, err := s.jobs.CreateBatchJob(contracts.BatchJob{Type: strings.TrimSpace(request.Type), Name: strings.TrimSpace(request.Name), OrganizationID: org.ID, CreatedBy: session.Email, Scope: request.Scope, State: "queued", Total: request.Total})
	if err != nil {
		http.Error(w, "批次工作無法建立。", http.StatusServiceUnavailable)
		return
	}
	go s.runBatchJob(job, tokens.AccessToken)
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "fleet.batch_job.create", Target: job.ID, OrganizationID: org.ID, Result: "accepted"})
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": job, "source_status": "available"})
}

func (s *Server) apiJob(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, _, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	job, err := s.jobs.GetBatchJob(org.ID, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "找不到這個批次工作。", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "批次工作暫時無法取得。", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{"job": job, "source_status": "available"})
}

func (s *Server) apiJobRetry(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	job, err := s.jobs.GetBatchJob(org.ID, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "找不到這個批次工作。", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "批次工作暫時無法取得。", http.StatusServiceUnavailable)
		return
	}
	if job.Failed == 0 {
		http.Error(w, "目前沒有可重試的失敗項目。", http.StatusConflict)
		return
	}
	job, err = s.jobs.UpdateBatchJobState(org.ID, job.ID, "queued")
	if err != nil {
		http.Error(w, "批次工作無法重試。", http.StatusServiceUnavailable)
		return
	}
	go s.runBatchJob(job, tokens.AccessToken)
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "fleet.batch_job.retry", Target: job.ID, OrganizationID: org.ID, Result: "accepted"})
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": job, "source_status": "available"})
}

func (s *Server) apiJobResult(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, _, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	job, err := s.jobs.GetBatchJob(org.ID, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "找不到這個批次工作。", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "批次結果暫時無法取得。", http.StatusServiceUnavailable)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "csv") {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="fleet-job-`+job.ID+`.csv"`)
		writer := csv.NewWriter(w)
		_ = writer.Write([]string{"項目", "名稱", "數量"})
		for _, item := range job.Result {
			metric, _ := item["metric"].(string)
			name, _ := item["name"].(string)
			value := fmt.Sprint(item["value"])
			_ = writer.Write([]string{metric, name, value})
		}
		writer.Flush()
		return
	}
	writeJSON(w, map[string]any{"job": job, "items": job.Result, "source_status": "available"})
}

func (s *Server) runBatchJob(job contracts.BatchJob, accessToken string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if s.accountClient == nil || !s.accountClient.Enabled() {
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, job.Total, 0)
		return
	}
	if job.Type == "report_export" {
		if s.accountClient == nil || !s.accountClient.Enabled() {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, 1, 0)
			return
		}
		query := make(url.Values)
		queryScope := job.Scope
		if nested, ok := job.Scope["query"].(map[string]any); ok {
			queryScope = nested
		}
		for key, value := range queryScope {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				query.Set(key, text)
			}
		}
		query.Set("limit", "250")
		byDimension := map[string]map[string]int{"sku": {}, "model": {}, "status": {}, "region": {}}
		total, offset := 0, 0
		for {
			query.Set("offset", strconv.Itoa(offset))
			page, err := s.accountClient.FleetDevices(ctx, accessToken, job.OrganizationID, query)
			if err != nil {
				_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, 1, 0)
				return
			}
			for _, device := range page.Devices {
				if !reportDeviceInTimeRange(device, queryScope) {
					continue
				}
				total++
				byDimension["sku"][device.DeviceItemProfileID]++
				byDimension["model"][device.Model]++
				byDimension["status"][device.Status]++
				region := "未提供"
				if value, ok := device.Metadata["region"].(string); ok && strings.TrimSpace(value) != "" {
					region = value
				}
				byDimension["region"][region]++
			}
			offset += len(page.Devices)
			if len(page.Devices) == 0 || offset >= page.Pagination.Total || len(page.Devices) < 250 {
				break
			}
		}
		result := []map[string]any{{"metric": "設備總數", "value": total}}
		for dimension, values := range byDimension {
			for name, count := range values {
				if strings.TrimSpace(name) == "" {
					name = "未設定"
				}
				result = append(result, map[string]any{"dimension": dimension, "name": name, "value": count})
			}
		}
		if _, err := s.jobs.UpdateBatchJobResult(job.OrganizationID, job.ID, result); err != nil {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, 1, 0)
			return
		}
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "completed", 1, 0, 0)
		return
	}
	if job.Type == "firmware_retry" {
		planID, _ := job.Scope["update_plan_id"].(string)
		if strings.TrimSpace(planID) == "" || !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, 1, 0)
			return
		}
		response, err := s.videoClient.DoOTA(ctx, http.MethodPost, "/v1/ota/campaigns/"+url.PathEscape(planID)+":retry", s.cfg.VideoCloudAdminToken, job.OrganizationID, "batch-retry-"+job.ID, nil)
		if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, 1, 0)
			return
		}
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "completed", 1, 0, 0)
		return
	}
	if job.Type != "device_deactivation" && job.Type != "device_provision" && job.Type != "device_settings" && job.Type != "group_update" && job.Type != "tag_update" {
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, job.Total, 0)
		return
	}
	if _, hasSnapshot := job.Scope["snapshot_ids"]; !hasSnapshot {
		if _, hasQuery := job.Scope["query"]; hasQuery {
			ids, err := s.snapshotBatchScope(ctx, accessToken, job)
			if err != nil {
				_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, job.Total, 0)
				return
			}
			if job.Scope == nil {
				job.Scope = map[string]any{}
			}
			job.Scope["snapshot_ids"] = ids
			job.Scope["snapshot_at"] = time.Now().UTC().Format(time.RFC3339)
			if updated, err := s.jobs.UpdateBatchJobScope(job.OrganizationID, job.ID, job.Scope); err == nil {
				job = updated
			} else {
				_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, job.Total, 0)
				return
			}
		}
	}
	query := make(url.Values)
	queryScope := job.Scope
	if nested, ok := job.Scope["query"].(map[string]any); ok {
		queryScope = nested
	}
	for key, value := range queryScope {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			query.Set(key, text)
		}
	}
	excluded := map[string]bool{}
	if raw, ok := job.Scope["exclude_ids"].([]any); ok {
		for _, value := range raw {
			if text, ok := value.(string); ok {
				excluded[text] = true
			}
		}
	}
	var explicitIDs []string
	if raw, ok := job.Scope["snapshot_ids"].([]any); ok {
		for _, value := range raw {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				explicitIDs = append(explicitIDs, text)
			}
		}
	}
	if len(explicitIDs) == 0 {
		if raw, ok := job.Scope["device_ids"].([]any); ok {
			for _, value := range raw {
				if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
					explicitIDs = append(explicitIDs, text)
				}
			}
		}
	}
	query.Set("limit", "250")
	offset, completed, failed := 0, 0, 0
	groupID, _ := queryScope["group_id"].(string)
	tag, _ := queryScope["tag"].(string)
	action, _ := queryScope["action"].(string)
	settings, _ := queryScope["settings"].(map[string]any)
	process := func(device accountclient.Device) {
		if excluded[device.ID] {
			return
		}
		var actionErr error
		switch job.Type {
		case "device_deactivation":
			_, actionErr = s.accountClient.Deactivate(ctx, accessToken, job.OrganizationID, device.ID)
		case "device_provision":
			_, actionErr = s.accountClient.Provision(ctx, accessToken, job.OrganizationID, device.ID)
		case "device_settings":
			metadata := device.Metadata
			if metadata == nil {
				metadata = map[string]any{}
			}
			for key, value := range settings {
				metadata[key] = value
			}
			_, actionErr = s.accountClient.UpdateDevice(ctx, accessToken, job.OrganizationID, device.ID, accountclient.DeviceUpdateRequest{
				Name: device.Name, Category: device.Category, Model: device.Model, Metadata: metadata,
			})
		case "group_update":
			if strings.TrimSpace(groupID) == "" || (action != "add" && action != "remove") {
				actionErr = errors.New("group update scope is incomplete")
			} else if action == "add" {
				actionErr = s.accountClient.AddDeviceToGroup(ctx, accessToken, job.OrganizationID, groupID, device.ID)
			} else {
				actionErr = s.accountClient.RemoveDeviceFromGroup(ctx, accessToken, job.OrganizationID, groupID, device.ID)
			}
		case "tag_update":
			if strings.TrimSpace(tag) == "" || (action != "add" && action != "remove") {
				actionErr = errors.New("tag update scope is incomplete")
			} else if action == "add" {
				actionErr = s.accountClient.AddDeviceTag(ctx, accessToken, job.OrganizationID, device.ID, tag)
			} else {
				actionErr = s.accountClient.RemoveDeviceTag(ctx, accessToken, job.OrganizationID, device.ID, tag)
			}
		}
		if actionErr != nil {
			failed++
		} else {
			completed++
		}
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "running", completed, failed, 0)
	}
	if len(explicitIDs) > 0 {
		for _, deviceID := range explicitIDs {
			device, err := s.accountClient.Device(ctx, accessToken, job.OrganizationID, deviceID)
			if err != nil {
				failed++
				continue
			}
			process(device)
		}
		state := "completed"
		if failed > 0 {
			state = "partially_failed"
		}
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, state, completed, failed, 0)
		return
	}
	for {
		query.Set("offset", strconv.Itoa(offset))
		page, err := s.accountClient.FleetDevices(ctx, accessToken, job.OrganizationID, query)
		if err != nil {
			failed += maxInt(job.Total-completed-failed, 1)
			break
		}
		if len(page.Devices) == 0 {
			break
		}
		for _, device := range page.Devices {
			process(device)
		}
		offset += len(page.Devices)
		if offset >= page.Pagination.Total || len(page.Devices) < 250 {
			break
		}
	}
	state := "completed"
	if failed > 0 {
		state = "partially_failed"
	}
	_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, state, completed, failed, 0)
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func (s *Server) snapshotBatchScope(ctx context.Context, accessToken string, job contracts.BatchJob) ([]string, error) {
	queryScope, ok := job.Scope["query"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("batch scope query is missing")
	}
	query := make(url.Values)
	for key, value := range queryScope {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			query.Set(key, text)
		}
	}
	query.Set("limit", "250")
	excluded := map[string]bool{}
	if raw, ok := job.Scope["exclude_ids"].([]any); ok {
		for _, value := range raw {
			if text, ok := value.(string); ok {
				excluded[text] = true
			}
		}
	}
	ids := make([]string, 0)
	for offset := 0; ; offset += 250 {
		query.Set("offset", strconv.Itoa(offset))
		page, err := s.accountClient.FleetDevices(ctx, accessToken, job.OrganizationID, query)
		if err != nil {
			return nil, err
		}
		for _, device := range page.Devices {
			if !excluded[device.ID] {
				ids = append(ids, device.ID)
			}
		}
		if len(page.Devices) == 0 || offset+len(page.Devices) >= page.Pagination.Total || len(page.Devices) < 250 {
			break
		}
	}
	return ids, nil
}

func reportDeviceInTimeRange(device accountclient.Device, scope map[string]any) bool {
	startText, _ := scope["start_at"].(string)
	endText, _ := scope["end_at"].(string)
	var start, end time.Time
	var err error
	if strings.TrimSpace(startText) != "" {
		start, err = time.Parse("2006-01-02", startText)
		if err != nil {
			return false
		}
	}
	if strings.TrimSpace(endText) != "" {
		end, err = time.Parse("2006-01-02", endText)
		if err != nil {
			return false
		}
		end = end.Add(24 * time.Hour)
	}
	if start.IsZero() && end.IsZero() {
		return true
	}
	updatedAt, updatedErr := time.Parse(time.RFC3339, device.UpdatedAt)
	lastSeenAt, lastSeenErr := time.Parse(time.RFC3339, device.LastSeenAt)
	if updatedErr != nil && lastSeenErr != nil {
		return false
	}
	observedAt := updatedAt
	if observedAt.IsZero() || (lastSeenErr == nil && lastSeenAt.After(observedAt)) {
		observedAt = lastSeenAt
	}
	return (start.IsZero() || !observedAt.Before(start)) && (end.IsZero() || observedAt.Before(end))
}

func (s *Server) apiReports(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if r.Method == http.MethodGet {
		jobs, err := s.jobs.ListBatchJobs(org.ID, 250)
		if err != nil {
			http.Error(w, "報表暫時無法取得。", http.StatusServiceUnavailable)
			return
		}
		reports := make([]contracts.BatchJob, 0)
		for _, job := range jobs {
			if job.Type == "report_export" {
				reports = append(reports, job)
			}
		}
		writeJSON(w, map[string]any{"reports": reports, "source_status": "available"})
		return
	}
	var request struct {
		Name  string         `json:"name"`
		Scope map[string]any `json:"scope"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil || strings.TrimSpace(request.Name) == "" {
		http.Error(w, "報表條件不正確。", http.StatusBadRequest)
		return
	}
	job, err := s.jobs.CreateBatchJob(contracts.BatchJob{Type: "report_export", Name: strings.TrimSpace(request.Name), OrganizationID: org.ID, CreatedBy: session.Email, Scope: request.Scope, State: "queued"})
	if err != nil {
		http.Error(w, "報表無法建立。", http.StatusServiceUnavailable)
		return
	}
	go s.runBatchJob(job, tokens.AccessToken)
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"report": job, "source_status": "available"})
}

func (s *Server) apiReport(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, _, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	job, err := s.jobs.GetBatchJob(org.ID, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "找不到這份報表。", http.StatusNotFound)
		return
	}
	if err != nil || job.Type != "report_export" {
		http.Error(w, "報表暫時無法取得。", http.StatusServiceUnavailable)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "csv") {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="fleet-report-`+job.ID+`.csv"`)
		writer := csv.NewWriter(w)
		_ = writer.Write([]string{"項目", "名稱", "數量"})
		for _, item := range job.Result {
			metric, _ := item["metric"].(string)
			name, _ := item["name"].(string)
			_ = writer.Write([]string{metric, name, fmt.Sprint(item["value"])})
		}
		writer.Flush()
		return
	}
	writeJSON(w, map[string]any{"report": job, "items": job.Result, "source_status": "available"})
}

func fleetDeviceQuery(values url.Values) url.Values {
	query := make(url.Values)
	for _, key := range []string{"q", "sku_id", "group_id", "region", "category", "model", "status", "readiness", "firmware", "sort", "direction", "limit", "offset"} {
		if value := strings.TrimSpace(values.Get(key)); value != "" {
			query.Set(key, value)
		}
	}
	if query.Get("limit") == "" {
		query.Set("limit", "100")
	}
	return query
}

func (s *Server) apiSKUs(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSON(w, map[string]any{"skus": []contracts.SKU{}, "source_status": "unconfigured"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var profiles []accountclient.DeviceItemProfile
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		profiles, callErr = s.accountClient.DeviceItemProfiles(r.Context(), token, org.ID, r.URL.Query())
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var fleetSummary accountclient.FleetSummary
	tokens, summaryErr := s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		fleetSummary, callErr = s.accountClient.FleetSummary(r.Context(), token, org.ID)
		return callErr
	})
	if summaryErr != nil {
		fleetSummary = accountclient.FleetSummary{}
	}
	items := make([]contracts.SKU, 0, len(profiles))
	capabilities := capabilitiesForOrganization(org)
	for _, profile := range profiles {
		item := customerSKUWithActionsAndSummary(profile, capabilities, &fleetSummary)
		var runs []accountclient.ProductionRun
		var runErr error
		tokens, runErr = s.customerCall(r.Context(), tokens, func(token string) error {
			runs, runErr = s.accountClient.ProductionRuns(r.Context(), token, org.ID, profile.ID, url.Values{"limit": []string{"250"}})
			return runErr
		})
		if runErr == nil {
			item.ProductionRunCount = len(runs)
		}
		items = append(items, item)
	}
	writeJSON(w, map[string]any{"skus": items, "can_manage": hasCapability(capabilities, "registry_device.manage") || hasCapability(capabilities, capabilityCustomerFirmwareManage), "source_status": "available"})
}

func (s *Server) apiSKU(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSON(w, map[string]any{"source_status": "unconfigured"})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var profile accountclient.DeviceItemProfile
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		profile, callErr = s.accountClient.DeviceItemProfile(r.Context(), token, org.ID, r.PathValue("id"))
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	_ = tokens
	writeJSON(w, map[string]any{"sku": customerSKUWithActions(profile, capabilitiesForOrganization(org)), "source_status": "available"})
}

func (s *Server) apiSKUReleases(w http.ResponseWriter, r *http.Request) {
	clone := r.Clone(r.Context())
	clone.URL.Path = "/api/ota/skus/" + url.PathEscape(r.PathValue("id")) + "/releases"
	s.apiSKUOTA(w, clone)
}

func (s *Server) apiSKURelease(w http.ResponseWriter, r *http.Request) {
	clone := r.Clone(r.Context())
	upstreamPath := "/api/ota/skus/" + url.PathEscape(r.PathValue("id")) + "/releases/" + url.PathEscape(r.PathValue("releaseId"))
	if action := strings.TrimSpace(r.PathValue("action")); action != "" {
		upstreamPath += ":" + url.PathEscape(action)
	}
	clone.URL.Path = upstreamPath
	s.apiSKUOTA(w, clone)
}

func (s *Server) apiSKUWrite(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "SKU 服務尚未設定。", http.StatusServiceUnavailable)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if !hasCapability(capabilitiesForOrganization(org), "registry_device.manage") && !hasCapability(capabilitiesForOrganization(org), capabilityCustomerFirmwareManage) {
		http.Error(w, "目前角色沒有管理 SKU 的權限。", http.StatusForbidden)
		return
	}
	var input struct {
		ProfileKey          string         `json:"sku_id,omitempty"`
		Name                string         `json:"name,omitempty"`
		ProductModel        string         `json:"product_model,omitempty"`
		Category            string         `json:"category,omitempty"`
		Manufacturer        string         `json:"manufacturer,omitempty"`
		ServiceCapabilities []string       `json:"service_capabilities,omitempty"`
		DevicePolicy        map[string]any `json:"device_policy,omitempty"`
		FirmwarePolicy      map[string]any `json:"firmware_policy,omitempty"`
	}
	if strings.HasSuffix(r.URL.Path, "/disable") {
		input = struct {
			ProfileKey          string         `json:"sku_id,omitempty"`
			Name                string         `json:"name,omitempty"`
			ProductModel        string         `json:"product_model,omitempty"`
			Category            string         `json:"category,omitempty"`
			Manufacturer        string         `json:"manufacturer,omitempty"`
			ServiceCapabilities []string       `json:"service_capabilities,omitempty"`
			DevicePolicy        map[string]any `json:"device_policy,omitempty"`
			FirmwarePolicy      map[string]any `json:"firmware_policy,omitempty"`
		}{}
	} else if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		http.Error(w, "SKU 資料格式不正確。", http.StatusBadRequest)
		return
	}
	request := accountclient.DeviceItemProfileRequest{ProfileKey: strings.TrimSpace(input.ProfileKey), DisplayName: strings.TrimSpace(input.Name), Category: strings.TrimSpace(input.Category), Manufacturer: strings.TrimSpace(input.Manufacturer), Model: strings.TrimSpace(input.ProductModel), ServiceOptions: customerServiceOptions(input.ServiceCapabilities), ClaimPolicy: input.DevicePolicy, ProvisioningPolicy: input.DevicePolicy}
	if request.ProfileKey == "" && request.DisplayName != "" {
		request.ProfileKey = "sku-" + strings.ToLower(strings.NewReplacer(" ", "-", "/", "-", "_", "-").Replace(request.DisplayName))
	}
	if r.Method == http.MethodPost {
		request.CAProfile = "brand-default"
		request.IssuerProfile = "brand-default"
	}
	var profile accountclient.DeviceItemProfile
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		if r.PathValue("id") == "" {
			profile, callErr = s.accountClient.CreateDeviceItemProfile(r.Context(), token, org.ID, request)
		} else if strings.HasSuffix(r.URL.Path, "/disable") {
			profile, callErr = s.accountClient.DisableDeviceItemProfile(r.Context(), token, org.ID, r.PathValue("id"))
		} else {
			profile, callErr = s.accountClient.UpdateDeviceItemProfile(r.Context(), token, org.ID, r.PathValue("id"), request)
		}
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	_ = tokens
	status := http.StatusOK
	if r.Method == http.MethodPost && r.PathValue("id") == "" {
		status = http.StatusCreated
	}
	writeJSONStatus(w, status, map[string]any{"sku": customerSKUWithActions(profile, capabilitiesForOrganization(org)), "source_status": "available"})
}

func customerServiceOptions(labels []string) []string {
	options := make([]string, 0, len(labels))
	for _, label := range labels {
		switch strings.TrimSpace(label) {
		case "影像服務":
			options = append(options, "video_streaming")
		case "即時觀看":
			options = append(options, "video_streaming")
		case "錄影與保存":
			options = append(options, "video_storage")
		case "設備回報":
			options = append(options, "mqtt")
		}
	}
	return normalizeCapabilities(options)
}

func (s *Server) apiSKUPermissions(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() {
		writeJSON(w, map[string]any{"source_status": "unconfigured", "allowed_actions": []string{}})
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var profile accountclient.DeviceItemProfile
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		profile, callErr = s.accountClient.DeviceItemProfile(r.Context(), token, org.ID, r.PathValue("id"))
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	_ = tokens
	writeJSON(w, map[string]any{"sku_id": profile.ID, "allowed_actions": skuAllowedActions(capabilitiesForOrganization(org)), "source_status": "available"})
}

func (s *Server) apiSKUImpactPreview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, tokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if !hasCapability(capabilitiesForOrganization(org), "registry_device.manage") && !hasCapability(capabilitiesForOrganization(org), capabilityCustomerFirmwareManage) {
		http.Error(w, "目前角色沒有預覽 SKU 變更的權限。", http.StatusForbidden)
		return
	}
	var proposed struct {
		ServiceCapabilities []string       `json:"service_capabilities"`
		DevicePolicy        map[string]any `json:"device_policy"`
		FirmwarePolicy      map[string]any `json:"firmware_policy"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&proposed); err != nil {
		http.Error(w, "SKU 變更資料格式不正確。", http.StatusBadRequest)
		return
	}
	var profile accountclient.DeviceItemProfile
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		profile, callErr = s.accountClient.DeviceItemProfile(r.Context(), token, org.ID, r.PathValue("id"))
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	var summary accountclient.FleetSummary
	tokens, err = s.customerCall(r.Context(), tokens, func(token string) error {
		var callErr error
		summary, callErr = s.accountClient.FleetSummary(r.Context(), token, org.ID)
		return callErr
	})
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	currentServices := customerServiceOptions(profile.ServiceOptions)
	proposedServices := customerServiceOptions(proposed.ServiceCapabilities)
	added, removed := stringSetDiff(proposedServices, currentServices), stringSetDiff(currentServices, proposedServices)
	writeJSON(w, map[string]any{
		"sku_id":                   r.PathValue("id"),
		"affected_devices":         summary.BySKU[r.PathValue("id")],
		"affected_regions":         summary.BySKURegion[r.PathValue("id")],
		"current_services":         currentServices,
		"proposed_services":        proposedServices,
		"added_services":           added,
		"removed_services":         removed,
		"requires_reprovision":     len(removed) > 0 || len(proposed.DevicePolicy) > 0,
		"requires_firmware_update": len(proposed.FirmwarePolicy) > 0,
		"source_status":            "available",
	})
}

func stringSetDiff(left, right []string) []string {
	rightSet := make(map[string]bool, len(right))
	for _, value := range right {
		rightSet[value] = true
	}
	result := make([]string, 0)
	for _, value := range left {
		if !rightSet[value] {
			result = append(result, value)
		}
	}
	return result
}

func customerSKU(profile accountclient.DeviceItemProfile) contracts.SKU {
	return customerSKUWithActions(profile, nil)
}

func customerSKUWithActions(profile accountclient.DeviceItemProfile, capabilities []string) contracts.SKU {
	return customerSKUWithActionsAndSummary(profile, capabilities, nil)
}

func customerSKUWithActionsAndSummary(profile accountclient.DeviceItemProfile, capabilities []string, summary *accountclient.FleetSummary) contracts.SKU {
	services := make([]string, 0, len(profile.ServiceOptions))
	hasOTA := false
	for _, option := range profile.ServiceOptions {
		switch strings.TrimSpace(option) {
		case "video", "video_cloud", "camera":
			services = append(services, "影像服務")
		case "streaming", "webrtc", "stream":
			services = append(services, "即時觀看")
		case "recording", "clips", "media":
			services = append(services, "錄影與保存")
		case "telemetry", "device_health", "mqtt":
			services = append(services, "設備回報")
		case "firmware", "ota":
			services = append(services, "韌體更新")
			hasOTA = true
		}
	}
	deviceCount := 0
	var regionDistribution map[string]int
	if summary != nil {
		deviceCount = summary.BySKU[profile.ID]
		regionDistribution = summary.BySKURegion[profile.ID]
	}
	return contracts.SKU{
		ID:                  profile.ID,
		Name:                profile.DisplayName,
		ProductModel:        profile.Model,
		Category:            profile.Category,
		Status:              profile.Status,
		ServiceCapabilities: services,
		DevicePolicy: map[string]any{
			"setup_available":   len(profile.ProvisioningPolicy) > 0,
			"binding_available": len(profile.ClaimPolicy) > 0,
		},
		FirmwarePolicy: map[string]any{
			"ota_enabled": hasOTA,
		},
		AllowedActions:     skuAllowedActions(capabilities),
		UpdatedAt:          profile.UpdatedAt,
		DeviceCount:        deviceCount,
		RegionDistribution: regionDistribution,
		FirmwareDistribution: func() map[string]int {
			if summary == nil {
				return nil
			}
			return summary.BySKUFirmware[profile.ID]
		}(),
	}
}

func skuAllowedActions(capabilities []string) []string {
	actions := []string{"read"}
	if hasCapability(capabilities, "registry_device.manage") || hasCapability(capabilities, "customer.devices.provision") {
		actions = append(actions, "manage_devices")
	}
	if hasCapability(capabilities, "ota_campaign:create") || hasCapability(capabilities, capabilityCustomerFirmwareManage) {
		actions = append(actions, "manage_updates")
	}
	if hasCapability(capabilities, "report.read") || hasCapability(capabilities, "customer.reports.read") {
		actions = append(actions, "view_reports")
	}
	return actions
}

func (s *Server) apiAdminDevices(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if s.usePlatformAdminUpstream(session) {
		devices, err := s.platformAdminDevices(r.Context(), session)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, devicesWithFirmwareVersion(devices))
		return
	}
	devices, err := s.projections.ListDevices()
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
				writeJSON(w, customerSafeDevice(deviceWithFirmwareVersion(device)))
				return
			}
		}
		http.NotFound(w, r)
		return
	}
	device, err := s.projections.GetDevice(r.PathValue("id"))
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
	status, message := s.customerFleetSourceStatus()
	writeJSON(w, unavailableFleetHealthSummary(orgID, days, status, message))
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
	devices, err := s.customerStreamDevices(r.Context(), session, orgID)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	devices = filterDevicesByOrg(devices, orgID)
	if s.videoClient.Enabled() && strings.TrimSpace(s.cfg.VideoCloudAdminToken) != "" {
		stats, err := s.videoClient.FleetStreamStats(r.Context(), s.cfg.VideoCloudAdminToken, orgID, window, videoCloudDeviceIDs(devices))
		if err != nil {
			writeJSON(w, unavailableFleetStreamStats(orgID, window, "unavailable", "Stream source is unavailable."))
			return
		}
		writeJSON(w, mapVideoCloudFleetStreamStats(stats, orgID, window))
		return
	}
	_ = days
	status, message := s.customerStreamSourceStatus()
	writeJSON(w, unavailableFleetStreamStats(orgID, window, status, message))
}

func (s *Server) apiFleetFirmwareDistribution(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
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
		writeJSON(w, unavailableFirmwareDistribution(orgID, "unavailable", "Firmware source is unavailable."))
		return
	} else if ok {
		dist.SourceStatus = "available"
		dist.SourceMessage = "Firmware source loaded from Video Cloud."
		writeJSON(w, dist)
		return
	}
	status, message := s.customerFirmwareSourceStatus(devices)
	writeJSON(w, unavailableFirmwareDistribution(orgID, status, message))
}

func (s *Server) apiSKUOTA(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	orgID := strings.TrimSpace(session.ActiveOrgID)
	capabilities := fleetManagerCapabilities()
	if s.accountClient.Enabled() {
		org, tokens, err := s.activeCustomerOrg(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		orgID = org.ID
		capabilities = capabilitiesForOrganization(org)
		otaParts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/ota/"), "/"), "/")
		if len(otaParts) >= 2 && otaParts[0] == "skus" && strings.TrimSpace(otaParts[1]) != "" {
			permission := "registry_device.read"
			if r.Method != http.MethodGet {
				permission = "registry_device.manage"
			}
			allowed, checkErr := s.accountClient.CheckAccess(r.Context(), tokens.AccessToken, org.ID, permission, "sku", otaParts[1])
			if checkErr != nil {
				s.writeCustomerErrorForSession(w, session.ID, checkErr)
				return
			}
			if !allowed {
				http.Error(w, "目前角色沒有管理此 SKU 的權限。", http.StatusForbidden)
				return
			}
		}
	}
	required := capabilityCustomerFirmwareRead
	if r.Method != http.MethodGet {
		required = capabilityCustomerFirmwareManage
	}
	if !hasCapability(capabilities, required) {
		http.Error(w, "missing required capability: "+required, http.StatusForbidden)
		return
	}
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "fail", "code": "OTA_UNAVAILABLE", "reason": "Video Cloud OTA source is unavailable."})
		return
	}
	upstreamPath := "/v1/ota/" + strings.TrimPrefix(r.URL.Path, "/api/ota/")
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	response, err := s.videoClient.DoOTA(r.Context(), r.Method, upstreamPath, s.cfg.VideoCloudAdminToken, orgID, r.Header.Get("Idempotency-Key"), body)
	result := "succeeded"
	if err != nil {
		result = "failed"
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "fail", "code": "OTA_UPSTREAM_ERROR", "reason": "Video Cloud OTA request failed."})
	} else {
		contentType := response.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/json"
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(response.Body)
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			result = "rejected"
		}
	}
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "sku_ota." + strings.ToLower(r.Method), Target: upstreamPath, OrganizationID: orgID, Result: result})
}

func (s *Server) apiUpdatePlans(w http.ResponseWriter, r *http.Request) {
	upstreamPath := ""
	var body []byte
	if r.Method == http.MethodGet && r.PathValue("id") == "" {
		skuID := strings.TrimSpace(r.URL.Query().Get("sku_id"))
		if skuID == "" {
			http.Error(w, "請先選擇 SKU。", http.StatusBadRequest)
			return
		}
		upstreamPath = "/api/ota/skus/" + url.PathEscape(skuID) + "/campaigns"
	} else if r.PathValue("id") == "" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&payload); err != nil {
			http.Error(w, "更新計畫資料格式不正確。", http.StatusBadRequest)
			return
		}
		skuID, _ := payload["sku_id"].(string)
		if strings.TrimSpace(skuID) == "" {
			http.Error(w, "更新計畫必須指定 SKU。", http.StatusBadRequest)
			return
		}
		delete(payload, "sku_id")
		body, _ = json.Marshal(payload)
		upstreamPath = "/api/ota/skus/" + url.PathEscape(strings.TrimSpace(skuID)) + "/campaigns"
	} else {
		id := url.PathEscape(r.PathValue("id"))
		upstreamPath = "/api/ota/campaigns/" + id
		if action := strings.TrimSpace(r.PathValue("action")); action != "" {
			if action == "start" {
				action = "activate"
			}
			upstreamPath += ":" + url.PathEscape(action)
		}
		if r.Method == http.MethodPost {
			body, _ = io.ReadAll(io.LimitReader(r.Body, 2<<20))
		}
	}
	clone := r.Clone(r.Context())
	clone.URL.Path = upstreamPath
	clone.Body = io.NopCloser(bytes.NewReader(body))
	s.apiSKUOTA(w, clone)
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
	devices, err := s.projections.ListDevices()
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
				if !matchesFirmwareRolloutDevice(device, rollout) {
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
			for _, campaignID := range firmwareCampaignKeys(rollout.CampaignID) {
				rolloutsByCampaign[campaignID] = append(rolloutsByCampaign[campaignID], rollout)
			}
		}
		for _, campaign := range campaignResp {
			if !isVisibleFirmwareCampaignState(campaign.State) {
				continue
			}
			rollouts := make([]videoclient.FirmwareRolloutRecord, 0)
			for _, campaignID := range firmwareCampaignKeys(campaign.ID, campaign.CampaignID) {
				rollouts = append(rollouts, rolloutsByCampaign[campaignID]...)
			}
			if campaignSummary := summarizeFirmwareCampaign(campaign, rollouts); campaignSummary.CampaignID != "" {
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

func matchesFirmwareRolloutDevice(device contracts.Device, rollout videoclient.FirmwareRolloutRecord) bool {
	rolloutID := strings.TrimSpace(rollout.DeviceID)
	accountID := strings.TrimSpace(rollout.AccountDeviceID)
	deviceID := strings.TrimSpace(device.ID)
	videoCloudID := strings.TrimSpace(device.VideoCloudDevID)
	return rolloutID != "" && (rolloutID == deviceID || rolloutID == videoCloudID) ||
		accountID != "" && (accountID == deviceID || accountID == videoCloudID)
}

func firmwareCampaignKeys(values ...string) []string {
	keys := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		key := strings.TrimSpace(value)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
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

func (s *Server) customerFleetSourceStatus() (string, string) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
		return "not_configured", "Telemetry source is not configured."
	}
	return "no_data", "Fleet telemetry summary is not available from the configured source."
}

func (s *Server) customerStreamSourceStatus() (string, string) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
		return "not_configured", "WebRTC session event source is not configured."
	}
	return "no_data", "No stream session read model is available for the selected window."
}

func (s *Server) customerFirmwareSourceStatus(devices []contracts.Device) (string, string) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" {
		return "not_configured", "Firmware observation source is not configured."
	}
	if len(devices) == 0 {
		return "no_data", "No devices are available for firmware observation."
	}
	return "no_data", "No observed firmware or active campaigns are available."
}

func unavailableFleetHealthSummary(orgID string, days int, status string, message string) contracts.FleetHealthSummary {
	return contracts.FleetHealthSummary{
		OrgID:         orgID,
		SourceStatus:  status,
		SourceMessage: message,
		Current:       contracts.FleetHealthCurrent{},
		Trend:         []contracts.FleetHealthTrendPoint{},
	}
}

func unavailableFleetStreamStats(orgID string, window string, status string, message string) contracts.FleetStreamStats {
	return contracts.FleetStreamStats{
		OrgID:          orgID,
		Window:         window,
		SourceStatus:   status,
		SourceMessage:  message,
		ByMode:         map[string]contracts.FleetStreamStatsMode{streamModeWebRTC: {Requests: 0, SuccessRatePct: 0}},
		Trend:          []contracts.FleetStreamTrendPoint{},
		TrendByMode:    []contracts.FleetStreamModeTrend{},
		WorstDevices:   []contracts.FleetStreamWorstDevice{},
		ActiveSessions: 0,
	}
}

func unavailableFirmwareDistribution(orgID string, status string, message string) contracts.FirmwareDistribution {
	return contracts.FirmwareDistribution{
		OrgID:         orgID,
		SourceStatus:  status,
		SourceMessage: message,
		Versions:      []contracts.FirmwareDistributionVersion{},
		Campaigns:     []contracts.FirmwareDistributionCampaign{},
	}
}

func filterDevicesByOrg(devices []contracts.Device, orgID string) []contracts.Device {
	filtered := make([]contracts.Device, 0, len(devices))
	for _, device := range devices {
		if device.OrganizationID == orgID {
			filtered = append(filtered, device)
		}
	}
	return filtered
}

func videoCloudDeviceIDs(devices []contracts.Device) []string {
	ids := make([]string, 0, len(devices))
	for _, device := range devices {
		if id := strings.TrimSpace(device.VideoCloudDevID); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func mapVideoCloudFleetStreamStats(stats videoclient.FleetStreamStats, orgID, window string) contracts.FleetStreamStats {
	out := contracts.FleetStreamStats{
		OrgID:              fallback(stats.OrgID, orgID),
		Window:             fallback(stats.Window, window),
		SourceStatus:       "available",
		SourceMessage:      "Stream source loaded from Video Cloud.",
		SuccessRatePct:     stats.SuccessRatePct,
		AvgDurationSeconds: stats.AvgDurationSeconds,
		ActiveSessions:     stats.ActiveSessions,
		NeverStreamedCount: stats.NeverStreamedCount,
		ByMode:             make(map[string]contracts.FleetStreamStatsMode, len(stats.ByMode)),
		Trend:              make([]contracts.FleetStreamTrendPoint, 0, len(stats.Trend)),
		TrendByMode:        make([]contracts.FleetStreamModeTrend, 0, len(stats.TrendByMode)),
		WorstDevices:       make([]contracts.FleetStreamWorstDevice, 0, len(stats.WorstDevices)),
	}
	for mode, modeStats := range stats.ByMode {
		out.ByMode[mode] = contracts.FleetStreamStatsMode{
			Requests:       modeStats.Requests,
			SuccessRatePct: modeStats.SuccessRatePct,
		}
	}
	for _, point := range stats.Trend {
		out.Trend = append(out.Trend, contracts.FleetStreamTrendPoint{
			Date:           point.Date,
			Requests:       point.Requests,
			SuccessRatePct: point.SuccessRatePct,
		})
	}
	for _, series := range stats.TrendByMode {
		mapped := contracts.FleetStreamModeTrend{
			Mode:   series.Mode,
			Points: make([]contracts.FleetStreamTrendPoint, 0, len(series.Points)),
		}
		for _, point := range series.Points {
			mapped.Points = append(mapped.Points, contracts.FleetStreamTrendPoint{
				Date:           point.Date,
				Requests:       point.Requests,
				SuccessRatePct: point.SuccessRatePct,
			})
		}
		out.TrendByMode = append(out.TrendByMode, mapped)
	}
	for _, device := range stats.WorstDevices {
		out.WorstDevices = append(out.WorstDevices, contracts.FleetStreamWorstDevice{
			DeviceID:       device.DeviceID,
			DeviceName:     device.DeviceName,
			ModeUsed:       device.ModeUsed,
			Readiness:      device.Readiness,
			SuccessRatePct: device.SuccessRatePct,
			Requests:       device.Requests,
			LastStreamAt:   device.LastStreamAt,
		})
	}
	return out
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
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	return org.ID, nil
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
				if telemetry, ok, err := s.proxyTelemetryForDevice(r.Context(), device.OrganizationID, device); err != nil {
					status, reason := telemetryUnavailableFromVideoCloudError(err)
					writeJSON(w, unavailableTelemetryForDevice(device, status, reason))
					return
				} else if ok {
					writeJSON(w, telemetry)
					return
				}
				writeJSON(w, unavailableTelemetryForDevice(device, "not_configured", "Video Cloud telemetry source is not configured."))
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
	device, err := s.projections.GetDevice(r.PathValue("id"))
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
	if telemetry, ok, err := s.proxyTelemetryForDevice(r.Context(), telemetryDevice.OrganizationID, telemetryDevice); err != nil {
		status, reason := telemetryUnavailableFromVideoCloudError(err)
		writeJSON(w, unavailableTelemetryForDevice(telemetryDevice, status, reason))
		return
	} else if ok {
		writeJSON(w, telemetry)
		return
	}
	writeJSON(w, unavailableTelemetryForDevice(telemetryDevice, "not_configured", "Video Cloud telemetry source is not configured."))
}

func (s *Server) proxyTelemetryForDevice(ctx context.Context, orgID string, device contracts.Device) (contracts.DeviceTelemetry, bool, error) {
	if !s.videoClient.Enabled() || strings.TrimSpace(s.cfg.VideoCloudAdminToken) == "" || strings.TrimSpace(device.VideoCloudDevID) == "" {
		return contracts.DeviceTelemetry{}, false, nil
	}
	upstream, err := s.videoClient.DeviceTelemetry(ctx, s.cfg.VideoCloudAdminToken, device.VideoCloudDevID, orgID)
	if err != nil {
		return contracts.DeviceTelemetry{}, true, fmt.Errorf("%w: %w", errVideoCloudRequestFailed, err)
	}
	if !videoCloudTelemetryHasSamples(upstream) {
		return unavailableTelemetryForDevice(device, "unavailable", "No telemetry samples are available for this device."), true, nil
	}
	info, err := s.videoClient.GetDeviceInfo(ctx, s.cfg.VideoCloudAdminToken, device.VideoCloudDevID)
	firmwareVersion := firmwareVersionFromDevice(device)
	if err == nil && strings.TrimSpace(info.FirmwareVersion) != "" {
		firmwareVersion = strings.TrimSpace(info.FirmwareVersion)
	}
	return telemetryFromVideoCloud(device, firmwareVersion, upstream), true, nil
}

func telemetryUnavailableFromVideoCloudError(err error) (string, string) {
	var statusErr videoclient.HTTPStatusError
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "unauthorized", "Video Cloud telemetry is not authorized for this customer."
		case http.StatusNotFound:
			return "unavailable", "Video Cloud telemetry source was not found for this device."
		default:
			return "unavailable", "Video Cloud telemetry is unavailable."
		}
	}
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &syntaxErr) || errors.As(err, &typeErr) {
		return "unavailable", "Video Cloud telemetry returned an unexpected schema."
	}
	return "unavailable", "Video Cloud telemetry is unavailable."
}

func videoCloudTelemetryHasSamples(upstream videoclient.DeviceTelemetryResponse) bool {
	return upstream.LatestHealth != nil ||
		len(upstream.RSSIHistory) > 0 ||
		len(upstream.UptimeHistory) > 0 ||
		len(upstream.RecentEvents) > 0
}

func telemetryFromVideoCloud(device contracts.Device, firmwareVersion string, upstream videoclient.DeviceTelemetryResponse) contracts.DeviceTelemetry {
	signals := telemetrySignalsFromUpstream(upstream.LatestHealth, upstream.RecentEvents)
	health := telemetryHealthFromUpstream(upstream.LatestHealth, signals)
	if strings.TrimSpace(firmwareVersion) == "" {
		firmwareVersion = "unknown"
	}
	return contracts.DeviceTelemetry{
		DeviceID:           device.ID,
		DeviceName:         fallback(strings.TrimSpace(upstream.DeviceName), device.Name),
		Organization:       device.Organization,
		SerialNumber:       device.SerialNumber,
		Model:              device.Model,
		LastSeenAt:         fallback(device.LastSeenAt, telemetryLastSeenAt(upstream)),
		Health:             health,
		Signals:            signals,
		FirmwareVersion:    strings.TrimSpace(firmwareVersion),
		TelemetryStatus:    "available",
		ActiveStreamStatus: "unknown",
		RSSI7D:             telemetryRSSI7D(upstream.RSSIHistory),
		Uptime7D:           telemetryUptime7D(upstream.UptimeHistory),
		RecentEvents:       telemetryRecentEvents(upstream.RecentEvents, 10),
	}
}

func unavailableTelemetryForDevice(device contracts.Device, status string, reason string) contracts.DeviceTelemetry {
	return contracts.DeviceTelemetry{
		DeviceID:           device.ID,
		DeviceName:         device.Name,
		Organization:       device.Organization,
		SerialNumber:       device.SerialNumber,
		Model:              device.Model,
		LastSeenAt:         device.LastSeenAt,
		Health:             firstNonEmpty(device.Health, deviceHealthFromFacts(device), "unknown"),
		Signals:            []string{},
		FirmwareVersion:    firmwareVersionFromDevice(device),
		TelemetryStatus:    status,
		ActiveStreamStatus: "unavailable",
		UnavailableReason:  reason,
		RSSI7D:             []contracts.TelemetryRssiSample{},
		Uptime7D:           []contracts.TelemetryUptimeSample{},
		RecentEvents:       []contracts.TelemetryEvent{},
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
	device.Health = deviceHealthFromFacts(device)
	device.SignalQuality = deviceSignalQuality(device)
	return device
}

func devicesWithFirmwareVersion(devices []contracts.Device) []contracts.Device {
	out := make([]contracts.Device, len(devices))
	for i, device := range devices {
		out[i] = deviceWithFirmwareVersion(device)
	}
	return out
}

func customerSafeDevice(device contracts.Device) contracts.CustomerDevice {
	facts := make([]contracts.CustomerSourceFact, 0, len(device.SourceFacts))
	for _, fact := range device.SourceFacts {
		facts = append(facts, contracts.CustomerSourceFact{
			Layer:     customerSafeFactLayer(fact.Layer),
			State:     customerSafeFactState(fact.State),
			Detail:    customerSafeFactDetail(fact.Detail),
			Retryable: fact.Retryable,
			ErrorCode: fact.ErrorCode,
			UpdatedAt: fact.UpdatedAt,
		})
	}
	return contracts.CustomerDevice{
		ID:              device.ID,
		OrganizationID:  device.OrganizationID,
		SKU:             device.SKU,
		Organization:    device.Organization,
		Name:            device.Name,
		Category:        device.Category,
		Model:           device.Model,
		SerialNumber:    device.SerialNumber,
		FirmwareVersion: device.FirmwareVersion,
		Health:          device.Health,
		SignalQuality:   device.SignalQuality,
		Status:          device.Status,
		Readiness:       device.Readiness,
		SourceFacts:     facts,
		LastSeenAt:      device.LastSeenAt,
		UpdatedAt:       device.UpdatedAt,
	}
}

func customerSafeDevices(devices []contracts.Device) []contracts.CustomerDevice {
	out := make([]contracts.CustomerDevice, len(devices))
	for i, device := range devices {
		out[i] = customerSafeDevice(device)
	}
	return out
}

func customerSafeFactLayer(layer string) string {
	switch strings.ToLower(strings.TrimSpace(layer)) {
	case "account_manager", "account":
		return "Registry"
	case "video_cloud", "video":
		return "Streaming"
	case "operation", "operations":
		return "Lifecycle"
	default:
		return customerSafeTitle(strings.ReplaceAll(strings.TrimSpace(layer), "_", " "))
	}
}

func customerSafeFactState(state string) string {
	if strings.EqualFold(strings.TrimSpace(state), string(contracts.OperationDeadLettered)) {
		return "failed"
	}
	return strings.TrimSpace(state)
}

func customerSafeFactDetail(detail string) string {
	text := strings.TrimSpace(detail)
	text = operationIDPattern.ReplaceAllString(text, "operation")
	text = strings.ReplaceAll(text, "dead_lettered", "failed")
	return text
}

func customerSafeTitle(value string) string {
	words := strings.Fields(strings.TrimSpace(value))
	for i, word := range words {
		if word == "" {
			continue
		}
		words[i] = strings.ToUpper(word[:1]) + strings.ToLower(word[1:])
	}
	return strings.Join(words, " ")
}

func deviceHealthFromFacts(device contracts.Device) string {
	hasWarning := false
	for _, fact := range device.SourceFacts {
		switch strings.ToLower(strings.TrimSpace(fact.State)) {
		case "failed":
			return "critical"
		case "missing", "pending", "stale":
			hasWarning = true
		}
	}
	if hasWarning {
		return "warning"
	}
	return telemetryHealthFromReadiness(device.Readiness)
}

func deviceSignalQuality(device contracts.Device) string {
	switch deviceHealthFromFacts(device) {
	case "healthy":
		return "Good"
	case "warning":
		return "Fair"
	case "critical":
		return "Poor"
	default:
		return "Unknown"
	}
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
	customers, err := s.projections.ListCustomers()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, customers)
}

func (s *Server) apiAdminCustomers(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if s.usePlatformAdminUpstream(session) {
		customers, err := s.platformAdminCustomers(r.Context(), session)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, customers)
		return
	}
	customers, err := s.projections.ListCustomers()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, customers)
}

func (s *Server) apiAdminSSOProviders(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "Account Manager is not configured for SSO provider settings", http.StatusServiceUnavailable)
		return
	}
	providers, err := s.accountClient.SSOProviderStatuses(r.Context(), session.AccessToken)
	if err != nil {
		writeSSOError(w, err)
		return
	}
	writeJSON(w, map[string][]accountclient.SSOProviderStatus{"providers": providers})
}

func (s *Server) apiAdminBrandClouds(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		brandClouds, err := s.accountClient.BrandClouds(r.Context(), session.AccessToken)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		filtered := filterBrandCloudsForList(brandClouds, r.URL.Query())
		limit, offset := paginationFromQuery(r.URL.Query(), 25, 100)
		total := len(filtered)
		end := offset + limit
		if end > total {
			end = total
		}
		page := []accountclient.BrandCloud{}
		if offset < total {
			page = filtered[offset:end]
		}
		writeJSON(w, map[string]any{
			"brand_clouds": page,
			"pagination": map[string]int{
				"limit":  limit,
				"offset": offset,
				"total":  total,
			},
		})
		return
	}

	var body accountclient.BrandCloudRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid brand cloud request", http.StatusBadRequest)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	brandCloud, err := s.accountClient.CreateBrandCloud(r.Context(), session.AccessToken, body)
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.create", brandCloud.ID, "", "accepted")
	writeJSONStatus(w, http.StatusCreated, map[string]accountclient.BrandCloud{"brand_cloud": brandCloud})
}

func (s *Server) apiAdminBrandCloud(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	brandCloudID := strings.TrimSpace(r.PathValue("brandCloudId"))
	if brandCloudID == "" {
		http.Error(w, "brand cloud id is required", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodGet {
		brandCloud, err := s.accountClient.BrandCloud(r.Context(), session.AccessToken, brandCloudID)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, map[string]accountclient.BrandCloud{"brand_cloud": brandCloud})
		return
	}

	var body accountclient.BrandCloudRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid brand cloud request", http.StatusBadRequest)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Status = strings.TrimSpace(body.Status)
	brandCloud, err := s.accountClient.UpdateBrandCloud(r.Context(), session.AccessToken, brandCloudID, body)
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.update", brandCloudID, "", "accepted")
	writeJSON(w, map[string]accountclient.BrandCloud{"brand_cloud": brandCloud})
}

func (s *Server) apiAdminBrandCloudMember(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	brandCloudID := strings.TrimSpace(r.PathValue("brandCloudId"))
	if brandCloudID == "" {
		http.Error(w, "brand cloud id is required", http.StatusBadRequest)
		return
	}
	var body accountclient.BrandCloudMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid brand cloud member request", http.StatusBadRequest)
		return
	}
	body.BrandCloudUserID = strings.TrimSpace(body.BrandCloudUserID)
	body.Role = strings.TrimSpace(body.Role)
	if body.BrandCloudUserID == "" {
		http.Error(w, "brand_cloud_user_id is required", http.StatusBadRequest)
		return
	}
	member, err := s.accountClient.AssignBrandCloudMember(r.Context(), session.AccessToken, brandCloudID, body)
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.member.assign", brandCloudID, "", "accepted")
	writeJSONStatus(w, http.StatusCreated, map[string]accountclient.Member{"member": member})
}

func (s *Server) apiAdminBrandCloudUser(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	brandCloudID := strings.TrimSpace(r.PathValue("brandCloudId"))
	if brandCloudID == "" {
		http.Error(w, "brand cloud id is required", http.StatusBadRequest)
		return
	}
	var body accountclient.BrandCloudUserRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid brand cloud user request", http.StatusBadRequest)
		return
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	body.DisplayName = strings.TrimSpace(body.DisplayName)
	body.Role = strings.TrimSpace(body.Role)
	result, status, err := s.accountClient.CreateBrandCloudUser(r.Context(), session.AccessToken, brandCloudID, body)
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	if status != http.StatusCreated {
		status = http.StatusOK
	}
	s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.user.create_or_reactivate", brandCloudID, "", "accepted")
	writeJSONStatus(w, status, result)
}

func (s *Server) apiAdminBrandCloudUsers(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	brandCloudID := strings.TrimSpace(r.PathValue("brandCloudId"))
	if brandCloudID == "" {
		http.Error(w, "brand cloud id is required", http.StatusBadRequest)
		return
	}
	users, err := s.accountClient.BrandCloudUsers(r.Context(), session.AccessToken, brandCloudID, r.URL.Query())
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	writeJSON(w, map[string][]accountclient.BrandCloudUser{"brand_cloud_users": users})
}

func (s *Server) apiAdminBrandCloudUserAction(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	brandCloudID := strings.TrimSpace(r.PathValue("brandCloudId"))
	brandCloudUserID := strings.TrimSpace(r.PathValue("brandCloudUserId"))
	if brandCloudID == "" || brandCloudUserID == "" {
		http.Error(w, "brand cloud id and user id are required", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodDelete {
		if err := s.accountClient.DeleteBrandCloudUser(r.Context(), session.AccessToken, brandCloudID, brandCloudUserID); err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.user.delete", brandCloudID, brandCloudUserID, "accepted")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	action := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/admin/brand-clouds/"+brandCloudID+"/users/"+brandCloudUserID), "/")
	var (
		user accountclient.BrandCloudUser
		err  error
	)
	switch action {
	case "disable":
		user, err = s.accountClient.DisableBrandCloudUser(r.Context(), session.AccessToken, brandCloudID, brandCloudUserID)
	case "enable":
		user, err = s.accountClient.EnableBrandCloudUser(r.Context(), session.AccessToken, brandCloudID, brandCloudUserID)
	case "approve":
		user, err = s.accountClient.ApproveBrandCloudUser(r.Context(), session.AccessToken, brandCloudID, brandCloudUserID)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.user."+action, brandCloudID, brandCloudUserID, "accepted")
	writeJSON(w, map[string]accountclient.BrandCloudUser{"brand_cloud_user": user})
}

func (s *Server) apiAdminSSOProvider(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "Account Manager is not configured for SSO provider settings", http.StatusServiceUnavailable)
		return
	}
	orgID := strings.TrimSpace(r.PathValue("orgId"))
	if orgID == "" {
		http.Error(w, "organization id is required", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodGet {
		provider, err := s.accountClient.SSOProviderStatus(r.Context(), session.AccessToken, orgID)
		if err != nil {
			writeSSOError(w, err)
			return
		}
		writeJSON(w, map[string]accountclient.SSOProviderStatus{"provider": provider})
		return
	}

	var body accountclient.SSOProviderConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid SSO provider configuration", http.StatusBadRequest)
		return
	}
	body.Issuer = strings.TrimSpace(body.Issuer)
	body.ClientID = strings.TrimSpace(body.ClientID)
	body.ClientSecret = strings.TrimSpace(body.ClientSecret)
	body.VerifiedDomains = normalizeDomains(body.VerifiedDomains)
	provider, err := s.accountClient.UpsertSSOProvider(r.Context(), session.AccessToken, orgID, body)
	if err != nil {
		writeSSOError(w, err)
		return
	}
	writeJSON(w, map[string]accountclient.SSOProviderStatus{"provider": provider})
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
	ops, err := s.projections.ListOperations()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ops)
}

func (s *Server) apiAdminOperations(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if s.usePlatformAdminUpstream(session) {
		ops, err := s.platformAdminOperations(r.Context(), session)
		if err != nil {
			s.writeUpstreamReadErrorForSession(w, session.ID, err)
			return
		}
		writeJSON(w, ops)
		return
	}
	ops, err := s.projections.ListOperations()
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

func (s *Server) apiAdminServiceLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	endpoint := strings.TrimRight(s.cfg.CloudLoggerEndpoint, "/")
	if endpoint == "" || s.cfg.CloudLoggerToken == "" {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "message": "Central service logging is not configured.", "events": []any{}})
		return
	}
	query := url.Values{}
	for _, key := range []string{"since", "until", "limit", "order", "event_id", "service", "host", "unit", "level", "source", "trace_id", "request_id", "operation_id", "device_id", "org_id", "user_id", "component", "error_category", "actor_id", "actor_type", "outcome", "status_code", "status_class"} {
		if value := strings.TrimSpace(r.URL.Query().Get(key)); value != "" {
			query.Set(key, value)
		}
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint+"/v1/logs?"+query.Encode(), nil)
	if err != nil {
		writeError(w, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.CloudLoggerToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "message": "Central service logging is unavailable.", "events": []any{}})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "message": "Central service logging is unavailable.", "events": []any{}})
		return
	}
	var payload struct {
		Events []map[string]any `json:"events"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "message": "Central service logging response was invalid.", "events": []any{}})
		return
	}
	writeJSON(w, map[string]any{"status": "ok", "events": redactServiceLogEvents(payload.Events)})
}

func redactServiceLogEvents(events []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(events))
	for _, event := range events {
		clean := map[string]any{}
		for key, value := range event {
			if adminSensitiveLogKey(key) {
				clean[key] = "REDACTED"
			} else if fields, ok := value.(map[string]any); ok {
				clean[key] = redactServiceLogFields(fields)
			} else {
				clean[key] = value
			}
		}
		out = append(out, clean)
	}
	return out
}

func redactServiceLogFields(fields map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range fields {
		if adminSensitiveLogKey(key) {
			out[key] = "REDACTED"
		} else {
			out[key] = value
		}
	}
	return out
}

func adminSensitiveLogKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	for _, item := range []string{"token", "password", "secret", "credential", "private_key", "access_key", "authorization", "cookie"} {
		if strings.Contains(normalized, item) {
			return true
		}
	}
	return false
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
	events, err := s.audit.ListAuditEvents()
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
	events, err := s.audit.ListAuditEvents()
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

func (s *Server) requireUpstreamPlatformAdmin(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return store.Session{}, false
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "Account Manager is not configured for platform administration", http.StatusServiceUnavailable)
		return store.Session{}, false
	}
	if strings.TrimSpace(session.AccessToken) == "" {
		http.Error(w, "Account Manager-backed platform admin session required", http.StatusForbidden)
		return store.Session{}, false
	}
	return session, true
}

func (s *Server) customerSession(r *http.Request) (store.Session, bool) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
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
	if !s.accountClient.Enabled() {
		orgID, err := s.demoActiveCustomerOrgID(session)
		if err != nil {
			return nil, err
		}
		devices, err := s.projections.ListDevices()
		if err != nil {
			return nil, err
		}
		out := make([]contracts.Device, 0, len(devices))
		for _, device := range devices {
			if device.OrganizationID == orgID {
				out = append(out, device)
			}
		}
		return out, nil
	}
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
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	vcFacts, err := s.videoCloudFacts(ctx, devices)
	if err != nil {
		return nil, err
	}
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
	ops, err := s.projections.ListOperations()
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

func (s *Server) customerStreamDevices(ctx context.Context, session store.Session, orgID string) ([]contracts.Device, error) {
	if !s.accountClient.Enabled() {
		allDevices, err := s.projections.ListDevices()
		if err != nil {
			return nil, err
		}
		return filterDevicesByOrg(allDevices, orgID), nil
	}
	org, tokens, err := s.activeCustomerOrg(ctx, session)
	if err != nil {
		return nil, err
	}
	var upstreamDevices []accountclient.Device
	tokens, err = s.customerCall(ctx, tokens, func(token string) error {
		var callErr error
		upstreamDevices, callErr = s.accountClient.Devices(ctx, token, org.ID)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	devices := make([]contracts.Device, 0, len(upstreamDevices))
	for _, device := range upstreamDevices {
		devices = append(devices, mapUpstreamDevice(org, device, nil))
	}
	return devices, nil
}

func (s *Server) usePlatformAdminUpstream(session store.Session) bool {
	return s.accountClient.Enabled() && strings.TrimSpace(session.AccessToken) != ""
}

func (s *Server) platformAdminSummary(ctx context.Context, session store.Session) (contracts.Summary, error) {
	devices, err := s.platformAdminDevices(ctx, session)
	if err != nil {
		return contracts.Summary{}, err
	}
	ops, err := s.platformAdminOperations(ctx, session)
	if err != nil {
		return contracts.Summary{}, err
	}
	return summaryFromReadModels(devices, ops), nil
}

func (s *Server) platformAdminCustomers(ctx context.Context, session store.Session) ([]contracts.CustomerSummary, error) {
	devices, err := s.platformAdminDevices(ctx, session)
	if err != nil {
		return nil, err
	}
	return customerSummariesFromDevices(devices), nil
}

func (s *Server) platformAdminDevices(ctx context.Context, session store.Session) ([]contracts.Device, error) {
	orgs, err := s.accountClient.AdminOrganizations(ctx, session.AccessToken)
	if err != nil {
		if isOptionalAccountManagerAdminInventoryMissing(err) {
			return s.projections.ListDevices()
		}
		return nil, err
	}
	upstreamDevices, err := s.accountClient.AdminDevices(ctx, session.AccessToken)
	if err != nil {
		if isOptionalAccountManagerAdminInventoryMissing(err) {
			return s.projections.ListDevices()
		}
		return nil, err
	}
	vcFacts, err := s.videoCloudFacts(ctx, upstreamDevices)
	if err != nil {
		return nil, err
	}
	orgByID := make(map[string]accountclient.Organization, len(orgs))
	for _, org := range orgs {
		orgByID[org.ID] = org
	}
	devices := make([]contracts.Device, 0, len(upstreamDevices))
	for _, device := range upstreamDevices {
		org := orgByID[device.OrganizationID]
		if org.ID == "" {
			org = accountclient.Organization{ID: device.OrganizationID, Name: device.Organization}
		}
		vid := fallback(device.VideoCloudDevID, metadataString(device.Metadata, "video_cloud_devid", ""))
		devices = append(devices, mapUpstreamDevice(org, device, vcFacts[vid]))
	}
	return devices, nil
}

func (s *Server) platformAdminOperations(ctx context.Context, session store.Session) ([]contracts.Operation, error) {
	upstreamOps, err := s.accountClient.AdminOperations(ctx, session.AccessToken)
	if err != nil {
		if isOptionalAccountManagerAdminInventoryMissing(err) {
			return s.projections.ListOperations()
		}
		return nil, err
	}
	ops := make([]contracts.Operation, 0, len(upstreamOps))
	for _, op := range upstreamOps {
		state := mapOperationState(op.State)
		ops = append(ops, contracts.Operation{
			ID:                  op.ID,
			DeviceID:            op.DeviceID,
			DeviceName:          op.DeviceName,
			Organization:        fallback(op.Organization, op.OrganizationID),
			Type:                fallback(op.Type, "DeviceProvisionRequested"),
			State:               state,
			UpstreamOperationID: fallback(op.UpstreamOperationID, op.ID),
			UpstreamState:       fallback(op.UpstreamState, op.State),
			Message:             op.Message,
			UpdatedAt:           op.UpdatedAt,
		})
	}
	return ops, nil
}

func isOptionalAccountManagerAdminInventoryMissing(err error) bool {
	var httpErr *accountclient.HTTPError
	return errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound
}

func summaryFromReadModels(devices []contracts.Device, ops []contracts.Operation) contracts.Summary {
	seenOrgs := map[string]bool{}
	summary := contracts.Summary{TotalDevices: len(devices)}
	for _, device := range devices {
		seenOrgs[device.OrganizationID] = true
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
	for _, op := range ops {
		if op.State != contracts.OperationSucceeded {
			summary.OpenOperations++
		}
	}
	summary.Customers = len(seenOrgs)
	return summary
}

func customerSummariesFromDevices(devices []contracts.Device) []contracts.CustomerSummary {
	byOrg := map[string]*contracts.CustomerSummary{}
	order := []string{}
	for _, device := range devices {
		customer, ok := byOrg[device.OrganizationID]
		if !ok {
			customer = &contracts.CustomerSummary{
				OrganizationID: device.OrganizationID,
				Organization:   device.Organization,
			}
			byOrg[device.OrganizationID] = customer
			order = append(order, device.OrganizationID)
		}
		customer.TotalDevices++
		switch device.Readiness {
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
		if device.LastSeenAt > customer.LastSeenAt {
			customer.LastSeenAt = device.LastSeenAt
		}
	}
	customers := make([]contracts.CustomerSummary, 0, len(order))
	for _, orgID := range order {
		customers = append(customers, *byOrg[orgID])
	}
	return customers
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
	events, err := s.audit.ListAuditEvents()
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
	if !s.accountClient.Enabled() {
		memberships, err := s.demoMemberships()
		if err != nil {
			return accountclient.Organization{}, tokens, err
		}
		if session.ActiveOrgID != "" {
			for _, membership := range memberships {
				if membership.OrganizationID == session.ActiveOrgID {
					return accountclient.Organization{
						ID:                    membership.OrganizationID,
						Name:                  membership.Organization,
						Role:                  membership.Role,
						Tier:                  membership.Tier,
						EvaluationDeviceQuota: membership.EvaluationDeviceQuota,
					}, tokens, nil
				}
			}
			return accountclient.Organization{}, tokens, errCustomerActiveOrgInvalid
		}
		if len(memberships) > 0 {
			membership := memberships[0]
			return accountclient.Organization{
				ID:                    membership.OrganizationID,
				Name:                  membership.Organization,
				Role:                  membership.Role,
				Tier:                  membership.Tier,
				EvaluationDeviceQuota: membership.EvaluationDeviceQuota,
			}, tokens, nil
		}
		return accountclient.Organization{}, tokens, fmt.Errorf("no accessible organizations available")
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
		_ = s.sessions.UpdateSessionTokens(session.ID, nextTokens.AccessToken, nextTokens.RefreshToken, tokenTTL(nextTokens))
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
	op, err := s.lifecycleOperations.CreateLifecycleOperation(r.PathValue("id"), "DeviceProvisionRequested")
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
	op, err := s.lifecycleOperations.CreateLifecycleOperation(r.PathValue("id"), "DeviceDeactivateRequested")
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
	session, err := s.sessions.GetSession(cookie.Value)
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
	_ = s.sessions.DeleteSession(sessionID)
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

func isAccessDeniedHTTPError(err error) bool {
	var httpErr *accountclient.HTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	return httpErr.StatusCode == http.StatusUnauthorized || httpErr.StatusCode == http.StatusForbidden
}

func (s *Server) writeAuthProxyError(w http.ResponseWriter, err error) {
	var httpErr *accountclient.HTTPError
	if errors.As(err, &httpErr) {
		message := strings.TrimSpace(httpErr.Body)
		if message == "" {
			message = http.StatusText(httpErr.StatusCode)
		}
		switch httpErr.StatusCode {
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
			http.Error(w, message, httpErr.StatusCode)
			return
		}
	}
	s.writeCustomerError(w, err)
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
	if errors.Is(err, errVideoCloudRequestFailed) {
		s.logUpstreamError("video_cloud", err)
		http.Error(w, "Video Cloud request failed", http.StatusBadGateway)
		return
	}
	if status, ok := customerUpstreamStatus(err); ok {
		s.logUpstreamError("account_manager", err)
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

func (s *Server) writeUpstreamReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, errVideoCloudRequestFailed) {
		s.writeVideoCloudGatewayError(w, err)
		return
	}
	if status, ok := customerUpstreamStatus(err); ok {
		s.logUpstreamError("account_manager", err)
		switch status {
		case http.StatusUnauthorized:
			http.Error(w, "platform admin upstream session expired; please sign in again", http.StatusUnauthorized)
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

func (s *Server) writeUpstreamReadErrorForSession(w http.ResponseWriter, sessionID string, err error) {
	if status, ok := customerUpstreamStatus(err); ok && status == http.StatusUnauthorized {
		s.invalidateCustomerSession(w, sessionID)
	}
	s.writeUpstreamReadError(w, err)
}

func (s *Server) writeVideoCloudGatewayError(w http.ResponseWriter, err error) {
	s.logUpstreamError("video_cloud", err)
	if isTimeoutError(err) {
		http.Error(w, "Video Cloud request timed out", http.StatusGatewayTimeout)
		return
	}
	if errors.Is(err, errVideoCloudRequestFailed) {
		http.Error(w, "Video Cloud request failed", http.StatusBadGateway)
		return
	}
	writeError(w, err)
}

func isTimeoutError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func (s *Server) auditSSOSession(email, kind, orgID, result string) error {
	return s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:          fallback(email, "unknown-sso-user"),
		ActorKind:      fallback(kind, "sso"),
		Action:         "SSOLogin",
		Target:         fallback(kind, "sso_session"),
		OrganizationID: orgID,
		Result:         result,
	})
}

func (s *Server) auditPlatformBrandCloudAction(r *http.Request, session store.Session, action, organizationID, target, result string) {
	values := correlation.FromContext(r.Context())
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:               fallback(session.Email, session.Subject),
		ActorKind:           fallback(session.Kind, "platform_admin"),
		Action:              action,
		Target:              fallback(target, organizationID),
		OrganizationID:      organizationID,
		Result:              result,
		RequestID:           values.RequestID,
		UpstreamOperationID: values.OperationID,
	})
}

func (s *Server) auditSessionLogout(session store.Session) error {
	return s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:          fallback(session.Email, session.Subject),
		ActorKind:      fallback(session.Kind, "session"),
		Action:         "SessionLogout",
		Target:         fallback(session.Kind, "session"),
		OrganizationID: session.ActiveOrgID,
		Result:         "accepted",
	})
}

func writeSSOError(w http.ResponseWriter, err error) {
	if status, ok := customerUpstreamStatus(err); ok {
		switch status {
		case http.StatusUnauthorized:
			http.Error(w, "SSO callback was rejected by Account Manager", http.StatusUnauthorized)
		case http.StatusForbidden:
			http.Error(w, "SSO provider is disabled or access is denied", http.StatusForbidden)
		case http.StatusGatewayTimeout:
			http.Error(w, "Account Manager SSO request timed out", http.StatusGatewayTimeout)
		default:
			var httpErr *accountclient.HTTPError
			if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
				http.Error(w, "SSO provider was not found for the email domain", http.StatusNotFound)
				return
			}
			http.Error(w, "Account Manager SSO request failed", http.StatusBadGateway)
		}
		return
	}
	writeError(w, err)
}

func normalizeDomains(domains []string) []string {
	seen := map[string]bool{}
	normalized := make([]string, 0, len(domains))
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if domain == "" || seen[domain] {
			continue
		}
		seen[domain] = true
		normalized = append(normalized, domain)
	}
	return normalized
}

func organizationAllowed(orgs []accountclient.Organization, orgID string) bool {
	for _, org := range orgs {
		if org.ID == orgID {
			return true
		}
	}
	return false
}

func organizationRole(orgs []accountclient.Organization, orgID string) (string, bool) {
	for _, org := range orgs {
		if org.ID == orgID {
			return org.Role, true
		}
	}
	return "", false
}

func organizationByID(orgs []accountclient.Organization, orgID string) (accountclient.Organization, bool) {
	for _, org := range orgs {
		if org.ID == orgID {
			return org, true
		}
	}
	return accountclient.Organization{}, false
}

func isReadOnlyCustomerRole(role string) bool {
	normalized := strings.NewReplacer("-", "_", " ", "_").Replace(strings.ToLower(strings.TrimSpace(role)))
	switch normalized {
	case "observer", "viewer", "read_only", "readonly", "read_only_observer":
		return true
	default:
		return false
	}
}

func fleetManagerCapabilities() []string {
	return []string{
		capabilityCustomerDevicesRead,
		capabilityCustomerDevicesProvision,
		capabilityCustomerDevicesDeactivate,
		capabilityCustomerFirmwareRead,
		capabilityCustomerFirmwareManage,
		capabilityCustomerStreamRead,
	}
}

func platformAdminCompatibilityCapabilities() []string {
	return []string{
		"platform.customers.read",
		"platform.devices.read",
		"platform.operations.read",
		capabilityPlatformAuditRead,
		capabilityPlatformSSOManage,
	}
}

func capabilitiesForOrganization(org accountclient.Organization) []string {
	caps := normalizeCapabilities(append(append([]string{}, org.Capabilities...), org.Permissions...))
	if len(caps) > 0 {
		return caps
	}
	if isReadOnlyCustomerRole(org.Role) {
		return []string{
			capabilityCustomerDevicesRead,
			capabilityCustomerFirmwareRead,
			capabilityCustomerStreamRead,
		}
	}
	return fleetManagerCapabilities()
}

func normalizeCapabilities(values []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, value := range values {
		capability := strings.TrimSpace(value)
		if capability == "" || seen[capability] {
			continue
		}
		seen[capability] = true
		out = append(out, capability)
	}
	sort.Strings(out)
	return out
}

func aggregateMembershipCapabilities(memberships []contracts.Membership, activeOrgID string) []string {
	var values []string
	for _, membership := range memberships {
		if activeOrgID != "" && membership.OrganizationID != activeOrgID {
			continue
		}
		values = append(values, membership.Capabilities...)
	}
	if len(values) == 0 && activeOrgID == "" {
		for _, membership := range memberships {
			values = append(values, membership.Capabilities...)
		}
	}
	return normalizeCapabilities(values)
}

func hasCapability(capabilities []string, required string) bool {
	for _, capability := range capabilities {
		if capability == required {
			return true
		}
	}
	return false
}

func (s *Server) demoMemberships() ([]contracts.Membership, error) {
	customers, err := s.projections.ListCustomers()
	if err != nil {
		return nil, err
	}
	memberships := make([]contracts.Membership, 0, len(customers))
	for _, customer := range customers {
		membership := contracts.Membership{
			OrganizationID: customer.OrganizationID,
			Organization:   customer.Organization,
			Role:           "operator",
			Tier:           "commercial",
			Capabilities:   fleetManagerCapabilities(),
		}
		if customer.OrganizationID == "org-acme" {
			membership.Role = "owner"
			membership.Tier = "evaluation"
			membership.EvaluationDeviceQuota = 5
		}
		memberships = append(memberships, membership)
	}
	return memberships, nil
}

func (s *Server) demoOrganizationAllowed(orgID string) (bool, error) {
	memberships, err := s.demoMemberships()
	if err != nil {
		return false, err
	}
	for _, membership := range memberships {
		if membership.OrganizationID == orgID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) demoActiveCustomerOrgID(session store.Session) (string, error) {
	if session.ActiveOrgID != "" {
		allowed, err := s.demoOrganizationAllowed(session.ActiveOrgID)
		if err != nil {
			return "", err
		}
		if !allowed {
			return "", errCustomerActiveOrgInvalid
		}
		return session.ActiveOrgID, nil
	}
	memberships, err := s.demoMemberships()
	if err != nil {
		return "", err
	}
	if len(memberships) == 0 {
		return "", fmt.Errorf("no accessible organizations available")
	}
	return memberships[0].OrganizationID, nil
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
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
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
			_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
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
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
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
			_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
		}
		vcFacts, err := s.videoCloudFacts(r.Context(), devices)
		if err != nil {
			if errors.Is(err, errVideoCloudRequestFailed) {
				s.writeCustomerError(w, err)
				return nil, true
			}
			writeError(w, err)
			return nil, true
		}
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
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
	}
	org, ok := organizationByID(orgs, session.ActiveOrgID)
	if !ok {
		http.Error(w, "active organization is not part of the current customer memberships", http.StatusForbidden)
		return true
	}
	requiredCapability := capabilityCustomerDevicesProvision
	if action == "deactivate" {
		requiredCapability = capabilityCustomerDevicesDeactivate
	}
	if !hasCapability(capabilitiesForOrganization(org), requiredCapability) {
		http.Error(w, "missing required capability: "+requiredCapability, http.StatusForbidden)
		return true
	}
	deviceID := r.PathValue("id")
	operationType := "DeviceProvisionRequested"
	if action == "deactivate" {
		operationType = "DeviceDeactivateRequested"
	}
	if existing, ok, err := s.lifecycleOperations.GetOpenLifecycleOperation(deviceID, operationType); err == nil && ok {
		_ = s.audit.CreateAuditEvent(session.Email, operationType+".idempotent", deviceID)
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
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
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
		if _, createErr := s.lifecycleOperations.CreateFailedUpstreamLifecycleOperation(deviceID, operationType, session.Email, err.Error()); createErr != nil {
			_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
				Actor:          session.Email,
				ActorKind:      session.Kind,
				Action:         operationType + ".failed",
				Target:         deviceID,
				OrganizationID: session.ActiveOrgID,
				Result:         "failed",
			})
		}
		_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
			Actor:          session.Email,
			ActorKind:      session.Kind,
			Action:         operationType + ".failed",
			Target:         deviceID,
			OrganizationID: session.ActiveOrgID,
			Result:         "failed",
		})
		if strings.Contains(err.Error(), "returned 409") {
			if existing, ok, lookupErr := s.lifecycleOperations.GetOpenLifecycleOperation(deviceID, operationType); lookupErr == nil && ok {
				_ = s.audit.CreateAuditEvent(session.Email, operationType+".idempotent", deviceID)
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
	recorded, err := s.lifecycleOperations.CreateUpstreamLifecycleOperation(deviceID, operationType, session.Email, upstreamID, string(operationState), upstreamMessage)
	if err != nil {
		writeError(w, err)
		return true
	}
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{
		Actor:               session.Email,
		ActorKind:           session.Kind,
		Action:              operationType + ".completed",
		Target:              deviceID,
		OrganizationID:      session.ActiveOrgID,
		Result:              "accepted",
		UpstreamOperationID: recorded.UpstreamOperationID,
	})
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		_ = s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens))
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
	latestOp := upstreamOperationFromMetadata(device, updatedAt)
	readiness = authoritativeReadiness(readiness, videoID, latestOp, vcFacts)
	mapped := contracts.Device{
		ID:              device.ID,
		OrganizationID:  fallback(device.OrganizationID, org.ID),
		SKU:             device.DeviceItemProfileID,
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
	mapped.SourceFacts = readinessfacts.Build(mapped, latestOp, vcFacts)
	return mapped
}

func authoritativeReadiness(readiness contracts.ReadinessState, videoID string, latestOp *contracts.Operation, vcFacts *readinessfacts.VideoCloudFacts) contracts.ReadinessState {
	switch readiness {
	case contracts.ReadinessFailed, contracts.ReadinessDeactivationPending, contracts.ReadinessDeactivated:
		return readiness
	case contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending:
		return readiness
	}
	if latestOp != nil {
		switch latestOp.State {
		case contracts.OperationPending, contracts.OperationPublished, contracts.OperationRetrying:
			return contracts.ReadinessCloudActivationPending
		case contracts.OperationFailed, contracts.OperationDeadLettered:
			return contracts.ReadinessFailed
		}
	}
	if vcFacts == nil {
		return readiness
	}
	if videoID == "" {
		if readiness == contracts.ReadinessActivated || readiness == contracts.ReadinessOnline {
			return contracts.ReadinessRegistered
		}
		return readiness
	}
	if !vcFacts.Activated {
		return contracts.ReadinessCloudActivationPending
	}
	if vcFacts.Transport == "" {
		return contracts.ReadinessActivated
	}
	return contracts.ReadinessOnline
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
		Capabilities:          capabilitiesForOrganization(org),
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

var errVideoCloudRequestFailed = errors.New("Video Cloud request failed")

// videoCloudFacts queries Video Cloud for activation and transport facts for a
// batch of Account Manager devices. Returns a map keyed by VideoCloudDevID.
// Non-nil facts are only present for devices that have a VideoCloudDevID.
// If activation lookup fails, the error is surfaced so production mode does not
// silently fall back to local inference when upstream truth is configured.
func (s *Server) videoCloudFacts(ctx context.Context, devices []accountclient.Device) (map[string]*readinessfacts.VideoCloudFacts, error) {
	if !s.videoClient.Enabled() || s.cfg.VideoCloudAdminToken == "" {
		return nil, nil
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
		return nil, nil
	}

	qCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	activated, err := s.videoClient.QueryActivation(qCtx, s.cfg.VideoCloudAdminToken, vcIDs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errVideoCloudRequestFailed, err)
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
	return out, nil
}

func paginationFromQuery(query url.Values, defaultLimit, maxLimit int) (int, int) {
	limit := defaultLimit
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	offset := 0
	if raw := strings.TrimSpace(query.Get("offset")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			offset = parsed
		}
	}
	return limit, offset
}

func filterBrandCloudsForList(brands []accountclient.BrandCloud, query url.Values) []accountclient.BrandCloud {
	search := strings.ToLower(strings.TrimSpace(firstNonEmpty(query.Get("q"), query.Get("query"), query.Get("search"))))
	status := strings.ToLower(strings.TrimSpace(query.Get("status")))
	tier := strings.ToLower(strings.TrimSpace(query.Get("tier")))
	if status == "all" {
		status = ""
	}
	if tier == "all" {
		tier = ""
	}
	out := make([]accountclient.BrandCloud, 0, len(brands))
	for _, brand := range brands {
		if search != "" && !brandCloudMatchesSearch(brand, search) {
			continue
		}
		if status != "" && brandCloudStatusKey(brand) != status {
			continue
		}
		if tier != "" && strings.ToLower(brandCloudTier(brand)) != tier {
			continue
		}
		out = append(out, brand)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func brandCloudMatchesSearch(brand accountclient.BrandCloud, search string) bool {
	candidates := []string{
		brand.ID,
		brand.Name,
		metadataString(brand.Metadata, "brandname", ""),
		metadataString(brand.Metadata, "tenant_slug", ""),
		metadataString(brand.Metadata, "owner_email", ""),
		metadataString(brand.Metadata, "admin_email", ""),
		metadataString(brand.Metadata, "primary_admin_email", ""),
	}
	for _, candidate := range candidates {
		if strings.Contains(strings.ToLower(candidate), search) {
			return true
		}
	}
	return false
}

func brandCloudStatusKey(brand accountclient.BrandCloud) string {
	raw := strings.ToLower(strings.TrimSpace(firstNonEmpty(brand.Status, metadataString(brand.Metadata, "status", ""))))
	switch raw {
	case "active", "enabled", "ready":
		return "active"
	case "disabled", "inactive", "suspended":
		return "disabled"
	case "pending", "pending_verification", "setup_required", "setup-required":
		return "setup_required"
	case "error", "failed":
		return "error"
	default:
		if raw == "" {
			return "setup_required"
		}
		return raw
	}
}

func brandCloudTier(brand accountclient.BrandCloud) string {
	return firstNonEmpty(brand.Tier, metadataString(brand.Metadata, "tier", ""), metadataString(brand.Metadata, "commercial_tier", ""), "Evaluation")
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
