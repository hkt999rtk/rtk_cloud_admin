package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
)

func (s *Server) apiSocialProviders(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		writeJSON(w, map[string][]accountclient.SocialProvider{"providers": {}})
		return
	}
	providers, err := s.accountClient.SocialProviders(r.Context())
	if err != nil {
		// Password login remains usable if provider discovery is unavailable.
		writeJSON(w, map[string][]accountclient.SocialProvider{"providers": {}})
		return
	}
	writeJSON(w, map[string][]accountclient.SocialProvider{"providers": providers})
}

func (s *Server) apiSocialLoginStart(w http.ResponseWriter, r *http.Request) {
	if !s.accountClient.Enabled() {
		http.Error(w, "social login is not configured", http.StatusServiceUnavailable)
		return
	}
	var body accountclient.SocialLoginStartRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.ProviderID) == "" {
		http.Error(w, "invalid social login request", http.StatusBadRequest)
		return
	}
	body.ProviderID = strings.ToLower(strings.TrimSpace(body.ProviderID))
	if body.ProviderID != "google" && body.ProviderID != "github" {
		http.Error(w, "social login provider is unavailable", http.StatusNotFound)
		return
	}
	result, err := s.accountClient.StartSocialLogin(r.Context(), body)
	if err != nil {
		writeSocialProxyError(w, err)
		return
	}
	if strings.TrimSpace(result.RedirectURL) == "" {
		http.Error(w, "social login provider did not return a redirect", http.StatusBadGateway)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiSocialLoginCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if strings.TrimSpace(query.Get("error")) != "" {
		redirectSocialLoginError(w, r, "cancelled")
		return
	}
	code, state := strings.TrimSpace(query.Get("code")), strings.TrimSpace(query.Get("state"))
	if code == "" || state == "" {
		redirectSocialLoginError(w, r, "invalid_state")
		return
	}
	result, err := s.accountClient.CompleteSocialLogin(r.Context(), accountclient.SocialLoginCallbackRequest{Code: code, State: state})
	if err != nil {
		redirectSocialLoginError(w, r, socialErrorCode(err))
		return
	}
	me, tokens, err := s.resolveCustomerProfile(r.Context(), result.Tokens)
	if err != nil {
		redirectSocialLoginError(w, r, "unavailable")
		return
	}
	memberships := me.Memberships()
	kind := selectAccountView(result.ReturnPath, len(memberships) > 0, hasAnyPlatformCapability(me.EffectivePlatformCapabilities()))
	activeOrgID := ""
	if len(memberships) > 0 {
		activeOrgID = memberships[0].ID
	}
	session, err := s.sessions.CreateSession(kind, result.User.ID, result.User.Email, tokens.AccessToken, tokens.RefreshToken, activeOrgID, tokenTTL(tokens))
	if err != nil {
		redirectSocialLoginError(w, r, "unavailable")
		return
	}
	setSessionCookie(w, session.ID)
	_ = s.auditSSOSession(result.User.Email, kind, activeOrgID, "accepted")
	http.Redirect(w, r, socialLoginDestination(kind, result.ReturnPath), http.StatusFound)
}

func socialLoginDestination(kind, next string) string {
	parsed, err := url.Parse(strings.TrimSpace(next))
	if err == nil && parsed.Scheme == "" && parsed.Host == "" && strings.HasPrefix(next, "/") && !strings.HasPrefix(next, "//") {
		if kind == "platform_admin" && (parsed.Path == "/admin" || strings.HasPrefix(parsed.Path, "/admin/")) {
			return next
		}
		if kind == "customer" && (parsed.Path == "/console" || strings.HasPrefix(parsed.Path, "/console/")) {
			return next
		}
	}
	if kind == "platform_admin" {
		return "/admin"
	}
	return "/console/clouds"
}

func socialErrorCode(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "not provisioned"):
		return "account_unavailable"
	case strings.Contains(message, "verified primary email"), strings.Contains(message, "email_unverified"):
		return "email_unverified"
	case strings.Contains(message, "state"):
		return "invalid_state"
	case strings.Contains(message, "cancel"):
		return "cancelled"
	default:
		return "unavailable"
	}
}

func redirectSocialLoginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?social_error="+url.QueryEscape(code), http.StatusFound)
}

func writeSocialProxyError(w http.ResponseWriter, err error) {
	if status, ok := customerUpstreamStatus(err); ok {
		switch status {
		case http.StatusBadRequest:
			http.Error(w, "social login request was rejected", http.StatusBadRequest)
		case http.StatusForbidden:
			http.Error(w, "social login is not available for this account", http.StatusForbidden)
		case http.StatusNotFound:
			http.Error(w, "social login provider is unavailable", http.StatusNotFound)
		default:
			http.Error(w, "social login is temporarily unavailable", http.StatusBadGateway)
		}
		return
	}
	http.Error(w, "social login is temporarily unavailable", http.StatusBadGateway)
}
