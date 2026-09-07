package sdkportalclient

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Only fixed Portal API paths are reachable. Browser-supplied firmware URLs are
// never fetched by the server.
func (c *Client) ExamplesRequest(ctx context.Context, method, version string, form url.Values, sessionID string) ([]byte, int, error) {
	if c == nil {
		return nil, 503, errors.New("Portal unavailable")
	}
	u := *c.baseURL
	u.Path = "/api/pro2-examples/catalog"
	var body io.Reader
	if method == http.MethodPost {
		u.Path = "/api/pro2-examples/download"
		body = strings.NewReader(form.Encode())
	} else {
		u.RawQuery = url.Values{"version": {version}}.Encode()
	}
	req, e := http.NewRequestWithContext(ctx, method, u.String(), body)
	if e != nil {
		return nil, 503, e
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		// Correlate terms acceptance without forwarding the authentication cookie or token.
		if sessionID != "" {
			digest := sha256.Sum256([]byte("pro2-download:" + sessionID))
			req.AddCookie(&http.Cookie{Name: "rtk_sdk_session", Value: hex.EncodeToString(digest[:])})
		}
	}
	res, e := c.http.Do(req)
	if e != nil {
		return nil, 503, e
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return b, res.StatusCode, e
}
