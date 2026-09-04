package accountclient

import (
	"context"
	"encoding/json"
	"net/url"
)

func (c *Client) TestLabManage(ctx context.Context, token, cloud, path, method string, body any) (json.RawMessage, error) {
	var out json.RawMessage
	target := "/v1/developer/brand-clouds/" + url.PathEscape(cloud) + "/test-lab/" + path
	if method == "DELETE" {
		return nil, c.doJSON(ctx, method, target, token, body, nil)
	}
	err := c.doJSON(ctx, method, target, token, body, &out)
	return out, err
}

func (c *Client) TestLab(ctx context.Context, token, cloud, session, action, method string, body any) (json.RawMessage, error) {
	path := "/v1/developer/brand-clouds/" + url.PathEscape(cloud) + "/test-lab/sessions"
	if session != "" {
		path += "/" + url.PathEscape(session)
	}
	if action != "" {
		path += "/" + action
	}
	var out json.RawMessage
	if method == "DELETE" {
		return nil, c.doJSON(ctx, method, path, token, body, nil)
	}
	err := c.doJSON(ctx, method, path, token, body, &out)
	return out, err
}
