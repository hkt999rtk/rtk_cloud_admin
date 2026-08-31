package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var managedOperationID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Deliberately excludes arbitrary metadata, payer data and secrets.
type ManagedCloud struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	TenantSlug       string   `json:"tenant_slug"`
	OwnerUserID      string   `json:"owner_user_id"`
	MyRole           string   `json:"my_role"`
	Status           string   `json:"status"`
	OwnershipVersion int64    `json:"ownership_version"`
	Capabilities     []string `json:"capabilities"`
}
type ManagedCloudPage struct {
	BrandClouds   []ManagedCloud `json:"brand_clouds"`
	Pagination    Pagination     `json:"pagination"`
	OwnedCount    int            `json:"owned_count"`
	OwnedLimit    int            `json:"owned_limit"`
	ReservedCount int            `json:"reserved_count"`
}
type CloudBlocker struct {
	Code         string `json:"code"`
	Retryable    bool   `json:"retryable"`
	Count        *int64 `json:"count,omitempty"`
	BalanceMinor *int64 `json:"balance_minor,omitempty"`
}
type ManagedCloudOperation struct {
	ID       string         `json:"id"`
	CloudID  string         `json:"brand_cloud_id"`
	Type     string         `json:"type"`
	State    string         `json:"state"`
	Phase    string         `json:"phase"`
	Blockers []CloudBlocker `json:"blockers"`
}
type ManagedCloudResult struct {
	BrandCloud *ManagedCloud          `json:"brand_cloud,omitempty"`
	Operation  *ManagedCloudOperation `json:"operation,omitempty"`
	Eligible   *bool                  `json:"eligible,omitempty"`
	Blockers   []CloudBlocker         `json:"blockers,omitempty"`
}
type ManagedCloudWrite struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

func (c *Client) ManagedClouds(ctx context.Context, token string, query url.Values) (ManagedCloudPage, error) {
	var out ManagedCloudPage
	err := c.doJSON(ctx, http.MethodGet, "/v1/developer/brand-clouds?"+query.Encode(), token, nil, &out)
	if err == nil && (out.BrandClouds == nil || out.OwnedLimit < 1 || out.OwnedCount < 0 || out.ReservedCount < 0) {
		err = fmt.Errorf("incomplete managed cloud quota response")
	}
	return out, err
}

// The caller selects only fixed cloud-management paths; no incoming trusted
// headers, session-active organization or arbitrary upstream URL are accepted.
func (c *Client) ManagedCloudCommand(ctx context.Context, token, method, cloudID, action, key string, in *ManagedCloudWrite) (ManagedCloudResult, error) {
	var out ManagedCloudResult
	path := "/v1/developer/brand-clouds"
	if cloudID != "" {
		path += "/" + url.PathEscape(cloudID)
	}
	if action != "" {
		path += "/" + action
	}
	var body any
	if in != nil {
		body = in
	}
	err := c.doJSONWithIdempotency(ctx, method, path, token, key, body, &out)
	if err != nil {
		return out, err
	}
	switch {
	case action == "deletion-preflight":
		if out.Eligible == nil || (*out.Eligible && len(out.Blockers) > 0) {
			return out, fmt.Errorf("invalid deletion eligibility")
		}
	case method == http.MethodDelete || len(action) > 0:
		if out.Operation == nil || !managedOperationID.MatchString(out.Operation.ID) || out.Operation.CloudID != cloudID || (strings.HasPrefix(action, "operations/") && out.Operation.ID != strings.TrimPrefix(action, "operations/")) {
			return out, fmt.Errorf("invalid operation scope")
		}
	default:
		if out.BrandCloud == nil || out.BrandCloud.ID == "" || (cloudID != "" && out.BrandCloud.ID != cloudID) {
			return out, fmt.Errorf("invalid cloud scope")
		}
	}
	return out, nil
}
