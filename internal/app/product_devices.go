package app

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"rtk_cloud_admin/internal/accountclient"
)

type productDevice struct {
	ID        string   `json:"id"`
	CloudID   string   `json:"brand_cloud_id"`
	ProductID string   `json:"product_id"`
	Name      string   `json:"name"`
	Model     string   `json:"model"`
	Category  string   `json:"category"`
	Status    string   `json:"status"`
	Serial    string   `json:"serial_number"`
	LastSeen  string   `json:"last_seen_at"`
	Actions   []string `json:"allowed_actions"`
}

func projectProductDevice(d accountclient.Device, edit bool) productDevice {
	actions := []string{"read"}
	if edit {
		actions = append(actions, "edit")
	}
	return productDevice{d.ID, d.OrganizationID, d.DeviceItemProfileID, d.Name, d.Model, d.Category, d.Status, d.SerialNumber, d.LastSeenAt, actions}
}

func (s *Server) apiProductDevices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "account" && session.Kind != "customer" && session.Kind != "platform_admin") {
		http.Error(w, "global account authentication required", 401)
		return
	}
	cloud, product, device := r.PathValue("brandCloudID"), r.PathValue("productID"), r.PathValue("deviceID")
	if !managedCloudUUID.MatchString(cloud) || !managedCloudUUID.MatchString(product) || (device != "" && !managedCloudUUID.MatchString(device)) {
		http.Error(w, "invalid device scope", 400)
		return
	}
	q := url.Values{"limit": {"25"}, "offset": {"0"}}
	for k, vs := range r.URL.Query() {
		if device != "" || len(vs) != 1 {
			http.Error(w, "invalid device query", 400)
			return
		}
		v := vs[0]
		switch k {
		case "limit", "offset":
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 || (k == "limit" && (n < 1 || n > 100)) {
				http.Error(w, "invalid pagination", 400)
				return
			}
			v = strconv.Itoa(n)
		case "q":
			if utf8.RuneCountInString(v) > 200 {
				http.Error(w, "query too long", 400)
				return
			}
		default:
			http.Error(w, "unknown device query", 400)
			return
		}
		q.Set(k, v)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	detail, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, "GET", cloud, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if !hasCapability(detail.BrandCloud.Capabilities, "product.read") {
		http.Error(w, "Product access forbidden", 403)
		return
	}
	p, err := s.accountClient.DeviceItemProfile(ctx, session.AccessToken, cloud, product)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if p.ID != product || p.BrandCloudID != cloud {
		http.Error(w, "invalid upstream Product scope", 502)
		return
	}
	if device == "" {
		page, e := s.accountClient.ProductDevices(ctx, session.AccessToken, cloud, product, q)
		if e != nil {
			s.managedCloudError(w, session.ID, e)
			return
		}
		out := make([]productDevice, 0, len(page.Devices))
		for _, d := range page.Devices {
			out = append(out, projectProductDevice(d, false))
		}
		writeJSON(w, map[string]any{"devices": out, "pagination": page.Pagination})
		return
	}
	d, err := s.accountClient.Device(ctx, session.AccessToken, cloud, device)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if d.ID != device || d.OrganizationID != cloud {
		http.Error(w, "invalid upstream device scope", 502)
		return
	}
	if d.DeviceItemProfileID != product {
		http.NotFound(w, r)
		return
	}
	edit := false
	if detail.BrandCloud.MyRole != "viewer" && d.Status != "disabled" {
		edit, err = s.accountClient.CheckAccess(ctx, session.AccessToken, cloud, "registry_device.manage", "device", device)
		if err != nil {
			s.managedCloudError(w, session.ID, err)
			return
		}
	}
	if r.Method == "GET" {
		writeJSON(w, map[string]any{"device": projectProductDevice(d, edit)})
		return
	}
	if !edit || !managedCloudSameOrigin(r) {
		http.Error(w, "device write forbidden", 403)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(r.Header.Values("Idempotency-Key")) != 1 || len(key) < 1 || len(key) > 200 || strings.IndexFunc(key, func(c rune) bool { return c < 33 || c > 126 }) >= 0 {
		http.Error(w, "valid Idempotency-Key required", 400)
		return
	}
	var in struct {
		Name  *string `json:"name"`
		Model *string `json:"model"`
	}
	if decodeStrictManagedJSON(w, r, &in) != nil || (in.Name == nil && in.Model == nil) {
		http.Error(w, "only name and model are mutable", 400)
		return
	}
	body := map[string]string{}
	for k, v := range map[string]*string{"name": in.Name, "model": in.Model} {
		if v == nil {
			continue
		}
		value := strings.TrimSpace(*v)
		if utf8.RuneCountInString(value) > 255 || (k == "name" && value == "") {
			http.Error(w, "invalid device display field", 400)
			return
		}
		body[k] = value
	}
	d, err = s.accountClient.PatchProductDeviceDisplay(ctx, session.AccessToken, cloud, product, device, key, body)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	writeJSON(w, map[string]any{"device": projectProductDevice(d, edit)})
}
