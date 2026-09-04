package app

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var testLabDeviceID = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,128}$`)

// Context is intentionally separate from runtime credential issuance. A readable
// registry record is not authority to mint an app credential or start playback.
func (s *Server) apiTestLabContext(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "account" && session.Kind != "customer") {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.cfg.TestLabEnabled || s.cfg.Environment == "production" || s.cfg.Environment == "prod" {
		http.NotFound(w, r)
		return
	}
	cloud := r.PathValue("brandCloudID")
	query := r.URL.Query()
	product, device := query.Get("product_id"), query.Get("device_id")
	account := query.Get("account_id")
	if !managedCloudUUID.MatchString(cloud) || !managedCloudUUID.MatchString(product) || !managedCloudUUID.MatchString(device) || len(query) > 3 || len(query["product_id"]) != 1 || len(query["device_id"]) != 1 || len(query["account_id"]) > 1 || (account != "" && !managedCloudUUID.MatchString(account)) {
		http.Error(w, "explicit cloud, product and device required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	access, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, "GET", cloud, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if access.BrandCloud.ID != cloud || !hasCapability(access.BrandCloud.Capabilities, "product.read") {
		http.Error(w, "cloud access forbidden", http.StatusForbidden)
		return
	}
	p, err := s.accountClient.DeviceItemProfile(ctx, session.AccessToken, cloud, product)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	d, err := s.accountClient.Device(ctx, session.AccessToken, cloud, device)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if p.ID != product || p.BrandCloudID != cloud || d.ID != device || d.OrganizationID != cloud || d.DeviceItemProfileID != product {
		http.NotFound(w, r)
		return
	}
	devid := strings.TrimSpace(d.VideoCloudDevID)
	if value, ok := d.Metadata["video_cloud_devid"].(string); ok {
		value = strings.TrimSpace(value)
		if devid != "" && value != "" && devid != value {
			http.Error(w, "conflicting device mapping", http.StatusBadGateway)
			return
		}
		if devid == "" {
			devid = value
		}
	}
	if !testLabDeviceID.MatchString(devid) {
		devid = ""
	}
	services := map[string]bool{}
	for _, service := range p.ServiceOptions {
		services[service] = true
	}
	reason := ""
	if s.cfg.VideoCloudBaseURL == "" {
		reason = "runtime_authorization_unavailable"
	}
	if access.BrandCloud.MyRole == "viewer" {
		reason = "read_only_role"
	}
	if devid == "" {
		reason = "device_mapping_missing"
	}
	if d.Status == "disabled" {
		reason = "device_disabled"
	}
	if account == "" {
		reason = "test_account_required"
	} else if ready, err := s.labBindingReady(ctx, session.AccessToken, cloud, product, account, device); err != nil {
		reason = "binding_required"
	} else if !ready {
		reason = "provision_required"
	}
	// Session creation independently verifies runtime availability and authority.
	writeJSON(w, map[string]any{
		"environment": s.cfg.Environment, "brand_cloud_id": cloud, "product_id": product,
		"device_id": device, "devid": devid, "device_status": d.Status,
		"account_id":    account,
		"runtime_ready": reason == "", "blocked_reason": reason,
		// Shadow is part of MQTT device integration, not a separate Product service.
		"capabilities": map[string]bool{"mqtt": services["mqtt"], "shadow_http": services["mqtt"], "shadow_mqtt": services["mqtt"], "webrtc": services["video_streaming"]},
	})
}
