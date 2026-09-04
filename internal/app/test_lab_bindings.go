package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) apiTestLabManage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := s.requestSession(r)
	if !ok || actor.AccessToken == "" || (actor.Kind != "account" && actor.Kind != "customer") {
		http.Error(w, "developer authentication required", 401)
		return
	}
	if !s.cfg.TestLabEnabled || s.cfg.Environment == "prod" || s.cfg.Environment == "production" {
		http.NotFound(w, r)
		return
	}
	if r.Method != "GET" && !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", 403)
		return
	}
	cloud, path := r.PathValue("brandCloudID"), r.PathValue("rest")
	parts := strings.Split(path, "/")
	valid := false
	if len(parts) == 1 {
		valid = (parts[0] == "accounts" && r.Method == "POST") || (parts[0] == "devices" && r.Method == "GET")
	}
	if len(parts) == 2 {
		valid = managedCloudUUID.MatchString(parts[1]) && ((parts[0] == "accounts" && r.Method == "DELETE") || (parts[0] == "devices" && r.Method == "GET"))
	}
	if len(parts) == 3 {
		valid = parts[0] == "devices" && managedCloudUUID.MatchString(parts[1]) && r.Method == "POST" && (parts[2] == "grant" || parts[2] == "bind" || parts[2] == "unbind" || parts[2] == "provision")
	}
	if !managedCloudUUID.MatchString(cloud) || !valid {
		http.NotFound(w, r)
		return
	}
	var body map[string]any
	if r.Method == "POST" {
		if decodeStrictManagedJSON(w, r, &body) != nil {
			return
		}
	}
	if r.Method == "GET" {
		q := r.URL.Query()
		for key := range q {
			if key != "account_id" && key != "product_id" && key != "limit" && key != "offset" {
				http.Error(w, "invalid query", 400)
				return
			}
		}
		path += "?" + q.Encode()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	raw, err := s.accountClient.TestLabManage(ctx, actor.AccessToken, cloud, path, r.Method, body)
	if err != nil {
		s.managedCloudError(w, actor.ID, err)
		return
	}
	if r.Method == "DELETE" {
		w.WriteHeader(204)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

func (s *Server) labBindingReady(ctx context.Context, token, cloud, product, account, device string) (bool, error) {
	raw, err := s.accountClient.TestLabManage(ctx, token, cloud, "devices/"+url.PathEscape(device)+"?"+url.Values{"product_id": {product}, "account_id": {account}}.Encode(), "GET", nil)
	if err != nil {
		return false, err
	}
	var result struct {
		Ready bool `json:"runtime_ready"`
	}
	err = json.Unmarshal(raw, &result)
	return result.Ready, err
}
