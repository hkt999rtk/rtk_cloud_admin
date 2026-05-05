package contracts

type ReadinessState string

const (
	ReadinessRegistered             ReadinessState = "registered"
	ReadinessClaimPending           ReadinessState = "claim_pending"
	ReadinessLocalOnboardingPending ReadinessState = "local_onboarding_pending"
	ReadinessCloudActivationPending ReadinessState = "cloud_activation_pending"
	ReadinessActivated              ReadinessState = "activated"
	ReadinessOnline                 ReadinessState = "online"
	ReadinessFailed                 ReadinessState = "failed"
	ReadinessDeactivationPending    ReadinessState = "deactivation_pending"
	ReadinessDeactivated            ReadinessState = "deactivated"
)

type OperationState string

const (
	OperationPending      OperationState = "pending"
	OperationPublished    OperationState = "published"
	OperationSucceeded    OperationState = "succeeded"
	OperationFailed       OperationState = "failed"
	OperationRetrying     OperationState = "retrying"
	OperationDeadLettered OperationState = "dead_lettered"
)

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
	Readiness       ReadinessState `json:"readiness"`
	SourceFacts     []SourceFact   `json:"source_facts"`
	LastSeenAt      string         `json:"last_seen_at"`
	UpdatedAt       string         `json:"updated_at"`
}

type SourceFact struct {
	Layer       string `json:"layer"`
	State       string `json:"state"`
	Detail      string `json:"detail"`
	Retryable   bool   `json:"retryable"`
	ErrorCode   string `json:"error_code,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

type Operation struct {
	ID                  string         `json:"id"`
	DeviceID            string         `json:"device_id"`
	DeviceName          string         `json:"device_name"`
	Organization        string         `json:"organization"`
	Type                string         `json:"type"`
	State               OperationState `json:"state"`
	UpstreamOperationID string         `json:"upstream_operation_id,omitempty"`
	UpstreamState       string         `json:"upstream_state,omitempty"`
	Message             string         `json:"message"`
	UpdatedAt           string         `json:"updated_at"`
}

type Summary struct {
	TotalDevices     int `json:"total_devices"`
	OnlineDevices    int `json:"online_devices"`
	ActivatedDevices int `json:"activated_devices"`
	PendingDevices   int `json:"pending_devices"`
	FailedDevices    int `json:"failed_devices"`
	OpenOperations   int `json:"open_operations"`
	Customers        int `json:"customers"`
}

type CustomerSummary struct {
	OrganizationID   string `json:"organization_id"`
	Organization     string `json:"organization"`
	TotalDevices     int    `json:"total_devices"`
	OnlineDevices    int    `json:"online_devices"`
	ActivatedDevices int    `json:"activated_devices"`
	PendingDevices   int    `json:"pending_devices"`
	FailedDevices    int    `json:"failed_devices"`
	LastSeenAt       string `json:"last_seen_at"`
}

type ServiceHealth struct {
	Name          string `json:"name"`
	Status        string `json:"status"`
	Detail        string `json:"detail"`
	LatencyMillis int64  `json:"latency_ms,omitempty"`
	LastCheckedAt string `json:"last_checked_at,omitempty"`
}

type Membership struct {
	OrganizationID string `json:"organization_id"`
	Organization   string `json:"organization"`
	Role           string `json:"role"`
}

type Me struct {
	UserID        string       `json:"user_id"`
	Email         string       `json:"email"`
	Name          string       `json:"name"`
	Kind          string       `json:"kind"`
	Memberships   []Membership `json:"memberships"`
	ActiveOrgID   string       `json:"active_org_id"`
	DemoMode      bool         `json:"demo_mode"`
	Authenticated bool         `json:"authenticated"`
}

type AuditEvent struct {
	ID                  int64  `json:"id"`
	Actor               string `json:"actor"`
	ActorKind           string `json:"actor_kind"`
	Action              string `json:"action"`
	Target              string `json:"target"`
	OrganizationID      string `json:"organization_id,omitempty"`
	Result              string `json:"result"`
	RequestID           string `json:"request_id,omitempty"`
	UpstreamOperationID string `json:"upstream_operation_id,omitempty"`
	CreatedAt           string `json:"created_at"`
}

type TelemetryRssiSample struct {
	Date    string `json:"date"`
	AvgDBM  int    `json:"avg_dbm"`
	Quality string `json:"quality"`
}

type TelemetryUptimeSample struct {
	Date      string  `json:"date"`
	OnlinePct float64 `json:"online_pct"`
}

type TelemetryEvent struct {
	OccurredAt string `json:"occurred_at"`
	EventType  string `json:"event_type"`
	Summary    string `json:"summary"`
}

type DeviceTelemetry struct {
	DeviceID        string                  `json:"device_id"`
	DeviceName      string                  `json:"device_name,omitempty"`
	Organization    string                  `json:"organization,omitempty"`
	SerialNumber    string                  `json:"serial_number,omitempty"`
	Model           string                  `json:"model,omitempty"`
	LastSeenAt      string                  `json:"last_seen_at,omitempty"`
	Health          string                  `json:"health"`
	Signals         []string                `json:"signals"`
	FirmwareVersion string                  `json:"firmware_version"`
	RSSI7D          []TelemetryRssiSample   `json:"rssi_7d"`
	Uptime7D        []TelemetryUptimeSample `json:"uptime_7d"`
	RecentEvents    []TelemetryEvent        `json:"recent_events"`
}

type FleetHealthCurrent struct {
	Healthy  int `json:"healthy"`
	Warning  int `json:"warning"`
	Critical int `json:"critical"`
	Unknown  int `json:"unknown"`
}

type FleetHealthTrendPoint struct {
	Date          string  `json:"date"`
	OnlinePct     float64 `json:"online_pct"`
	WarningCount  int     `json:"warning_count"`
	CriticalCount int     `json:"critical_count"`
}

type FleetHealthSummary struct {
	OrgID           string                  `json:"org_id"`
	Current         FleetHealthCurrent      `json:"current"`
	OnlineRate7dPct float64                 `json:"online_rate_7d_pct"`
	Trend           []FleetHealthTrendPoint `json:"trend"`
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

type FirmwareDistributionVersion struct {
	Version  string  `json:"version"`
	Count    int     `json:"count"`
	Pct      float64 `json:"pct"`
	IsLatest bool    `json:"is_latest"`
}

type FirmwareDistributionRollout struct {
	DeviceID       string `json:"device_id"`
	DeviceName     string `json:"device_name"`
	CurrentVersion string `json:"current_version"`
	TargetVersion  string `json:"target_version"`
	RolloutStatus  string `json:"rollout_status"`
	FailureReason  string `json:"failure_reason,omitempty"`
	LastUpdated    string `json:"last_updated,omitempty"`
}

type FirmwareDistributionCampaign struct {
	CampaignID    string                        `json:"campaign_id"`
	TargetVersion string                        `json:"target_version"`
	Policy        string                        `json:"policy"`
	State         string                        `json:"state"`
	Applied       int                           `json:"applied"`
	Pending       int                           `json:"pending"`
	Failed        int                           `json:"failed"`
	Skipped       int                           `json:"skipped"`
	Total         int                           `json:"total"`
	StartedAt     string                        `json:"started_at"`
	Rollouts      []FirmwareDistributionRollout `json:"rollouts,omitempty"`
}

type FirmwareDistribution struct {
	OrgID     string                         `json:"org_id"`
	Versions  []FirmwareDistributionVersion  `json:"versions"`
	Campaigns []FirmwareDistributionCampaign `json:"campaigns"`
}
