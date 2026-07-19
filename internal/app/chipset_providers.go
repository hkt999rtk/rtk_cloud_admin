package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/store"
)

const (
	capabilityChipsetProviderRead    = "platform.chipset_sdk.read"
	capabilityChipsetProviderEdit    = "platform.chipset_sdk.edit"
	capabilityChipsetProviderPublish = "platform.chipset_sdk.publish"
)

func (s *Server) apiAdminChipsetProviders(w http.ResponseWriter, r *http.Request) {
	required := capabilityChipsetProviderRead
	if r.Method == http.MethodPost {
		required = capabilityChipsetProviderEdit
	}
	session, effectiveCapabilities, ok := s.requirePlatformCapability(w, r, required)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		providers, err := s.accountClient.ChipsetProviders(r.Context(), session.AccessToken)
		if err != nil {
			writeChipsetProviderError(w, err)
			return
		}
		writeJSON(w, map[string]any{"providers": providers, "capabilities": effectiveCapabilities, "source_status": "available"})
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		http.Error(w, "Idempotency-Key header is required", http.StatusBadRequest)
		return
	}
	var request accountclient.ChipsetProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid provider request", http.StatusBadRequest)
		return
	}
	provider, auditResult, err := s.accountClient.CreateChipsetProvider(r.Context(), session.AccessToken, key, request)
	if err != nil {
		writeChipsetProviderError(w, err)
		return
	}
	writeJSONStatus(w, http.StatusCreated, map[string]any{"provider": provider, "audit_result": auditResult, "source_status": "available"})
}

func (s *Server) apiAdminChipsetProvider(w http.ResponseWriter, r *http.Request) {
	required := capabilityChipsetProviderRead
	if r.Method == http.MethodPatch {
		required = capabilityChipsetProviderEdit
	}
	session, _, ok := s.requirePlatformCapability(w, r, required)
	if !ok {
		return
	}
	providerID := r.PathValue("providerId")
	if r.Method == http.MethodGet {
		provider, chipsets, err := s.accountClient.ChipsetProvider(r.Context(), session.AccessToken, providerID)
		if err != nil {
			writeChipsetProviderError(w, err)
			return
		}
		writeJSON(w, map[string]any{"provider": provider, "chipsets": chipsets, "source_status": "available"})
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		http.Error(w, "Idempotency-Key header is required", http.StatusBadRequest)
		return
	}
	var request accountclient.ChipsetProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid provider request", http.StatusBadRequest)
		return
	}
	provider, auditResult, err := s.accountClient.UpdateChipsetProvider(r.Context(), session.AccessToken, providerID, key, request)
	if err != nil {
		writeChipsetProviderError(w, err)
		return
	}
	writeJSON(w, map[string]any{"provider": provider, "audit_result": auditResult, "source_status": "available"})
}

func (s *Server) apiAdminChipsetProviderAction(w http.ResponseWriter, r *http.Request) {
	session, _, ok := s.requirePlatformCapability(w, r, capabilityChipsetProviderPublish)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		http.Error(w, "Idempotency-Key header is required", http.StatusBadRequest)
		return
	}
	action := r.PathValue("action")
	if action != "publish" && action != "unpublish" && action != "refresh" {
		http.Error(w, "invalid provider action", http.StatusBadRequest)
		return
	}
	provider, auditResult, err := s.accountClient.ActOnChipsetProvider(r.Context(), session.AccessToken, r.PathValue("providerId"), action, key)
	if err != nil {
		writeChipsetProviderError(w, err)
		return
	}
	writeJSON(w, map[string]any{"provider": provider, "audit_result": auditResult, "source_status": "available"})
}

func (s *Server) apiDeveloperChipsets(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() || strings.TrimSpace(session.AccessToken) == "" {
		http.Error(w, "Account Manager is not configured", http.StatusServiceUnavailable)
		return
	}
	chipsets, err := s.accountClient.DeveloperChipsets(r.Context(), session.AccessToken)
	if err != nil {
		writeChipsetProviderError(w, err)
		return
	}
	writeJSON(w, map[string]any{"chipsets": chipsets, "source_status": "available"})
}

func (s *Server) apiDeveloperChipset(w http.ResponseWriter, r *http.Request) {
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	if !s.accountClient.Enabled() || strings.TrimSpace(session.AccessToken) == "" {
		http.Error(w, "Account Manager is not configured", http.StatusServiceUnavailable)
		return
	}
	chipset, err := s.accountClient.DeveloperChipset(r.Context(), session.AccessToken, r.PathValue("chipsetId"))
	if err != nil {
		writeChipsetProviderError(w, err)
		return
	}
	writeJSON(w, map[string]any{"chipset": chipset, "source_status": "available"})
}

func (s *Server) requirePlatformCapability(w http.ResponseWriter, r *http.Request, required string) (store.Session, []string, bool) {
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return store.Session{}, nil, false
	}
	me, err := s.accountClient.Me(r.Context(), session.AccessToken)
	if err != nil {
		writeChipsetProviderError(w, err)
		return store.Session{}, nil, false
	}
	if !hasCapability(me.Capabilities, required) {
		http.Error(w, "insufficient permissions", http.StatusForbidden)
		return store.Session{}, me.Capabilities, false
	}
	return session, me.Capabilities, true
}

func writeChipsetProviderError(w http.ResponseWriter, err error) {
	var upstream *accountclient.HTTPError
	if errors.As(err, &upstream) {
		status := upstream.StatusCode
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		message := "ChipSet provider request failed"
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(upstream.Body), &body) == nil {
			message = chipsetProviderErrorMessage(body.Error.Code, message)
		} else {
			switch status {
			case http.StatusForbidden:
				message = "insufficient permissions"
			case http.StatusNotFound:
				message = "ChipSet provider not found"
			case http.StatusConflict:
				message = "ChipSet provider conflict"
			}
		}
		http.Error(w, message, status)
		return
	}
	http.Error(w, "ChipSet provider service unavailable", http.StatusBadGateway)
}

func chipsetProviderErrorMessage(code, fallbackMessage string) string {
	message, ok := map[string]string{
		"PROVIDER_URL_INVALID":                  "Provider URL is invalid",
		"PROVIDER_HOST_NOT_ALLOWED":             "Provider host is not allowed",
		"PROVIDER_FETCH_FAILED":                 "Provider fetch failed",
		"PROVIDER_MANIFEST_INVALID":             "Provider manifest validation failed",
		"PROVIDER_MANIFEST_VERSION_UNSUPPORTED": "Provider manifest version is unsupported",
		"PROVIDER_SNAPSHOT_REQUIRED":            "Provider has no valid snapshot",
		"idempotency_key_required":              "Idempotency-Key header is required",
		"forbidden":                             "insufficient permissions",
		"not_found":                             "ChipSet provider not found",
		"conflict":                              "ChipSet provider conflict",
	}[code]
	if !ok {
		return fallbackMessage
	}
	return message
}
