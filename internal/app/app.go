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
	"strings"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
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
	s.mux.HandleFunc("GET /api/me", s.apiMe)
	s.mux.HandleFunc("POST /api/me/active-org", s.apiActiveOrg)
	s.mux.HandleFunc("POST /api/auth/customer/login", s.apiCustomerLogin)
	s.mux.HandleFunc("POST /api/auth/platform/login", s.apiPlatformLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.apiLogout)
	s.mux.HandleFunc("GET /api/customers", s.apiCustomers)
	s.mux.HandleFunc("GET /api/devices", s.apiDevices)
	s.mux.HandleFunc("GET /api/devices/{id}", s.apiDevice)
	s.mux.HandleFunc("GET /api/operations", s.apiOperations)
	s.mux.HandleFunc("GET /api/service-health", s.apiServiceHealth)
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

func (s *Server) apiSummary(w http.ResponseWriter, _ *http.Request) {
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
		upstream, err := s.accountClient.Me(r.Context(), session.AccessToken)
		if err == nil {
			me.UserID = upstream.User.ID
			me.Email = upstream.User.Email
			me.Name = fallback(upstream.User.Name, upstream.User.Email)
			for _, org := range upstream.Organizations {
				me.Memberships = append(me.Memberships, contracts.Membership{OrganizationID: org.ID, Organization: org.Name, Role: org.Role})
			}
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
	var body struct {
		OrganizationID string `json:"organization_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OrganizationID == "" {
		http.Error(w, "organization_id is required", http.StatusBadRequest)
		return
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
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	me, _ := s.accountClient.Me(r.Context(), login.Tokens.AccessToken)
	activeOrgID := ""
	if len(me.Organizations) > 0 {
		activeOrgID = me.Organizations[0].ID
	}
	session, err := s.store.CreateSession("customer", login.User.ID, login.User.Email, login.Tokens.AccessToken, login.Tokens.RefreshToken, activeOrgID, tokenTTL(login.Tokens))
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
	if devices, ok := s.upstreamDevices(w, r); ok {
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

func (s *Server) apiDevice(w http.ResponseWriter, r *http.Request) {
	if devices, ok := s.upstreamDevices(w, r); ok {
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

func (s *Server) apiCustomers(w http.ResponseWriter, r *http.Request) {
	if customers, ok := s.upstreamCustomers(w, r); ok {
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

func (s *Server) apiOperations(w http.ResponseWriter, _ *http.Request) {
	ops, err := s.store.ListOperations()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ops)
}

func (s *Server) apiServiceHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, []contracts.ServiceHealth{
		s.upstreamHealth(r.Context(), "Account Manager", s.cfg.AccountManagerBaseURL, func(ctx context.Context) error {
			if !s.accountClient.Enabled() {
				return nil
			}
			return s.accountClient.Health(ctx)
		}),
		s.upstreamHealth(r.Context(), "Video Cloud", s.cfg.VideoCloudBaseURL, func(ctx context.Context) error {
			if !s.videoClient.Enabled() {
				return nil
			}
			return s.videoClient.Health(ctx)
		}),
		{Name: "SQLite", Status: "ok", Detail: "Local console cache is available.", LastCheckedAt: time.Now().UTC().Format(time.RFC3339)},
	})
}

func (s *Server) apiAudit(w http.ResponseWriter, _ *http.Request) {
	events, err := s.store.ListAuditEvents()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, events)
}

func (s *Server) apiAdminAudit(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "platform_admin" {
		http.Error(w, "platform admin authentication required", http.StatusUnauthorized)
		return
	}
	s.apiAudit(w, r)
}

func (s *Server) apiProvisionDevice(w http.ResponseWriter, r *http.Request) {
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

func (s *Server) upstreamCustomers(w http.ResponseWriter, r *http.Request) ([]contracts.CustomerSummary, bool) {
	session, ok := s.requestSession(r)
	if !ok || !s.accountClient.Enabled() || session.Kind != "customer" {
		return nil, false
	}
	orgs, err := s.accountClient.Organizations(r.Context(), session.AccessToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return nil, true
	}
	customers := make([]contracts.CustomerSummary, 0, len(orgs))
	for _, org := range orgs {
		customer := contracts.CustomerSummary{
			OrganizationID: org.ID,
			Organization:   org.Name,
		}
		devices, err := s.accountClient.Devices(r.Context(), session.AccessToken, org.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return nil, true
		}
		for _, device := range devices {
			mapped := mapUpstreamDevice(org, device)
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
	orgs, err := s.accountClient.Organizations(r.Context(), session.AccessToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return nil, true
	}
	var out []contracts.Device
	for _, org := range orgs {
		devices, err := s.accountClient.Devices(r.Context(), session.AccessToken, org.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return nil, true
		}
		for _, device := range devices {
			out = append(out, mapUpstreamDevice(org, device))
		}
	}
	return out, true
}

func (s *Server) tryUpstreamLifecycle(w http.ResponseWriter, r *http.Request, action string) bool {
	session, ok := s.requestSession(r)
	if !ok || !s.accountClient.Enabled() || session.Kind != "customer" || session.ActiveOrgID == "" {
		return false
	}
	deviceID := r.PathValue("id")
	operationType := "DeviceProvisionRequested"
	var op accountclient.Operation
	var err error
	if action == "deactivate" {
		operationType = "DeviceDeactivateRequested"
		op, err = s.accountClient.Deactivate(r.Context(), session.AccessToken, session.ActiveOrgID, deviceID)
	} else {
		op, err = s.accountClient.Provision(r.Context(), session.AccessToken, session.ActiveOrgID, deviceID)
	}
	_ = s.store.CreateAuditEvent(session.Email, operationType+".attempted", deviceID)
	if err != nil {
		_ = s.store.CreateAuditEvent(session.Email, operationType+".failed", deviceID)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return true
	}
	_ = s.store.CreateAuditEvent(session.Email, operationType+".completed", deviceID)
	writeJSON(w, contracts.Operation{
		ID:        fallback(op.ID, fmt.Sprintf("op-%d", time.Now().UTC().UnixNano())),
		DeviceID:  deviceID,
		Type:      operationType,
		State:     mapOperationState(op.State),
		Message:   fallback(op.Message, "Accepted by Account Manager."),
		UpdatedAt: fallback(op.UpdatedAt, time.Now().UTC().Format(time.RFC3339)),
	})
	return true
}

func mapUpstreamDevice(org accountclient.Organization, device accountclient.Device) contracts.Device {
	now := time.Now().UTC().Format(time.RFC3339)
	readiness := contracts.ReadinessState(fallback(device.Readiness, metadataString(device.Metadata, "readiness", string(contracts.ReadinessRegistered))))
	status := fallback(device.Status, metadataString(device.Metadata, "status", "unknown"))
	videoID := fallback(device.VideoCloudDevID, metadataString(device.Metadata, "video_cloud_devid", ""))
	updatedAt := fallback(device.UpdatedAt, now)
	return contracts.Device{
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
		SourceFacts: []contracts.SourceFact{
			{Layer: "account_registry", State: "present", Detail: "Device returned by Account Manager.", UpdatedAt: updatedAt},
			{Layer: "cloud_activation", State: status, Detail: sourceFactDetail(videoID), UpdatedAt: updatedAt},
		},
	}
}

func sourceFactDetail(videoID string) string {
	if videoID == "" {
		return "Missing video_cloud_devid from Account Manager metadata."
	}
	return "Video Cloud device identity is present."
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
