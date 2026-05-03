package videoclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 6 * time.Second,
		},
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

func (c *Client) Health(ctx context.Context) error {
	if !c.Enabled() {
		return fmt.Errorf("video cloud base URL is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json, text/plain")
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

// QueryActivation returns a map from device ID to whether it is activated in
// Video Cloud. devids must be non-empty. Any device ID not present in the
// response is treated as not activated.
func (c *Client) QueryActivation(ctx context.Context, adminToken string, devids []string) (map[string]bool, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("video cloud base URL is not configured")
	}
	body, err := json.Marshal(map[string]any{"devices": devids})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/query_camera_activate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("query_camera_activate status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var result struct {
		Status  string   `json:"status"`
		Devices []string `json:"devices"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("query_camera_activate parse: %w", err)
	}
	out := make(map[string]bool, len(devids))
	for i, id := range devids {
		if i < len(result.Devices) {
			out[id] = result.Devices[i] == "1"
		}
	}
	return out, nil
}

// GetCameraInfo returns the current transport type for a single device.
// Returns an empty string if the transport is unknown.
func (c *Client) GetCameraInfo(ctx context.Context, adminToken, devid string) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("video cloud base URL is not configured")
	}
	body, err := json.Marshal(map[string]string{"devid": devid})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/get_camera_info", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("get_camera_info status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var result struct {
		Status string `json:"status"`
		Info   struct {
			CurrentTransport string `json:"current_transport"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", fmt.Errorf("get_camera_info parse: %w", err)
	}
	return result.Info.CurrentTransport, nil
}
