package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

type ScopedProductPage struct {
	Profiles   []DeviceItemProfile `json:"device_item_profiles"`
	Pagination *Pagination         `json:"pagination"`
}

func (c *Client) ScopedProducts(ctx context.Context, token, cloud string, query url.Values) (ScopedProductPage, error) {
	var out ScopedProductPage
	err := c.doJSON(ctx, http.MethodGet, "/v1/orgs/"+url.PathEscape(cloud)+"/device-item-profiles?"+query.Encode(), token, nil, &out)
	if err != nil {
		return out, err
	}
	if out.Profiles == nil || out.Pagination == nil || out.Pagination.Limit < 1 || out.Pagination.Offset < 0 || out.Pagination.Total < 0 || len(out.Profiles) > out.Pagination.Limit {
		return out, fmt.Errorf("incomplete Product pagination")
	}
	if len(out.Profiles) > 0 && (out.Pagination.Offset > out.Pagination.Total || len(out.Profiles) > out.Pagination.Total-out.Pagination.Offset) {
		return out, fmt.Errorf("inconsistent Product total")
	}
	seen := make(map[string]bool, len(out.Profiles))
	for _, p := range out.Profiles {
		if p.BrandCloudID != cloud || !managedOperationID.MatchString(p.ID) || seen[p.ID] {
			return out, fmt.Errorf("invalid Product scope")
		}
		seen[p.ID] = true
	}
	return out, nil
}

func (c *Client) ScopedProductWrite(ctx context.Context, token, cloud, product, method, action, key string, body map[string]any) (DeviceItemProfile, error) {
	var out struct {
		Product DeviceItemProfile `json:"device_item_profile"`
	}
	path := "/v1/orgs/" + url.PathEscape(cloud) + "/device-item-profiles"
	if product != "" {
		path += "/" + url.PathEscape(product)
	}
	if action != "" {
		path += "/" + action
	}
	err := c.doJSONWithIdempotency(ctx, method, path, token, key, body, &out)
	if err == nil && (out.Product.BrandCloudID != cloud || !managedOperationID.MatchString(out.Product.ID) || (product != "" && out.Product.ID != product)) {
		err = fmt.Errorf("invalid Product write scope")
	}
	return out.Product, err
}
