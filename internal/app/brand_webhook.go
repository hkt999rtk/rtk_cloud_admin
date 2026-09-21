package app

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"

	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/videoclient"
)

var brandWebhookEventID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

type brandWebhookReceipt struct {
	EventID    string `json:"event_id"`
	DeviceID   string `json:"device_id"`
	Attempt    int    `json:"attempt"`
	Outcome    string `json:"outcome"`
	StatusCode int    `json:"status_code"`
	Error      string `json:"error,omitempty"`
	ObservedAt string `json:"observed_at"`
}

type brandWebhookReceiptResponse struct {
	EventID  string                `json:"event_id"`
	Receipts []brandWebhookReceipt `json:"receipts"`
}

func (s *Server) brandWebhookContext(w http.ResponseWriter, r *http.Request) (store.Session, string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	if s.accountClient == nil || s.videoClient == nil || !s.videoClient.Enabled() || s.cfg.VideoCloudBrandWebhookToken == "" ||
		(s.cfg.VideoCloudAdminToken != "" && s.cfg.VideoCloudBrandWebhookToken == s.cfg.VideoCloudAdminToken) {
		http.Error(w, "brand webhook management is not configured", http.StatusServiceUnavailable)
		return store.Session{}, "", false
	}
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "account" && session.Kind != "customer" && session.Kind != "platform_admin") {
		http.Error(w, "global account authentication required", http.StatusUnauthorized)
		return store.Session{}, "", false
	}
	cloudID := r.PathValue("brandCloudID")
	if !managedCloudUUID.MatchString(cloudID) {
		http.Error(w, "explicit cloud scope required", http.StatusBadRequest)
		return store.Session{}, "", false
	}
	if r.Method != http.MethodGet && !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", http.StatusForbidden)
		return store.Session{}, "", false
	}
	detail, err := s.accountClient.ManagedCloudCommand(r.Context(), session.AccessToken, http.MethodGet, cloudID, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return store.Session{}, "", false
	}
	cloud := detail.BrandCloud
	if cloud.ID != cloudID || cloud.MyRole != "owner" || cloud.OwnerUserID != session.Subject || !hasCapability(cloud.Capabilities, "cloud.update") {
		http.Error(w, "current cloud owner required", http.StatusForbidden)
		return store.Session{}, "", false
	}
	version := strconv.FormatInt(cloud.OwnershipVersion, 10)
	if r.Method != http.MethodGet && (len(r.Header.Values("X-Cloud-Ownership-Version")) != 1 || r.Header.Get("X-Cloud-Ownership-Version") != version) {
		http.Error(w, "ownership changed; refresh before writing", http.StatusConflict)
		return store.Session{}, "", false
	}
	w.Header().Set("X-Cloud-Ownership-Version", version)
	return session, cloudID, true
}

func (s *Server) apiBrandWebhookSubscription(w http.ResponseWriter, r *http.Request) {
	_, cloudID, ok := s.brandWebhookContext(w, r)
	if !ok {
		return
	}
	var body []byte
	if r.Method == http.MethodPut {
		var input struct {
			EndpointURL string `json:"endpoint_url"`
			Secret      string `json:"secret"`
		}
		if err := decodeStrictManagedJSON(w, r, &input); err != nil || input.EndpointURL == "" || input.Secret == "" {
			http.Error(w, "invalid subscription JSON", http.StatusBadRequest)
			return
		}
		body, _ = json.Marshal(input)
	}
	response, err := s.videoClient.DoBrandWebhook(r.Context(), r.Method, "", s.cfg.VideoCloudBrandWebhookToken, cloudID, body)
	if err != nil {
		http.Error(w, "brand webhook service unavailable", http.StatusBadGateway)
		return
	}
	if response.StatusCode == http.StatusOK {
		var subscription struct {
			EndpointURL string `json:"endpoint_url"`
			Enabled     bool   `json:"enabled"`
		}
		if err := json.Unmarshal(response.Body, &subscription); err != nil || subscription.EndpointURL == "" {
			http.Error(w, "invalid brand webhook response", http.StatusBadGateway)
			return
		}
		writeJSON(w, subscription) // Project only known fields; never echo a secret.
		return
	}
	writeBrandWebhookResponse(w, response)
}

func (s *Server) apiBrandWebhookReceipts(w http.ResponseWriter, r *http.Request) {
	_, cloudID, ok := s.brandWebhookContext(w, r)
	if !ok {
		return
	}
	eventID := r.PathValue("eventID")
	if !brandWebhookEventID.MatchString(eventID) {
		http.Error(w, "invalid event ID", http.StatusBadRequest)
		return
	}
	response, err := s.videoClient.DoBrandWebhook(r.Context(), http.MethodGet, eventID, s.cfg.VideoCloudBrandWebhookToken, cloudID, nil)
	if err != nil {
		http.Error(w, "brand webhook service unavailable", http.StatusBadGateway)
		return
	}
	if response.StatusCode == http.StatusOK {
		var payload brandWebhookReceiptResponse
		if err := json.Unmarshal(response.Body, &payload); err != nil || payload.EventID != eventID {
			http.Error(w, "invalid brand webhook response", http.StatusBadGateway)
			return
		}
		for _, receipt := range payload.Receipts {
			if receipt.EventID != eventID || receipt.DeviceID == "" {
				http.Error(w, "invalid brand webhook response", http.StatusBadGateway)
				return
			}
		}
		if payload.Receipts == nil {
			payload.Receipts = []brandWebhookReceipt{}
		}
		writeJSON(w, payload)
		return
	}
	writeBrandWebhookResponse(w, response)
}

func writeBrandWebhookResponse(w http.ResponseWriter, response videoclient.BrandWebhookResponse) {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		status := http.StatusBadGateway
		switch response.StatusCode {
		case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict, http.StatusTooManyRequests:
			status = response.StatusCode
		case http.StatusServiceUnavailable:
			status = http.StatusServiceUnavailable
		}
		http.Error(w, "brand webhook request failed", status)
		return
	}
	if response.StatusCode == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	http.Error(w, "invalid brand webhook response", http.StatusBadGateway)
}
