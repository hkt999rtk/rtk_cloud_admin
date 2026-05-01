package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

type Server struct {
	store *store.Store
	mux   *http.ServeMux
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
	s := &Server{store: st, mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /api/summary", s.apiSummary)
	s.mux.HandleFunc("GET /api/devices", s.apiDevices)
	s.mux.HandleFunc("GET /api/operations", s.apiOperations)
	s.mux.HandleFunc("GET /api/service-health", s.apiServiceHealth)
	s.mux.HandleFunc("POST /api/devices/{id}/provision", s.apiProvisionDevice)
	s.mux.HandleFunc("POST /api/devices/{id}/deactivate", s.apiDeactivateDevice)
	s.mux.HandleFunc("GET /assets/", s.assets)
	s.mux.HandleFunc("GET /", s.home)
	s.mux.HandleFunc("GET /console", s.shell)
	s.mux.HandleFunc("GET /console/devices", s.shell)
	s.mux.HandleFunc("GET /admin", s.shell)
	s.mux.HandleFunc("GET /admin/operations", s.shell)
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

func (s *Server) apiDevices(w http.ResponseWriter, _ *http.Request) {
	devices, err := s.store.ListDevices()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, devices)
}

func (s *Server) apiOperations(w http.ResponseWriter, _ *http.Request) {
	ops, err := s.store.ListOperations()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ops)
}

func (s *Server) apiServiceHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, []contracts.ServiceHealth{
		{Name: "Account Manager", Status: "demo", Detail: "ACCOUNT_MANAGER_BASE_URL is not configured; using SQLite seed projections."},
		{Name: "Video Cloud", Status: "demo", Detail: "VIDEO_CLOUD_BASE_URL is not configured; lifecycle actions are simulated."},
		{Name: "SQLite", Status: "ok", Detail: "Local console cache is available."},
	})
}

func (s *Server) apiProvisionDevice(w http.ResponseWriter, r *http.Request) {
	op, err := s.store.CreateLifecycleOperation(r.PathValue("id"), "DeviceProvisionRequested")
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, op)
}

func (s *Server) apiDeactivateDevice(w http.ResponseWriter, r *http.Request) {
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
