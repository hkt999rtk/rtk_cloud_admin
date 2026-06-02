package app

import (
	"time"

	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

type sessionStore interface {
	CreateSession(kind, subject, email, accessToken, refreshToken, activeOrgID string, ttl time.Duration) (store.Session, error)
	GetSession(id string) (store.Session, error)
	UpdateSessionActiveOrg(id, orgID string) error
	UpdateSessionTokens(id, accessToken, refreshToken string, ttl time.Duration) error
	DeleteSession(id string) error
}

type platformAdminStore interface {
	VerifyPlatformAdmin(email, password string) (store.PlatformAdmin, error)
}

type auditStore interface {
	ListAuditEvents() ([]contracts.AuditEvent, error)
	CreateAuditEvent(actor, action, target string) error
	CreateAuditEventWithMetadata(input store.AuditEventInput) error
}

type projectionStore interface {
	Summary() (contracts.Summary, error)
	ListCustomers() ([]contracts.CustomerSummary, error)
	ListDevices() ([]contracts.Device, error)
	GetDevice(id string) (contracts.Device, error)
	ListOperations() ([]contracts.Operation, error)
}

type lifecycleOperationStore interface {
	CreateLifecycleOperation(deviceID, operationType string) (contracts.Operation, error)
	CreateUpstreamLifecycleOperation(deviceID, operationType, actor, upstreamOperationID, upstreamState, message string) (contracts.Operation, error)
	CreateFailedUpstreamLifecycleOperation(deviceID, operationType, actor, message string) (contracts.Operation, error)
	GetOpenLifecycleOperation(deviceID, operationType string) (contracts.Operation, bool, error)
}

var (
	_ sessionStore            = (*store.Store)(nil)
	_ platformAdminStore      = (*store.Store)(nil)
	_ auditStore              = (*store.Store)(nil)
	_ projectionStore         = (*store.Store)(nil)
	_ lifecycleOperationStore = (*store.Store)(nil)
)
