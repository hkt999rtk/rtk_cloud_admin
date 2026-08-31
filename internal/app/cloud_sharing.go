package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"rtk_cloud_admin/internal/accountclient"
)

func (s *Server) apiCloudSharing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") {
		http.Error(w, "global account authentication required", 401)
		return
	}
	cloud, user, invitation, action := r.PathValue("brandCloudID"), r.PathValue("userID"), r.PathValue("invitationID"), r.PathValue("action")
	accept := r.URL.Path == "/api/developer/brand-cloud-member-invitations/accept"
	if r.Method != http.MethodGet && r.Header.Get("Idempotency-Key") == "" {
		http.Error(w, "Idempotency-Key required", http.StatusPreconditionRequired)
		return
	}
	if action != "" && action != "enable" && action != "disable" && action != "resend" && action != "cancel" {
		http.NotFound(w, r)
		return
	}
	if (invitation != "" && action != "resend" && action != "cancel") || (user != "" && action != "" && action != "enable" && action != "disable") {
		http.NotFound(w, r)
		return
	}
	if (!accept && !managedCloudUUID.MatchString(cloud)) || (user != "" && !managedCloudUUID.MatchString(user)) || (invitation != "" && !managedCloudUUID.MatchString(invitation)) {
		http.Error(w, "invalid sharing scope", 400)
		return
	}
	query, err := managedCloudQuery(r.URL.Query())
	if err != nil || query.Get("view") != "" || (len(query) > 0 && (r.Method != "GET" || !strings.HasSuffix(r.URL.Path, "/members"))) {
		http.Error(w, "invalid sharing query", 400)
		return
	}
	key := ""
	var body *accountclient.CloudSharingWrite
	if r.Method != http.MethodGet {
		if !managedCloudSameOrigin(r) {
			http.Error(w, "same-origin request required", 403)
			return
		}
		key = r.Header.Get("Idempotency-Key")
		if len(r.Header.Values("Idempotency-Key")) != 1 || len(key) < 1 || len(key) > 200 || strings.IndexFunc(key, func(c rune) bool { return c < 33 || c > 126 }) >= 0 {
			http.Error(w, "valid Idempotency-Key required", 400)
			return
		}
		body = &accountclient.CloudSharingWrite{}
		if r.Method == http.MethodDelete {
			raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
			if e != nil || len(raw) != 0 {
				http.Error(w, "DELETE must have no body", 400)
				return
			}
			body = nil
		} else {
			if err = decodeCloudSharing(w, r, body); err != nil {
				http.Error(w, "invalid sharing request", 400)
				return
			}
			valid := false
			switch {
			case accept:
				valid = body.Token != "" && body.Email == "" && body.Role == "" && body.AccessScope == nil
			case action != "":
				valid = body.Token == "" && body.Email == "" && body.Role == "" && body.AccessScope == nil
			case user != "":
				valid = body.Token == "" && body.Email == "" && (body.Role != "" || body.AccessScope != nil)
			default:
				valid = body.Token == "" && strings.TrimSpace(body.Email) != "" && body.Role != ""
			}
			if body.Role != "" && body.Role != "viewer" && body.Role != "admin" && body.Role != "member" {
				valid = false
			}
			if body.AccessScope != nil && body.Role != "" && body.Role != "viewer" {
				valid = false
			}
			if body.Role == "viewer" && body.AccessScope == nil {
				valid = false
			}
			if !valid {
				http.Error(w, "invalid sharing fields or role", 400)
				return
			}
			if scope := body.AccessScope; scope != nil {
				if scope.Kind == "all_products" {
					if scope.ProductIDs != nil {
						http.Error(w, "whole-cloud scope cannot include Product IDs", 400)
						return
					}
				} else if scope.Kind == "selected_products" && len(scope.ProductIDs) > 0 {
					for _, id := range scope.ProductIDs {
						if !managedCloudUUID.MatchString(id) {
							http.Error(w, "invalid Product scope", 400)
							return
						}
					}
					sort.Strings(scope.ProductIDs)
					for i := 1; i < len(scope.ProductIDs); i++ {
						if scope.ProductIDs[i] == scope.ProductIDs[i-1] {
							http.Error(w, "duplicate Product ID", 400)
							return
						}
					}
				} else {
					http.Error(w, "explicit sharing scope required", 400)
					return
				}
			}
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if !accept {
		live, e := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, "GET", cloud, "", "", nil)
		if e != nil {
			s.managedCloudError(w, session.ID, e)
			return
		}
		if live.BrandCloud.MyRole != "owner" || !hasCapability(live.BrandCloud.Capabilities, "team.manage") {
			http.Error(w, "cloud owner authority required", 403)
			return
		}
	}
	path := "/v1" + strings.TrimPrefix(r.URL.Path, "/api")
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	target := user
	if invitation != "" {
		target = invitation
	}
	out, err := s.accountClient.CloudSharing(ctx, session.AccessToken, r.Method, path, cloud, target, key, body)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if accept && (out.Member == nil || out.Member.UserID != session.Subject) {
		s.managedCloudError(w, session.ID, errors.New("accepted member differs from authenticated account"))
		return
	}
	if r.Method == http.MethodDelete {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/members") {
		writeJSON(w, map[string]any{"members": out.Members, "pagination": out.Pagination})
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, map[string]any{"invitations": out.Invitations})
		return
	}
	status := 200
	if r.Method == http.MethodPost && !accept && (action == "" || action == "resend") {
		status = 202
	}
	writeJSONStatus(w, status, out)
}

// Reject duplicate keys at every nesting level before decoding typed fields.
// No sharing field accepts JSON null; omission preserves PATCH semantics.
func decodeCloudSharing(w http.ResponseWriter, r *http.Request, out *accountclient.CloudSharingWrite) error {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return errors.New("JSON required")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*1024))
	if err != nil || !utf8.Valid(raw) {
		return errors.New("body")
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	var scan func(int) error
	scan = func(depth int) error {
		if depth > 8 {
			return errors.New("nesting")
		}
		token, err := d.Token()
		if err != nil {
			return err
		}
		if token == nil {
			return errors.New("null")
		}
		if delimiter, ok := token.(json.Delim); ok {
			if delimiter != '{' && delimiter != '[' {
				return errors.New("delimiter")
			}
			seen := map[string]bool{}
			for d.More() {
				if delimiter == '{' {
					key, e := d.Token()
					if e != nil {
						return e
					}
					name, ok := key.(string)
					if !ok || seen[name] {
						return errors.New("duplicate key")
					}
					seen[name] = true
				}
				if err := scan(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		}
		return nil
	}
	if err = scan(0); err != nil {
		return err
	}
	if _, err = d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	d = json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	return d.Decode(out)
}
