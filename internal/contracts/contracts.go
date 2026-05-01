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
	LastSeenAt      string         `json:"last_seen_at"`
	UpdatedAt       string         `json:"updated_at"`
}

type Operation struct {
	ID           string         `json:"id"`
	DeviceID     string         `json:"device_id"`
	DeviceName   string         `json:"device_name"`
	Organization string         `json:"organization"`
	Type         string         `json:"type"`
	State        OperationState `json:"state"`
	Message      string         `json:"message"`
	UpdatedAt    string         `json:"updated_at"`
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
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type AuditEvent struct {
	ID        int64  `json:"id"`
	Actor     string `json:"actor"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	CreatedAt string `json:"created_at"`
}
