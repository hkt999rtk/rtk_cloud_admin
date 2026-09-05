package app

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// MQTT remains browser-to-broker protocol traffic. This same-origin transport
// bridge does not terminate MQTT or inject server credentials. EMQX validates
// the short-lived CONNECT credential and applies the device-scoped ACL.
func (s *Server) apiTestLabMQTT(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requestSession(r)
	if !ok || actor.AccessToken == "" || (actor.Kind != "account" && actor.Kind != "customer") {
		http.Error(w, "authentication required", 401)
		return
	}
	if !s.cfg.TestLabEnabled || s.cfg.Environment == "prod" || s.cfg.Environment == "production" {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Origin") == "" || !managedCloudSameOrigin(r) || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || r.URL.RawQuery != "" {
		http.Error(w, "same-origin websocket required", 403)
		return
	}
	target, err := url.Parse(s.cfg.TestLabMQTTBackend)
	if err != nil || target.Scheme != "http" || target.Host == "" || target.User != nil || target.RawQuery != "" || target.Fragment != "" {
		http.Error(w, "MQTT transport unavailable", 503)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()
	proxy := httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(target)
		p.Out.URL.Path = "/mqtt"
		p.Out.URL.RawPath = ""
		p.Out.Header.Del("Cookie")
		p.Out.Header.Del("Authorization")
		p.Out.Host = target.Host
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "MQTT transport unavailable", 503)
	}}
	proxy.ServeHTTP(w, r.WithContext(ctx))
}
