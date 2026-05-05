package videoclient

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

type DeviceInfo struct {
	FirmwareVersion  string
	CurrentTransport string
}

type DeviceTelemetryResponse struct {
	Status          string                  `json:"status"`
	OrgID           string                  `json:"org_id"`
	DeviceID        string                  `json:"device_id"`
	AccountDeviceID string                  `json:"account_device_id"`
	DeviceName      string                  `json:"device_name"`
	LatestHealth    *DeviceTelemetryHealth  `json:"latest_health"`
	RSSIHistory     []DeviceTelemetryRSSI   `json:"rssi_history"`
	UptimeHistory   []DeviceTelemetryUptime `json:"uptime_history"`
	RecentEvents    []DeviceTelemetryEvent  `json:"recent_events"`
}

type DeviceTelemetryHealth struct {
	State      string          `json:"state"`
	UptimeSec  *int64          `json:"uptime_seconds,omitempty"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

type DeviceTelemetryRSSI struct {
	OccurredAt time.Time `json:"occurred_at"`
	RSSIDBm    *int      `json:"rssi_dbm,omitempty"`
	Quality    string    `json:"quality,omitempty"`
}

type DeviceTelemetryUptime struct {
	OccurredAt time.Time `json:"occurred_at"`
	UptimeSec  int64     `json:"uptime_seconds"`
}

type DeviceTelemetryEvent struct {
	EventID    string          `json:"event_id"`
	EventType  string          `json:"event_type"`
	OccurredAt time.Time       `json:"occurred_at"`
	Source     string          `json:"source"`
	Payload    json.RawMessage `json:"payload,omitempty"`
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

func (c *Client) doJSON(ctx context.Context, method, path, adminToken string, in any, out any) error {
	if !c.Enabled() {
		return fmt.Errorf("video cloud base URL is not configured")
	}
	var body io.Reader = bytes.NewReader(nil)
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if adminToken != "" {
		req.Header.Set("Authorization", "Bearer "+adminToken)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		if len(data) > 0 {
			return fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
		}
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return err
	}
	return nil
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
	info, err := c.GetDeviceInfo(ctx, adminToken, devid)
	if err != nil {
		return "", err
	}
	return info.CurrentTransport, nil
}

func (c *Client) GetDeviceInfo(ctx context.Context, adminToken, devid string) (DeviceInfo, error) {
	if !c.Enabled() {
		return DeviceInfo{}, fmt.Errorf("video cloud base URL is not configured")
	}
	body, err := json.Marshal(map[string]string{"devid": devid})
	if err != nil {
		return DeviceInfo{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/get_camera_info", bytes.NewReader(body))
	if err != nil {
		return DeviceInfo{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return DeviceInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DeviceInfo{}, fmt.Errorf("get_camera_info status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return DeviceInfo{}, err
	}
	var result struct {
		Status string         `json:"status"`
		Info   map[string]any `json:"info"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return DeviceInfo{}, fmt.Errorf("get_camera_info parse: %w", err)
	}
	info := DeviceInfo{}
	if value, ok := result.Info["current_transport"].(string); ok {
		info.CurrentTransport = strings.TrimSpace(value)
	}
	if value, ok := result.Info["firmware_version"].(string); ok {
		info.FirmwareVersion = strings.TrimSpace(value)
	}
	return info, nil
}

func (c *Client) DeviceTelemetry(ctx context.Context, adminToken, devid, orgID string) (DeviceTelemetryResponse, error) {
	if !c.Enabled() {
		return DeviceTelemetryResponse{}, fmt.Errorf("video cloud base URL is not configured")
	}
	path := "/api/devices/" + url.PathEscape(devid) + "/telemetry"
	if strings.TrimSpace(orgID) != "" {
		path += "?org_id=" + url.QueryEscape(orgID)
	}
	var out DeviceTelemetryResponse
	if err := c.doJSON(ctx, http.MethodGet, path, adminToken, nil, &out); err != nil {
		return DeviceTelemetryResponse{}, err
	}
	return out, nil
}
