package app

import (
	"net/http"
)

func (s *Server) apiPRO2Examples(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "Developer authentication required", 401)
		return
	}
	if r.Method == http.MethodPost {
		if !managedCloudSameOrigin(r) {
			http.Error(w, "Invalid origin", 403)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if e := r.ParseForm(); e != nil {
			http.Error(w, "Invalid download request", 400)
			return
		}
	}
	b, status, e := s.sdkPortalClient.ExamplesRequest(r.Context(), r.Method, r.URL.Query().Get("version"), r.PostForm, session.ID)
	if e != nil || status >= 500 {
		http.Error(w, "PRO2 examples are temporarily unavailable", 503)
		return
	}
	if status != 200 {
		http.Error(w, "Invalid or unavailable example download", status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
