package accountclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
)

func (c *Client) pkiRequest(ctx context.Context, method, path, token, key string, in any) (int, []byte, error) {
	var body []byte
	var err error
	if in != nil {
		body, err = json.Marshal(in)
		if err != nil {
			return 0, nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	client := *c.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return 0, nil, fmt.Errorf("PKI response unavailable")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, nil, &HTTPError{StatusCode: resp.StatusCode, Method: method, Path: path, Body: "PKI request rejected; verify recent MFA, roles, approvals, and issuer state"}
	}
	return resp.StatusCode, raw, nil
}

var pkiPath = regexp.MustCompile(`^/(issuers|operations)(/search|/[0-9a-f-]{36}(/(operations|approvals|cancel|provision|import|activate|execute|reconcile|crl|revocation-complete|reconcile-replacement|reconcile-factory))?)?$`)
var pkiProvider = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

func (c *Client) PKI(ctx context.Context, token, method, path, key string, body json.RawMessage) (json.RawMessage, error) {
	if !pkiPath.MatchString(path) || (method != "POST" && method != "GET") {
		return nil, fmt.Errorf("invalid PKI route")
	}
	var in any
	if len(body) > 0 {
		in = body
	}
	status, raw, err := c.pkiRequest(ctx, method, "/v1/platform/pki"+path, token, key, in)
	if err != nil {
		return nil, err
	}
	if status == 204 {
		return json.RawMessage(`null`), nil
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("invalid PKI response")
	}
	return json.RawMessage(raw), nil
}

func (c *Client) StartPKIOIDC(ctx context.Context, provider string) (string, string, error) {
	if !pkiProvider.MatchString(provider) {
		return "", "", fmt.Errorf("invalid provider")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/auth/oidc/"+provider+"/login?pki_step_up=true", nil)
	if err != nil {
		return "", "", err
	}
	client := *c.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 302 {
		return "", "", fmt.Errorf("PKI step-up is unavailable")
	}
	location := resp.Header.Get("Location")
	u, err := url.Parse(location)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Query().Get("state") == "" {
		return "", "", fmt.Errorf("invalid OIDC redirect")
	}
	return location, u.Query().Get("state"), nil
}

func (c *Client) CompletePKIOIDC(ctx context.Context, provider, code, state string) (LoginResult, error) {
	var result LoginResult
	if !pkiProvider.MatchString(provider) {
		return result, fmt.Errorf("invalid provider")
	}
	query := url.Values{"code": {code}, "state": {state}}
	err := c.doJSON(ctx, "GET", "/v1/auth/oidc/"+provider+"/callback?"+query.Encode(), "", nil, &result)
	return result, err
}
