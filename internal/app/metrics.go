package app

import (
	"net/http"
	"strings"
)

func (s *Server) metricsPrometheus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	var b strings.Builder
	b.WriteString("# HELP rtk_cloud_admin_up Whether the Cloud Admin app is serving metrics.\n")
	b.WriteString("# TYPE rtk_cloud_admin_up gauge\n")
	b.WriteString("rtk_cloud_admin_up 1\n")

	_, _ = w.Write([]byte(b.String()))
}
