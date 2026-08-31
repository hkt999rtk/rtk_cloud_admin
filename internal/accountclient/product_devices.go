package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

type ProductDevicePage struct {
	Devices    []Device    `json:"devices"`
	Pagination *Pagination `json:"pagination"`
}

func (c *Client) ProductDevices(ctx context.Context, token, cloud, product string, query url.Values) (ProductDevicePage, error) {
	q := url.Values{}
	for k, v := range query {
		q[k] = append([]string(nil), v...)
	}
	q.Set("product_id", product)
	var out ProductDevicePage
	err := c.doJSON(ctx, http.MethodGet, "/v1/orgs/"+url.PathEscape(cloud)+"/fleet/devices?"+q.Encode(), token, nil, &out)
	if err != nil {
		return out, err
	}
	p := out.Pagination
	if out.Devices == nil || p == nil || p.Limit < 1 || p.Offset < 0 || p.Total < 0 || strconv.Itoa(p.Limit) != q.Get("limit") || strconv.Itoa(p.Offset) != q.Get("offset") || len(out.Devices) > p.Limit || (len(out.Devices) > 0 && (p.Offset > p.Total || len(out.Devices) > p.Total-p.Offset)) {
		return out, fmt.Errorf("invalid Product device pagination")
	}
	seen := map[string]bool{}
	for _, d := range out.Devices {
		if !managedOperationID.MatchString(d.ID) || d.OrganizationID != cloud || d.DeviceItemProfileID != product || seen[d.ID] {
			return out, fmt.Errorf("invalid Product device scope")
		}
		seen[d.ID] = true
	}
	return out, nil
}

func (c *Client) PatchProductDeviceDisplay(ctx context.Context, token, cloud, product, device, key string, body map[string]string) (Device, error) {
	var out struct {
		Device Device `json:"device"`
	}
	path := "/v1/orgs/" + url.PathEscape(cloud) + "/device-item-profiles/" + url.PathEscape(product) + "/devices/" + url.PathEscape(device) + "/display"
	err := c.doJSONWithIdempotency(ctx, http.MethodPatch, path, token, key, body, &out)
	if err == nil && (out.Device.ID != device || out.Device.OrganizationID != cloud || out.Device.DeviceItemProfileID != product) {
		err = fmt.Errorf("invalid Product device write scope")
	}
	return out.Device, err
}
