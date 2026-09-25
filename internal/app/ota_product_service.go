package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
)

// The Product service selection is the authority for customer OTA access.
func (s *Server) requireOTAProduct(w http.ResponseWriter, ctx context.Context, accessToken, cloudID, productID string) bool {
	if !s.accountClient.Enabled() {
		return true // Legacy installations have no Product service catalog.
	}
	productID = strings.TrimSpace(productID)
	profile, err := s.accountClient.DeviceItemProfile(ctx, accessToken, cloudID, productID)
	if err != nil {
		var upstream *accountclient.HTTPError
		if errors.As(err, &upstream) && upstream.StatusCode == http.StatusNotFound {
			writeJSONStatus(w, http.StatusNotFound, map[string]any{"code": "PRODUCT_NOT_FOUND", "message": "Product not found."})
			return false
		}
		s.writeCustomerError(w, err)
		return false
	}
	if profile.ID != productID || profile.BrandCloudID != cloudID {
		writeJSONStatus(w, http.StatusNotFound, map[string]any{"code": "PRODUCT_NOT_FOUND", "message": "Product not found."})
		return false
	}
	if profile.Status != "active" || !slices.Contains(profile.ServiceOptions, "ota") {
		writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "PRODUCT_OTA_NOT_ENABLED", "message": "OTA is not enabled for this Product."})
		return false
	}
	return true
}

func (s *Server) requireOTACampaignProduct(w http.ResponseWriter, r *http.Request, accessToken, cloudID, campaignID string) bool {
	if !s.accountClient.Enabled() {
		return true
	}
	response, err := s.videoClient.DoOTA(r.Context(), http.MethodGet, "/v1/ota/campaigns/"+url.PathEscape(campaignID), s.videoCloudOTAToken(), cloudID, "", nil)
	if err != nil {
		writeJSONStatus(w, http.StatusServiceUnavailable, map[string]any{"code": "OTA_UPSTREAM_ERROR", "message": "OTA service unavailable."})
		return false
	}
	if response.StatusCode != http.StatusOK {
		writeJSONStatus(w, response.StatusCode, map[string]any{"code": "OTA_CAMPAIGN_UNAVAILABLE", "message": "OTA campaign unavailable."})
		return false
	}
	var campaign struct {
		ProductID string `json:"product_id"`
	}
	if json.Unmarshal(response.Body, &campaign) != nil || strings.TrimSpace(campaign.ProductID) == "" {
		writeJSONStatus(w, http.StatusBadGateway, map[string]any{"code": "OTA_UPSTREAM_ERROR", "message": "OTA campaign has no Product."})
		return false
	}
	return s.requireOTAProduct(w, r.Context(), accessToken, cloudID, campaign.ProductID)
}
