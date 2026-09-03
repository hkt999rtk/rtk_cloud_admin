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

	"rtk_cloud_admin/internal/correlation"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type HTTPStatusError struct {
	StatusCode int
	Body       string
}

type OTAResponse struct {
	StatusCode int
	Body       []byte
	Header     http.Header
}

type OTAConfig struct {
	SystemMaxRateLimitPerMinute int `json:"system_max_rate_limit_per_minute"`
	DefaultRateLimitPerMinute   int `json:"default_rate_limit_per_minute"`
}

type OTACampaignRecord struct {
	ID                  string `json:"campaign_id"`
	ProductID           string `json:"product_id"`
	ReleaseID           string `json:"release_id"`
	Name                string `json:"name,omitempty"`
	State               string `json:"state"`
	TargetSnapshotCount int    `json:"target_snapshot_count"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
	ActivatedAt         string `json:"activated_at,omitempty"`
	RateLimitPerMinute  int    `json:"rate_limit_per_minute"`
	EffectiveRateLimit  int    `json:"effective_rate_limit_per_minute"`
	SystemMaxRateLimit  int    `json:"system_max_rate_limit_per_minute"`
}

type OTAReleaseRecord struct {
	ID      string `json:"release_id"`
	Version string `json:"version"`
}

type OTADeploymentRecord struct {
	DeviceID       string `json:"device_id"`
	Status         string `json:"status"`
	CurrentVersion string `json:"current_version,omitempty"`
	TargetVersion  string `json:"target_version,omitempty"`
	ErrorReason    string `json:"error_reason,omitempty"`
	UpdatedAt      string `json:"updated_at"`
}

type OTACampaignSummary struct {
	CampaignID string         `json:"campaign_id"`
	State      string         `json:"state"`
	Total      int            `json:"total"`
	ByStatus   map[string]int `json:"by_status"`
	UpdatedAt  string         `json:"updated_at"`
}

func (e HTTPStatusError) Error() string {
	if strings.TrimSpace(e.Body) != "" {
		return fmt.Sprintf("status %d: %s", e.StatusCode, strings.TrimSpace(e.Body))
	}
	return fmt.Sprintf("status %d", e.StatusCode)
}

type DeviceInfo struct {
	FirmwareVersion  string
	CurrentTransport string
}

type FirmwareRelease struct {
	Version string `json:"version"`
	Model   string `json:"model,omitempty"`
}

type FirmwareRolloutRecord struct {
	DeviceID        string `json:"device_id"`
	AccountDeviceID string `json:"account_device_id,omitempty"`
	DeviceName      string `json:"device_name,omitempty"`
	Model           string `json:"model,omitempty"`
	CampaignID      string `json:"campaign_id,omitempty"`
	TargetVersion   string `json:"target_version,omitempty"`
	CurrentVersion  string `json:"current_version,omitempty"`
	RolloutStatus   string `json:"rollout_status,omitempty"`
	Status          string `json:"status,omitempty"`
	Reason          string `json:"reason,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
	LastUpdated     string `json:"last_updated,omitempty"`
}

type FirmwareRolloutResponse struct {
	Status   string                  `json:"status"`
	Model    string                  `json:"model"`
	Target   string                  `json:"target,omitempty"`
	Rollouts []FirmwareRolloutRecord `json:"rollouts,omitempty"`
}

type FirmwareCampaignPolicy struct {
	Name        string `json:"name"`
	StartAt     string `json:"start_at,omitempty"`
	EndAt       string `json:"end_at,omitempty"`
	TimeZone    string `json:"time_zone,omitempty"`
	WindowStart string `json:"window_start,omitempty"`
	WindowEnd   string `json:"window_end,omitempty"`
}

type FirmwareCampaignRecord struct {
	ID            string                 `json:"id"`
	CampaignID    string                 `json:"campaign_id,omitempty"`
	Model         string                 `json:"model"`
	TargetVersion string                 `json:"target_version"`
	Policy        FirmwareCampaignPolicy `json:"policy"`
	State         string                 `json:"state"`
	CreatedAt     string                 `json:"created_at"`
	UpdatedAt     string                 `json:"updated_at"`
}

type FirmwareCampaignResponse struct {
	Status    string                   `json:"status"`
	Campaigns []FirmwareCampaignRecord `json:"campaigns,omitempty"`
	Campaign  *FirmwareCampaignRecord  `json:"campaign,omitempty"`
}

type FirmwareEnumResponse struct {
	Status   string            `json:"status"`
	Versions []string          `json:"versions,omitempty"`
	Releases []FirmwareRelease `json:"releases,omitempty"`
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

type FleetStreamStatsMode struct {
	Requests       int     `json:"requests"`
	SuccessRatePct float64 `json:"success_rate_pct"`
}

type FleetStreamTrendPoint struct {
	Date           string  `json:"date"`
	Requests       int     `json:"requests"`
	SuccessRatePct float64 `json:"success_rate_pct"`
}

type FleetStreamWorstDevice struct {
	DeviceID       string  `json:"device_id"`
	DeviceName     string  `json:"device_name"`
	ModeUsed       string  `json:"mode_used"`
	Readiness      string  `json:"readiness"`
	SuccessRatePct float64 `json:"success_rate_pct"`
	Requests       int     `json:"requests"`
	LastStreamAt   string  `json:"last_stream_at,omitempty"`
}

type FleetStreamModeTrend struct {
	Mode   string                  `json:"mode"`
	Points []FleetStreamTrendPoint `json:"points"`
}

type FleetStreamStats struct {
	OrgID              string                          `json:"org_id"`
	Window             string                          `json:"window"`
	SuccessRatePct     float64                         `json:"success_rate_pct"`
	AvgDurationSeconds float64                         `json:"avg_duration_seconds"`
	ActiveSessions     int                             `json:"active_sessions"`
	NeverStreamedCount int                             `json:"never_streamed_count"`
	ByMode             map[string]FleetStreamStatsMode `json:"by_mode"`
	Trend              []FleetStreamTrendPoint         `json:"trend"`
	TrendByMode        []FleetStreamModeTrend          `json:"trend_by_mode"`
	WorstDevices       []FleetStreamWorstDevice        `json:"worst_devices"`
}

type FleetHealthDistribution struct {
	Healthy  int `json:"healthy"`
	Warning  int `json:"warning"`
	Critical int `json:"critical"`
	Unknown  int `json:"unknown"`
}

type FleetHealthTrendPoint struct {
	Date     string `json:"date"`
	Healthy  int    `json:"healthy"`
	Warning  int    `json:"warning"`
	Critical int    `json:"critical"`
	Unknown  int    `json:"unknown"`
}

type FleetHealthSummary struct {
	OrgID           string                  `json:"org_id"`
	SourceStatus    string                  `json:"source_status"`
	SourceFreshness string                  `json:"source_freshness"`
	SourceMessage   string                  `json:"source_message"`
	Distribution    FleetHealthDistribution `json:"distribution"`
	Trend7D         []FleetHealthTrendPoint `json:"trend_7d"`
	Trend30D        []FleetHealthTrendPoint `json:"trend_30d"`
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
	correlation.ApplyHeaders(ctx, req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return HTTPStatusError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(data))}
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

// DoOTA forwards one canonical operator OTA request while preserving the typed
// upstream response. brandCloudID is resolved by the BFF from the active
// Account Manager organization; it is never copied from the browser body.
func (c *Client) DoOTA(ctx context.Context, method, path, adminToken, brandCloudID, idempotencyKey string, body []byte) (OTAResponse, error) {
	if !c.Enabled() {
		return OTAResponse{}, fmt.Errorf("video cloud base URL is not configured")
	}
	if !strings.HasPrefix(path, "/v1/ota/") {
		return OTAResponse{}, fmt.Errorf("invalid OTA path")
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return OTAResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if adminToken != "" {
		req.Header.Set("Authorization", "Bearer "+adminToken)
	}
	req.Header.Set("X-Brand-Cloud-ID", strings.TrimSpace(brandCloudID))
	if strings.TrimSpace(idempotencyKey) != "" {
		req.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	}
	correlation.ApplyHeaders(ctx, req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return OTAResponse{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return OTAResponse{}, err
	}
	return OTAResponse{StatusCode: resp.StatusCode, Body: raw, Header: resp.Header.Clone()}, nil
}

func (c *Client) OTAConfig(ctx context.Context, adminToken, brandCloudID string) (OTAConfig, error) {
	response, err := c.DoOTA(ctx, http.MethodGet, "/v1/ota/config", adminToken, brandCloudID, "", nil)
	if err != nil {
		return OTAConfig{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return OTAConfig{}, HTTPStatusError{StatusCode: response.StatusCode, Body: string(response.Body)}
	}
	var config OTAConfig
	if err := json.Unmarshal(response.Body, &config); err != nil {
		return OTAConfig{}, err
	}
	return config, nil
}

func (c *Client) ListOTACampaigns(ctx context.Context, adminToken, brandCloudID, productID string) ([]OTACampaignRecord, error) {
	return fetchOTAPage[OTACampaignRecord](ctx, c, "/v1/ota/products/"+url.PathEscape(strings.TrimSpace(productID))+"/campaigns", adminToken, brandCloudID)
}

func (c *Client) ListOTAReleases(ctx context.Context, adminToken, brandCloudID, productID string) ([]OTAReleaseRecord, error) {
	return fetchOTAPage[OTAReleaseRecord](ctx, c, "/v1/ota/products/"+url.PathEscape(strings.TrimSpace(productID))+"/releases", adminToken, brandCloudID)
}

func (c *Client) ListOTADeployments(ctx context.Context, adminToken, brandCloudID, campaignID string) ([]OTADeploymentRecord, error) {
	return fetchOTAPage[OTADeploymentRecord](ctx, c, "/v1/ota/campaigns/"+url.PathEscape(strings.TrimSpace(campaignID))+"/deployments", adminToken, brandCloudID)
}

func (c *Client) GetOTACampaignSummary(ctx context.Context, adminToken, brandCloudID, campaignID string) (OTACampaignSummary, error) {
	response, err := c.DoOTA(ctx, http.MethodGet, "/v1/ota/campaigns/"+url.PathEscape(strings.TrimSpace(campaignID))+"/summary", adminToken, brandCloudID, "", nil)
	if err != nil {
		return OTACampaignSummary{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return OTACampaignSummary{}, HTTPStatusError{StatusCode: response.StatusCode, Body: string(response.Body)}
	}
	var summary OTACampaignSummary
	if err := json.Unmarshal(response.Body, &summary); err != nil {
		return OTACampaignSummary{}, err
	}
	return summary, nil
}

func fetchOTAPage[T any](ctx context.Context, c *Client, path, adminToken, brandCloudID string) ([]T, error) {
	items := make([]T, 0)
	cursor := ""
	for {
		pagePath := path + "?page_size=200"
		if cursor != "" {
			pagePath += "&cursor=" + url.QueryEscape(cursor)
		}
		response, err := c.DoOTA(ctx, http.MethodGet, pagePath, adminToken, brandCloudID, "", nil)
		if err != nil {
			return nil, err
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, HTTPStatusError{StatusCode: response.StatusCode, Body: string(response.Body)}
		}
		var page struct {
			Items      []T    `json:"items"`
			NextCursor string `json:"next_cursor"`
		}
		if err := json.Unmarshal(response.Body, &page); err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if strings.TrimSpace(page.NextCursor) == "" || page.NextCursor == cursor {
			return items, nil
		}
		cursor = page.NextCursor
	}
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
	correlation.ApplyHeaders(ctx, req)
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
	correlation.ApplyHeaders(ctx, req)
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
	correlation.ApplyHeaders(ctx, req)
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

func (c *Client) EnumFirmware(ctx context.Context, adminToken, model string) (FirmwareEnumResponse, error) {
	if !c.Enabled() {
		return FirmwareEnumResponse{}, fmt.Errorf("video cloud base URL is not configured")
	}
	var out FirmwareEnumResponse
	if err := c.doJSON(ctx, http.MethodPost, "/enum_firmware", adminToken, map[string]string{"model": model}, &out); err != nil {
		return FirmwareEnumResponse{}, err
	}
	return out, nil
}

func (c *Client) QueryFirmwareRollout(ctx context.Context, adminToken, model, campaignID string) (FirmwareRolloutResponse, error) {
	if !c.Enabled() {
		return FirmwareRolloutResponse{}, fmt.Errorf("video cloud base URL is not configured")
	}
	req := map[string]string{"model": model}
	if strings.TrimSpace(campaignID) != "" {
		req["campaign_id"] = strings.TrimSpace(campaignID)
	}
	var out FirmwareRolloutResponse
	if err := c.doJSON(ctx, http.MethodPost, "/query_firmware_rollout", adminToken, req, &out); err != nil {
		return FirmwareRolloutResponse{}, err
	}
	return out, nil
}

func (c *Client) QueryFirmwareCampaigns(ctx context.Context, adminToken, model string, includeArchived bool) ([]FirmwareCampaignRecord, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("video cloud base URL is not configured")
	}
	req := map[string]any{"model": model}
	if includeArchived {
		req["include_archived"] = true
	}
	var out FirmwareCampaignResponse
	if err := c.doJSON(ctx, http.MethodPost, "/query_firmware_campaign", adminToken, req, &out); err != nil {
		return nil, err
	}
	if out.Campaign != nil {
		return []FirmwareCampaignRecord{*out.Campaign}, nil
	}
	return out.Campaigns, nil
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

func (c *Client) FleetStreamStats(ctx context.Context, adminToken, orgID, window string, devices []string) (FleetStreamStats, error) {
	if !c.Enabled() {
		return FleetStreamStats{}, fmt.Errorf("video cloud base URL is not configured")
	}
	q := url.Values{}
	if strings.TrimSpace(orgID) != "" {
		q.Set("org_id", strings.TrimSpace(orgID))
	}
	if strings.TrimSpace(window) != "" {
		q.Set("window", strings.TrimSpace(window))
	}
	cleanDevices := make([]string, 0, len(devices))
	for _, device := range devices {
		if trimmed := strings.TrimSpace(device); trimmed != "" {
			cleanDevices = append(cleanDevices, trimmed)
		}
	}
	if len(cleanDevices) > 0 {
		q.Set("devices", strings.Join(cleanDevices, ","))
	}
	path := "/api/fleet/stream-stats"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out FleetStreamStats
	if err := c.doJSON(ctx, http.MethodGet, path, adminToken, nil, &out); err != nil {
		return FleetStreamStats{}, err
	}
	return out, nil
}

func (c *Client) FleetHealthSummary(ctx context.Context, adminToken, orgID string) (FleetHealthSummary, error) {
	if !c.Enabled() {
		return FleetHealthSummary{}, fmt.Errorf("video cloud base URL is not configured")
	}
	path := "/api/fleet/health-summary?org_id=" + url.QueryEscape(strings.TrimSpace(orgID))
	var out FleetHealthSummary
	if err := c.doJSON(ctx, http.MethodGet, path, adminToken, nil, &out); err != nil {
		return FleetHealthSummary{}, err
	}
	return out, nil
}
