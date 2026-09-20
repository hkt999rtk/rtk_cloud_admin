package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

type ServiceCatalogOption struct {
	Code              string   `json:"code"`
	DisplayName       string   `json:"display_name"`
	Description       string   `json:"description"`
	Requires          []string `json:"requires,omitempty"`
	ServiceID         string   `json:"service_id"`
	ManifestVersion   string   `json:"manifest_version"`
	Selectable        bool     `json:"selectable"`
	UnavailableReason string   `json:"unavailable_reason,omitempty"`
}

type ServiceCatalog struct {
	CatalogRevision      int64                  `json:"catalog_revision"`
	Options              []ServiceCatalogOption `json:"options"`
	ProductWritesEnabled bool                   `json:"product_writes_enabled"`
}

func (c *Client) ServiceCatalog(ctx context.Context, token, cloud string) (ServiceCatalog, error) {
	var out ServiceCatalog
	path := "/v1/platform/service-options?brand_cloud_id=" + url.QueryEscape(cloud)
	if err := c.doJSON(ctx, http.MethodGet, path, token, nil, &out); err != nil {
		return ServiceCatalog{}, err
	}
	if out.CatalogRevision < 1 || out.Options == nil {
		return ServiceCatalog{}, fmt.Errorf("incomplete service catalog")
	}
	return out, nil
}
