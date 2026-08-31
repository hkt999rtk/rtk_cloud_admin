package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"rtk_cloud_admin/internal/accountclient"
)

var managedCloudUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (s *Server) apiManagedCloud(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") || session.AccessToken == "" {
		http.Error(w, "global account authentication required", 401)
		return
	}
	if !s.accountClient.Enabled() {
		http.Error(w, "cloud management unavailable", 503)
		return
	}
	cloud, operation := r.PathValue("brandCloudID"), r.PathValue("operationID")
	if (cloud != "" && !managedCloudUUID.MatchString(cloud)) || (operation != "" && !managedCloudUUID.MatchString(operation)) {
		http.Error(w, "invalid cloud or operation ID", 400)
		return
	}
	query, err := managedCloudQuery(r.URL.Query())
	if err != nil {
		http.Error(w, "invalid cloud list query", 400)
		return
	}
	key := ""
	var body *accountclient.ManagedCloudWrite
	if r.Method != http.MethodGet {
		// A required JSON request/header plus same-origin validation protects the
		// cookie-authenticated write. Never trust browser-supplied actor headers.
		if !managedCloudSameOrigin(r) {
			http.Error(w, "same-origin request required", 403)
			return
		}
		key = r.Header.Get("Idempotency-Key")
		if len(r.Header.Values("Idempotency-Key")) != 1 || len(key) < 1 || len(key) > 200 || strings.IndexFunc(key, func(c rune) bool { return c < 33 || c > 126 }) >= 0 {
			http.Error(w, "valid Idempotency-Key required", 400)
			return
		}
		if r.Method == http.MethodDelete {
			raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
			if e != nil || len(raw) != 0 {
				http.Error(w, "DELETE must have no body", 400)
				return
			}
		} else {
			body, err = decodeManagedCloudWrite(w, r)
			if err != nil {
				http.Error(w, "only unique name and description strings are accepted", 400)
				return
			}
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if r.Method == http.MethodGet && cloud == "" {
		out, e := s.accountClient.ManagedClouds(ctx, session.AccessToken, query)
		if e != nil {
			s.managedCloudError(w, session.ID, e)
			return
		}
		writeJSON(w, out)
		return
	}
	action := ""
	if operation != "" {
		action = "operations/" + url.PathEscape(operation)
	} else if strings.HasSuffix(r.URL.Path, "/deletion-preflight") {
		action = "deletion-preflight"
	}
	out, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, r.Method, cloud, action, key, body)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	if r.Method == http.MethodDelete {
		status = http.StatusAccepted
		w.Header().Set("Location", "/api/developer/brand-clouds/"+cloud+"/operations/"+out.Operation.ID)
	}
	writeJSONStatus(w, status, out)
}

func managedCloudQuery(in url.Values) (url.Values, error) {
	out := url.Values{}
	for key, values := range in {
		if len(values) != 1 {
			return nil, errors.New("duplicate query")
		}
		v := values[0]
		switch key {
		case "view":
			if v != "all" && v != "owned" && v != "shared" {
				return nil, errors.New("view")
			}
		case "limit", "offset":
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 || (key == "limit" && (n < 1 || n > 100)) {
				return nil, errors.New("pagination")
			}
		default:
			return nil, errors.New("unknown query")
		}
		out.Set(key, v)
	}
	return out, nil
}

func managedCloudSameOrigin(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	} // non-browser clients still require the custom key
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host == r.Host && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

func decodeManagedCloudWrite(w http.ResponseWriter, r *http.Request) (*accountclient.ManagedCloudWrite, error) {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return nil, errors.New("JSON required")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16*1024))
	if err != nil || !utf8.Valid(raw) {
		return nil, errors.New("body")
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	tok, err := d.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, errors.New("object required")
	}
	out := &accountclient.ManagedCloudWrite{}
	seen := map[string]bool{}
	for d.More() {
		tok, e := d.Token()
		key, ok := tok.(string)
		if e != nil || !ok || seen[key] || (key != "name" && key != "description") {
			return nil, errors.New("field")
		}
		seen[key] = true
		var value *string
		if d.Decode(&value) != nil || value == nil {
			return nil, errors.New("string required")
		}
		if key == "name" {
			out.Name = value
		} else {
			out.Description = value
		}
	}
	if _, err = d.Token(); err != nil {
		return nil, err
	}
	if _, err = d.Token(); err != io.EOF {
		return nil, errors.New("trailing JSON")
	}
	return out, nil
}

func (s *Server) managedCloudError(w http.ResponseWriter, sessionID string, err error) {
	status := http.StatusBadGateway
	var remote *accountclient.HTTPError
	if errors.As(err, &remote) {
		switch remote.StatusCode {
		case 400, 401, 403, 404, 409, 422, 429, 503:
			status = remote.StatusCode
		}
	}
	if status == 401 {
		s.invalidateCustomerSession(w, sessionID)
	}
	// Preserve actionable statuses, never leak upstream diagnostics or tokens.
	writeJSONStatus(w, status, map[string]string{"code": "cloud_management_failed", "message": "Cloud request could not be completed. Refresh access, quota or deletion preflight before retrying."})
}
