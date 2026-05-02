package accountclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type Organization struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type Device struct {
	ID              string         `json:"id"`
	OrganizationID  string         `json:"organization_id"`
	Organization    string         `json:"organization"`
	Name            string         `json:"name"`
	Category        string         `json:"category"`
	Model           string         `json:"model"`
	SerialNumber    string         `json:"serial_number"`
	VideoCloudDevID string         `json:"video_cloud_devid"`
	Status          string         `json:"status"`
	Readiness       string         `json:"readiness"`
	LastSeenAt      string         `json:"last_seen_at"`
	UpdatedAt       string         `json:"updated_at"`
	Metadata        map[string]any `json:"metadata"`
}

type Operation struct {
	ID        string `json:"id"`
	State     string `json:"state"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
}

type Tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    string `json:"expires_at"`
}

type LoginResult struct {
	User   User   `json:"user"`
	Tokens Tokens `json:"tokens"`
}

type RefreshResult struct {
	Tokens Tokens `json:"tokens"`
}

type MeResult struct {
	User          User           `json:"user"`
	Organizations []Organization `json:"organizations"`
}

type HTTPError struct {
	Method     string
	Path       string
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("upstream %s %s returned %d: %s", e.Method, e.Path, e.StatusCode, e.Body)
	}
	return fmt.Sprintf("upstream %s %s returned %d", e.Method, e.Path, e.StatusCode)
}

func New(baseURL string) *Client {
	return NewWithHTTPClient(baseURL, &http.Client{Timeout: 6 * time.Second})
}

func NewWithHTTPClient(baseURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 6 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: httpClient,
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

func (c *Client) Login(ctx context.Context, email, password string) (LoginResult, error) {
	var out LoginResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/login", "", map[string]string{
		"email":    email,
		"password": password,
	}, &out)
	return out, err
}

func (c *Client) Refresh(ctx context.Context, refreshToken string) (RefreshResult, error) {
	var out RefreshResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/refresh", "", map[string]string{
		"refresh_token": refreshToken,
	}, &out)
	return out, err
}

func (c *Client) Me(ctx context.Context, accessToken string) (MeResult, error) {
	var out MeResult
	err := c.doJSON(ctx, http.MethodGet, "/v1/me", accessToken, nil, &out)
	return out, err
}

func (c *Client) Organizations(ctx context.Context, accessToken string) ([]Organization, error) {
	var body struct {
		Organizations []Organization `json:"organizations"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/orgs", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Organizations, nil
}

func (c *Client) Devices(ctx context.Context, accessToken, orgID string) ([]Device, error) {
	var body struct {
		Devices []Device `json:"devices"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/orgs/"+url.PathEscape(orgID)+"/devices", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Devices, nil
}

func (c *Client) Provision(ctx context.Context, accessToken, orgID, deviceID string) (Operation, error) {
	return c.lifecycle(ctx, accessToken, orgID, deviceID, "provision")
}

func (c *Client) Deactivate(ctx context.Context, accessToken, orgID, deviceID string) (Operation, error) {
	return c.lifecycle(ctx, accessToken, orgID, deviceID, "deactivate")
}

func (c *Client) lifecycle(ctx context.Context, accessToken, orgID, deviceID, action string) (Operation, error) {
	var body struct {
		Operation Operation `json:"operation"`
		ID        string    `json:"id"`
		State     string    `json:"state"`
		Message   string    `json:"message"`
		UpdatedAt string    `json:"updated_at"`
	}
	path := fmt.Sprintf("/v1/orgs/%s/devices/%s/%s", url.PathEscape(orgID), url.PathEscape(deviceID), action)
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, map[string]string{}, &body); err != nil {
		return Operation{}, err
	}
	if body.Operation.ID != "" {
		return body.Operation, nil
	}
	return Operation{ID: body.ID, State: body.State, Message: body.Message, UpdatedAt: body.UpdatedAt}, nil
}

func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) doJSON(ctx context.Context, method, path, token string, in any, out any) error {
	if !c.Enabled() {
		return fmt.Errorf("account manager base URL is not configured")
	}
	var body *bytes.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return &HTTPError{
			Method:     method,
			Path:       path,
			StatusCode: resp.StatusCode,
			Body:       strings.TrimSpace(string(body)),
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
