package app

import (
	"context"
	"net/http"
	"time"
)

func (s *Server) apiManagedCloudServiceOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" {
		http.Error(w, "global account authentication required", http.StatusUnauthorized)
		return
	}
	cloud := r.PathValue("brandCloudID")
	if !managedCloudUUID.MatchString(cloud) {
		http.Error(w, "invalid cloud scope", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	result, err := s.accountClient.ServiceCatalog(ctx, session.AccessToken, cloud)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	writeJSON(w, result)
}
