package app

import (
	"net/http"
	"strings"

	"rtk_cloud_admin/internal/sdkportalclient"
)

func (s *Server) configureSDKPortal() {
	client, err := sdkportalclient.New(s.cfg.SDKPortalBaseURL)
	if err == nil {
		s.sdkPortalClient = client
	}
}

func (s *Server) registerSDKPortalRoutes() {
	s.mux.HandleFunc("GET /api/developer/sdk-releases/latest", s.apiDeveloperSDKReleaseLatest)
}

func (s *Server) apiDeveloperSDKReleaseLatest(w http.ResponseWriter, r *http.Request) {
	_, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	if s.sdkPortalClient == nil {
		http.Error(w, "SDK Portal is not configured", http.StatusServiceUnavailable)
		return
	}
	catalog, err := s.sdkPortalClient.Latest(r.Context())
	if err != nil {
		http.Error(w, "SDK catalog is temporarily unavailable", http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]any{
		"catalog":       catalog,
		"source_status": "available",
		"portal_url":    s.sdkPortalClient.ManualURL(),
		"local_preview": strings.EqualFold(strings.TrimSpace(s.cfg.Environment), "local"),
	})
}
