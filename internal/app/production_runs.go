package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var factorySlug = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

type productionRunInput struct {
	FactoryID       string `json:"factory_id"`
	BatchID         string `json:"batch_id"`
	AllowedQuantity int    `json:"allowed_quantity"`
	ValidHours      int    `json:"valid_hours"`
}

func (s *Server) apiProductProductionRuns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") {
		http.Error(w, "global account authentication required", http.StatusUnauthorized)
		return
	}
	cloudID, productID, runID := r.PathValue("brandCloudID"), r.PathValue("productID"), r.PathValue("runID")
	if !managedCloudUUID.MatchString(cloudID) || !managedCloudUUID.MatchString(productID) || (runID != "" && !managedCloudUUID.MatchString(runID)) {
		http.Error(w, "invalid scope", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodGet && !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	detail, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, http.MethodGet, cloudID, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if detail.BrandCloud == nil || !hasCapability(detail.BrandCloud.Capabilities, "product.read") {
		http.Error(w, "Product access forbidden", http.StatusForbidden)
		return
	}
	product, err := s.accountClient.DeviceItemProfile(ctx, session.AccessToken, cloudID, productID)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if product.ID != productID || product.BrandCloudID != cloudID {
		http.Error(w, "invalid Product scope", http.StatusBadGateway)
		return
	}
	endpoint := ""
	if public := strings.TrimRight(s.cfg.FactoryEnrollPublicBaseURL, "/"); strings.HasPrefix(public, "https://") {
		endpoint = public + "/v1/factory/enroll"
	}
	if r.Method == http.MethodGet {
		if runID != "" {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		runs, err := s.accountClient.ProductionRuns(ctx, session.AccessToken, cloudID, productID, url.Values{"limit": {"100"}})
		if err != nil {
			s.managedCloudError(w, session.ID, err)
			return
		}
		writeJSON(w, map[string]any{"production_runs": runs, "enrollment_url": endpoint})
		return
	}
	if endpoint == "" {
		http.Error(w, "factory enrollment is not publicly configured", http.StatusServiceUnavailable)
		return
	}
	if runID != "" {
		run, err := s.accountClient.StopFactoryProductionRun(ctx, session.AccessToken, cloudID, productID, runID)
		if err != nil {
			s.managedCloudError(w, session.ID, err)
			return
		}
		writeJSON(w, map[string]any{"production_run": run})
		return
	}
	var input productionRunInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !factorySlug.MatchString(input.FactoryID) || !factorySlug.MatchString(input.BatchID) || input.AllowedQuantity < 1 || input.ValidHours < 1 || input.ValidHours > 168 {
		http.Error(w, "invalid production run", http.StatusBadRequest)
		return
	}
	now := time.Now().UTC()
	issued, err := s.accountClient.CreateFactoryProductionRun(ctx, session.AccessToken, cloudID, productID, input.FactoryID, input.BatchID, input.AllowedQuantity, now, now.Add(time.Duration(input.ValidHours)*time.Hour))
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"production_run": issued.ProductionRun, "factory_jwt": issued.FactoryJWT, "enrollment_url": endpoint, "expires_at": issued.ExpiresAt})
}
