package app

import (
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

//go:embed pki.html
var pkiPage []byte

//go:embed pki.js
var pkiScript []byte

func (s *Server) platformPKIScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(pkiScript)
}

func (s *Server) platformPKI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if _, ok := s.requestSession(r); !ok {
		http.Error(w, "Sign in to Cloud Admin before opening PKI", 401)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	w.Write(pkiPage)
}

func (s *Server) apiPlatformPKI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "account" && session.Kind != "customer" && session.Kind != "platform_admin") {
		http.Error(w, "account authentication required", 401)
		return
	}
	path := "/" + r.PathValue("path")
	if r.URL.RawQuery != "" {
		http.Error(w, "unexpected query", 400)
		return
	}
	var raw []byte
	key := ""
	if r.Method == "POST" {
		if !managedCloudSameOrigin(r) || strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			http.Error(w, "same-origin JSON required", 403)
			return
		}
		var err error
		key, ok = requireIdempotencyKey(w, r)
		if !ok {
			return
		}
		raw, err = io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
		if err != nil || !json.Valid(raw) {
			http.Error(w, "invalid JSON", 400)
			return
		}
	}
	var result json.RawMessage
	var err error
	if strings.HasPrefix(r.URL.Path, "/api/platform/admin-recovery") {
		result, err = s.accountClient.AdminRecovery(r.Context(), session.AccessToken, r.Method, strings.TrimPrefix(r.URL.Path, "/api/platform/admin-recovery"), key, raw)
	} else {
		result, err = s.accountClient.PKI(r.Context(), session.AccessToken, r.Method, path, key, raw)
	}
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

func (s *Server) startPKIStepUp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" {
		http.Error(w, "sign in first", 401)
		return
	}
	if !managedCloudSameOrigin(r) || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "same-origin JSON required", 403)
		return
	}
	var input struct {
		Provider string `json:"provider"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input) != nil {
		http.Error(w, "invalid provider", 400)
		return
	}
	location, state, err := s.accountClient.StartPKIOIDC(r.Context(), input.Provider)
	if err != nil {
		http.Error(w, "PKI MFA login is unavailable", 503)
		return
	}
	binding := sha256.Sum256([]byte(session.ID + "\x00" + input.Provider + "\x00" + state))
	http.SetCookie(w, &http.Cookie{Name: "rtk_pki_state", Value: hex.EncodeToString(binding[:]), Path: "/api/pki/oidc/", MaxAge: 300, HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]string{"redirect_url": location})
}

func (s *Server) completePKIStepUp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	cookie, err := r.Cookie("rtk_pki_state")
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	binding := sha256.Sum256([]byte(session.ID + "\x00" + r.PathValue("provider") + "\x00" + state))
	if !ok || err != nil || state == "" || code == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(hex.EncodeToString(binding[:]))) != 1 {
		http.Error(w, "PKI login state mismatch", 403)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "rtk_pki_state", Value: "", Path: "/api/pki/oidc/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	result, err := s.accountClient.CompletePKIOIDC(r.Context(), r.PathValue("provider"), code, state)
	if err != nil || result.User.ID != session.Subject || result.Tokens.AccessToken == "" {
		http.Error(w, "Reauthenticate with the same account", 403)
		return
	}
	// Check effective PKI authority before placing the new access token in session.
	if _, err = s.accountClient.PKI(r.Context(), result.Tokens.AccessToken, "POST", "/issuers/search", "", json.RawMessage(`{"limit":1}`)); err != nil {
		// Administrative recovery must remain usable during a controller outage.
		if _, err = s.accountClient.AdminRecovery(r.Context(), result.Tokens.AccessToken, "GET", "", "", nil); err != nil {
			http.Error(w, "Recent MFA and a recovery role are required", 403)
			return
		}
	}
	if err = s.sessions.UpdateSessionTokens(session.ID, result.Tokens.AccessToken, result.Tokens.RefreshToken, tokenTTL(result.Tokens)); err != nil {
		http.Error(w, "session update failed", 500)
		return
	}
	http.Redirect(w, r, "/platform/pki", http.StatusSeeOther)
}
