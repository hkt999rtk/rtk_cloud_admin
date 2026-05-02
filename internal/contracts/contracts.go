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
