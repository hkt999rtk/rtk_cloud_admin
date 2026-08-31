package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"rtk_cloud_admin/internal/accountclient"
)

type scopedProduct struct {
	ID       string   `json:"id"`
	CloudID  string   `json:"brand_cloud_id"`
	Name     string   `json:"name"`
	Key      string   `json:"profile_key"`
	Status   string   `json:"status"`
	Model    string   `json:"product_model"`
	Category string   `json:"category"`
	Services []string `json:"service_options"`
	Role     string   `json:"my_role"`
	Actions  []string `json:"allowed_actions"`
}

func scopedProductProjection(p accountclient.DeviceItemProfile, cloud accountclient.ManagedCloud) scopedProduct {
	actions := []string{"read"}
	if cloud.MyRole != "viewer" {
		if (cloud.MyRole == "owner" && hasCapability(cloud.Capabilities, "product.manage")) || p.CurrentUserRole == "product_owner" {
			actions = append(actions, "edit", "disable")
		} else if p.CurrentUserRole == "product_editor" {
			actions = append(actions, "edit")
		}
	}
	services := p.ServiceOptions
	if services == nil {
		services = []string{}
	}
	role := p.CurrentUserRole
	if cloud.MyRole == "viewer" {
		role = "product_viewer"
	}
	return scopedProduct{p.ID, p.BrandCloudID, p.DisplayName, p.ProfileKey, p.Status, p.Model, p.Category, services, role, actions}
}

func scopedProductQuery(in url.Values, list bool) (url.Values, error) {
	out := url.Values{}
	for key, values := range in {
		if !list || len(values) != 1 {
			return nil, errors.New("query")
		}
		value := values[0]
		switch key {
		case "limit", "offset":
			n, err := strconv.Atoi(value)
			if err != nil || n < 0 || (key == "limit" && (n < 1 || n > 100)) {
				return nil, errors.New("pagination")
			}
		case "status":
			if value != "active" && value != "disabled" {
				return nil, errors.New("status")
			}
		default:
			return nil, errors.New("unknown query")
		}
		out.Set(key, value)
	}
	if list {
		if out.Get("limit") == "" {
			out.Set("limit", "25")
		}
		if out.Get("offset") == "" {
			out.Set("offset", "0")
		}
	}
	return out, nil
}

func (s *Server) apiManagedCloudProducts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") {
		http.Error(w, "global account authentication required", 401)
		return
	}
	cloud, product := r.PathValue("brandCloudID"), r.PathValue("productID")
	if !managedCloudUUID.MatchString(cloud) || (product != "" && !managedCloudUUID.MatchString(product)) {
		http.Error(w, "invalid scope", 400)
		return
	}
	query, err := scopedProductQuery(r.URL.Query(), r.Method == http.MethodGet && product == "")
	if err != nil {
		http.Error(w, "invalid Product query", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	detail, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, http.MethodGet, cloud, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	authority := *detail.BrandCloud
	if !hasCapability(authority.Capabilities, "product.read") {
		http.Error(w, "Product access forbidden", 403)
		return
	}
	if r.Method != http.MethodGet {
		s.writeScopedProduct(w, r.WithContext(ctx), session.ID, session.AccessToken, authority, product)
		return
	}
	if product != "" {
		p, err := s.accountClient.DeviceItemProfile(ctx, session.AccessToken, cloud, product)
		if err != nil {
			s.managedCloudError(w, session.ID, err)
			return
		}
		if p.BrandCloudID != cloud || p.ID != product {
			http.Error(w, "invalid upstream Product scope", 502)
			return
		}
		writeJSON(w, map[string]any{"product": scopedProductProjection(p, authority)})
		return
	}
	page, err := s.accountClient.ScopedProducts(ctx, session.AccessToken, cloud, query)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if strconv.Itoa(page.Pagination.Limit) != query.Get("limit") || strconv.Itoa(page.Pagination.Offset) != query.Get("offset") {
		http.Error(w, "invalid upstream pagination", 502)
		return
	}
	out := make([]scopedProduct, 0, len(page.Profiles))
	for _, p := range page.Profiles {
		out = append(out, scopedProductProjection(p, authority))
	}
	writeJSON(w, map[string]any{"products": out, "pagination": page.Pagination, "can_create": authority.MyRole == "owner" && hasCapability(authority.Capabilities, "product.manage")})
}

type scopedProductInput struct {
	Name     *string   `json:"name"`
	Key      *string   `json:"profile_key"`
	Model    *string   `json:"product_model"`
	Category *string   `json:"category"`
	Services *[]string `json:"service_options"`
}

func (s *Server) writeScopedProduct(w http.ResponseWriter, r *http.Request, sessionID, token string, cloud accountclient.ManagedCloud, product string) {
	if !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", 403)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(r.Header.Values("Idempotency-Key")) != 1 || len(key) < 1 || len(key) > 200 || strings.IndexFunc(key, func(c rune) bool { return c < 33 || c > 126 }) >= 0 {
		http.Error(w, "valid Idempotency-Key required", 400)
		return
	}
	if cloud.MyRole == "viewer" {
		http.Error(w, "read-only Product access", 403)
		return
	}
	if product == "" {
		if cloud.MyRole != "owner" || !hasCapability(cloud.Capabilities, "product.manage") {
			http.Error(w, "cloud owner required", 403)
			return
		}
	} else {
		// Fetch the exact Product before checking write authority. Neither an active
		// cloud in the session nor an unrelated Product ID can select the target.
		p, err := s.accountClient.DeviceItemProfile(r.Context(), token, cloud.ID, product)
		if err != nil {
			s.managedCloudError(w, sessionID, err)
			return
		}
		if p.ID != product || p.BrandCloudID != cloud.ID {
			http.Error(w, "invalid upstream Product scope", 502)
			return
		}
		requiredAction := "edit"
		if strings.HasSuffix(r.URL.Path, "/disable") {
			requiredAction = "disable"
		}
		if !hasCapability(scopedProductProjection(p, cloud).Actions, requiredAction) {
			http.Error(w, "Product action forbidden", 403)
			return
		}
		allowed, err := s.accountClient.CheckAccess(r.Context(), token, cloud.ID, "registry_device.manage", "product", product)
		if err != nil {
			s.managedCloudError(w, sessionID, err)
			return
		}
		if !allowed {
			http.Error(w, "Product write forbidden", 403)
			return
		}
	}
	var input scopedProductInput
	if decodeStrictManagedJSON(w, r, &input) != nil {
		http.Error(w, "invalid Product fields", 400)
		return
	}
	action := ""
	if strings.HasSuffix(r.URL.Path, "/disable") {
		action = "disable"
	}
	body := map[string]any{}
	for _, field := range []struct {
		key   string
		value *string
		max   int
	}{
		{"display_name", input.Name, 255}, {"profile_key", input.Key, 120}, {"model", input.Model, 255}, {"category", input.Category, 32},
	} {
		if field.value == nil {
			continue
		}
		value := strings.TrimSpace(*field.value)
		if utf8.RuneCountInString(value) > field.max || (field.key != "model" && value == "") {
			http.Error(w, "invalid Product value", 400)
			return
		}
		body[field.key] = value
	}
	if input.Category != nil && *input.Category != "ip_camera" && *input.Category != "mqtt_device" && *input.Category != "generic" {
		http.Error(w, "invalid category", 400)
		return
	}
	if input.Services != nil {
		if len(*input.Services) == 0 {
			http.Error(w, "at least one service option required", 400)
			return
		}
		seen := map[string]bool{}
		for _, value := range *input.Services {
			if (value != "mqtt" && value != "video_streaming" && value != "video_storage") || seen[value] {
				http.Error(w, "invalid service options", 400)
				return
			}
			seen[value] = true
		}
		body["service_options"] = *input.Services
	}
	if action == "disable" {
		if len(body) != 0 {
			http.Error(w, "disable requires an empty object", 400)
			return
		}
	} else if product == "" {
		if input.Name == nil || input.Key == nil || input.Category == nil || input.Services == nil {
			http.Error(w, "name, profile_key, category and service_options required", 400)
			return
		}
		body["ca_profile"] = "brand-default"
		body["issuer_profile"] = "brand-default"
	} else if input.Key != nil || len(body) == 0 {
		http.Error(w, "immutable key or empty update", 400)
		return
	}
	p, err := s.accountClient.ScopedProductWrite(r.Context(), token, cloud.ID, product, r.Method, action, key, body)
	if err != nil {
		s.managedCloudError(w, sessionID, err)
		return
	}
	status := http.StatusOK
	if product == "" {
		status = http.StatusCreated
	}
	writeJSONStatus(w, status, map[string]any{"product": scopedProductProjection(p, cloud)})
}
