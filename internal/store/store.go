package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"

	"rtk_cloud_admin/internal/contracts"
)

type Store struct {
	db *sql.DB
}

type Session struct {
	ID           string
	Kind         string
	Subject      string
	Email        string
	AccessToken  string
	RefreshToken string
	ActiveOrgID  string
	ExpiresAt    string
	CreatedAt    string
}

type PlatformAdmin struct {
	ID        string
	Email     string
	Role      string
	CreatedAt string
}

type AuditEventInput struct {
	Actor               string
	ActorKind           string
	Action              string
	Target              string
	OrganizationID      string
	Result              string
	RequestID           string
	UpstreamOperationID string
	CreatedAt           string
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Migrate() error {
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL
);`); err != nil {
		return err
	}

	for _, migration := range migrations {
		var applied int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, migration.version).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migration.sql); err != nil {
			_ = tx.Rollback()
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, migration.version, migration.name, time.Now().UTC().Format(time.RFC3339)); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

type migration struct {
	version int
	name    string
	sql     string
}

var migrations = []migration{
	{
		version: 1,
		name:    "base_console_projection",
		sql: `
CREATE TABLE IF NOT EXISTS devices (
	id TEXT PRIMARY KEY,
	organization_id TEXT NOT NULL,
	organization TEXT NOT NULL,
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	model TEXT NOT NULL,
	serial_number TEXT NOT NULL,
	video_cloud_devid TEXT NOT NULL,
	status TEXT NOT NULL,
	readiness TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
	id TEXT PRIMARY KEY,
	device_id TEXT NOT NULL,
	device_name TEXT NOT NULL,
	organization TEXT NOT NULL,
	type TEXT NOT NULL,
	state TEXT NOT NULL,
	message TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	actor TEXT NOT NULL,
	action TEXT NOT NULL,
	target TEXT NOT NULL,
	created_at TEXT NOT NULL
);
`,
	},
	{
		version: 2,
		name:    "auth_sessions_platform_admins",
		sql: `
CREATE TABLE IF NOT EXISTS platform_admins (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	subject TEXT NOT NULL,
	email TEXT NOT NULL,
	access_token TEXT NOT NULL,
	refresh_token TEXT NOT NULL,
	active_org_id TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);
`,
	},
	{
		version: 3,
		name:    "cache_settings_audit_metadata",
		sql: `
CREATE TABLE IF NOT EXISTS upstream_organizations (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	role TEXT NOT NULL,
	source TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS upstream_devices (
	id TEXT PRIMARY KEY,
	organization_id TEXT NOT NULL,
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	model TEXT NOT NULL,
	serial_number TEXT NOT NULL,
	video_cloud_devid TEXT NOT NULL,
	status TEXT NOT NULL,
	readiness TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	source TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS upstream_operations (
	id TEXT PRIMARY KEY,
	device_id TEXT NOT NULL,
	organization_id TEXT NOT NULL,
	type TEXT NOT NULL,
	state TEXT NOT NULL,
	message TEXT NOT NULL,
	source TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readiness_facts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	device_id TEXT NOT NULL,
	organization_id TEXT NOT NULL,
	layer TEXT NOT NULL,
	state TEXT NOT NULL,
	detail TEXT NOT NULL,
	retryable INTEGER NOT NULL DEFAULT 0,
	error_code TEXT NOT NULL DEFAULT '',
	operation_id TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL,
	fetched_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(device_id, layer)
);
CREATE TABLE IF NOT EXISTS integration_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	source TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upstream_devices_org ON upstream_devices (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_upstream_operations_device ON upstream_operations (device_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_readiness_facts_device ON readiness_facts (device_id, layer);
ALTER TABLE audit_events ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'operator';
ALTER TABLE audit_events ADD COLUMN organization_id TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN result TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE audit_events ADD COLUMN request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN upstream_operation_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_upstream_operation ON audit_events (upstream_operation_id);
`,
	},
}

func (s *Store) AppliedMigrations() ([]int, error) {
	rows, err := s.db.Query(`SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var versions []int
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func (s *Store) SeedDemoData() error {
	now := time.Now().UTC().Format(time.RFC3339)
	devices := []contracts.Device{
		{ID: "dev-001", OrganizationID: "org-acme", Organization: "Acme Smart Camera", Name: "cam-a-001", Category: "ip_camera", Model: "RTK-CAM-A", SerialNumber: "ACME-A-001", VideoCloudDevID: "device-1", Status: "online", Readiness: contracts.ReadinessOnline, LastSeenAt: now, UpdatedAt: now},
		{ID: "dev-002", OrganizationID: "org-acme", Organization: "Acme Smart Camera", Name: "cam-a-002", Category: "ip_camera", Model: "RTK-CAM-A", SerialNumber: "ACME-A-002", VideoCloudDevID: "device-2", Status: "offline", Readiness: contracts.ReadinessActivated, LastSeenAt: "2026-05-01T04:12:00Z", UpdatedAt: now},
		{ID: "dev-003", OrganizationID: "org-nova", Organization: "Nova Home Labs", Name: "doorbell-lab-07", Category: "ip_camera", Model: "RTK-BELL-2", SerialNumber: "NOVA-D-007", VideoCloudDevID: "device-7", Status: "unknown", Readiness: contracts.ReadinessCloudActivationPending, LastSeenAt: "", UpdatedAt: now},
		{ID: "dev-004", OrganizationID: "org-nova", Organization: "Nova Home Labs", Name: "factory-line-mqtt", Category: "mqtt_device", Model: "RTK-MQTT-EDGE", SerialNumber: "NOVA-M-114", VideoCloudDevID: "mqtt-114", Status: "disabled", Readiness: contracts.ReadinessFailed, LastSeenAt: "2026-04-30T22:45:00Z", UpdatedAt: now},
	}
	for _, d := range devices {
		if _, err := s.db.Exec(`
INSERT OR IGNORE INTO devices (id, organization_id, organization, name, category, model, serial_number, video_cloud_devid, status, readiness, last_seen_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.ID, d.OrganizationID, d.Organization, d.Name, d.Category, d.Model, d.SerialNumber, d.VideoCloudDevID, d.Status, string(d.Readiness), d.LastSeenAt, d.UpdatedAt); err != nil {
			return err
		}
	}

	operations := []contracts.Operation{
		{ID: "op-001", DeviceID: "dev-003", DeviceName: "doorbell-lab-07", Organization: "Nova Home Labs", Type: "DeviceProvisionRequested", State: contracts.OperationPublished, Message: "Waiting for DeviceProvisionSucceeded from video.account.events", UpdatedAt: now},
		{ID: "op-002", DeviceID: "dev-004", DeviceName: "factory-line-mqtt", Organization: "Nova Home Labs", Type: "DeviceProvisionRequested", State: contracts.OperationFailed, Message: "subject mapping rejected: video_cloud_devid mismatch", UpdatedAt: now},
	}
	for _, op := range operations {
		if _, err := s.db.Exec(`
INSERT OR IGNORE INTO operations (id, device_id, device_name, organization, type, state, message, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			op.ID, op.DeviceID, op.DeviceName, op.Organization, op.Type, string(op.State), op.Message, op.UpdatedAt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListDevices() ([]contracts.Device, error) {
	rows, err := s.db.Query(`
SELECT id, organization_id, organization, name, category, model, serial_number, video_cloud_devid, status, readiness, last_seen_at, updated_at
FROM devices
ORDER BY organization, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []contracts.Device
	for rows.Next() {
		var d contracts.Device
		if err := rows.Scan(&d.ID, &d.OrganizationID, &d.Organization, &d.Name, &d.Category, &d.Model, &d.SerialNumber, &d.VideoCloudDevID, &d.Status, &d.Readiness, &d.LastSeenAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

func (s *Store) GetDevice(id string) (contracts.Device, error) {
	var d contracts.Device
	err := s.db.QueryRow(`
SELECT id, organization_id, organization, name, category, model, serial_number, video_cloud_devid, status, readiness, last_seen_at, updated_at
FROM devices
WHERE id = ?`, id).Scan(&d.ID, &d.OrganizationID, &d.Organization, &d.Name, &d.Category, &d.Model, &d.SerialNumber, &d.VideoCloudDevID, &d.Status, &d.Readiness, &d.LastSeenAt, &d.UpdatedAt)
	return d, err
}

func (s *Store) ListOperations() ([]contracts.Operation, error) {
	rows, err := s.db.Query(`
SELECT id, device_id, device_name, organization, type, state, message, updated_at
FROM operations
ORDER BY updated_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ops []contracts.Operation
	for rows.Next() {
		var op contracts.Operation
		if err := rows.Scan(&op.ID, &op.DeviceID, &op.DeviceName, &op.Organization, &op.Type, &op.State, &op.Message, &op.UpdatedAt); err != nil {
			return nil, err
		}
		ops = append(ops, op)
	}
	return ops, rows.Err()
}

func (s *Store) Summary() (contracts.Summary, error) {
	devices, err := s.ListDevices()
	if err != nil {
		return contracts.Summary{}, err
	}
	ops, err := s.ListOperations()
	if err != nil {
		return contracts.Summary{}, err
	}
	seenOrgs := map[string]bool{}
	var summary contracts.Summary
	summary.TotalDevices = len(devices)
	for _, d := range devices {
		seenOrgs[d.OrganizationID] = true
		switch d.Readiness {
		case contracts.ReadinessOnline:
			summary.OnlineDevices++
			summary.ActivatedDevices++
		case contracts.ReadinessActivated:
			summary.ActivatedDevices++
		case contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
			summary.PendingDevices++
		case contracts.ReadinessFailed:
			summary.FailedDevices++
		}
	}
	for _, op := range ops {
		if op.State != contracts.OperationSucceeded {
			summary.OpenOperations++
		}
	}
	summary.Customers = len(seenOrgs)
	return summary, nil
}

func (s *Store) ListCustomers() ([]contracts.CustomerSummary, error) {
	devices, err := s.ListDevices()
	if err != nil {
		return nil, err
	}

	byOrg := map[string]*contracts.CustomerSummary{}
	order := []string{}
	for _, device := range devices {
		customer, ok := byOrg[device.OrganizationID]
		if !ok {
			customer = &contracts.CustomerSummary{
				OrganizationID: device.OrganizationID,
				Organization:   device.Organization,
			}
			byOrg[device.OrganizationID] = customer
			order = append(order, device.OrganizationID)
		}
		customer.TotalDevices++
		switch device.Readiness {
		case contracts.ReadinessOnline:
			customer.OnlineDevices++
			customer.ActivatedDevices++
		case contracts.ReadinessActivated:
			customer.ActivatedDevices++
		case contracts.ReadinessCloudActivationPending, contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessDeactivationPending:
			customer.PendingDevices++
		case contracts.ReadinessFailed:
			customer.FailedDevices++
		}
		if device.LastSeenAt > customer.LastSeenAt {
			customer.LastSeenAt = device.LastSeenAt
		}
	}

	customers := make([]contracts.CustomerSummary, 0, len(order))
	for _, orgID := range order {
		customers = append(customers, *byOrg[orgID])
	}
	return customers, nil
}

func (s *Store) ListAuditEvents() ([]contracts.AuditEvent, error) {
	rows, err := s.db.Query(`
SELECT id, actor, actor_kind, action, target, organization_id, result, request_id, upstream_operation_id, created_at
FROM audit_events
ORDER BY created_at DESC, id DESC
LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []contracts.AuditEvent{}
	for rows.Next() {
		var event contracts.AuditEvent
		if err := rows.Scan(&event.ID, &event.Actor, &event.ActorKind, &event.Action, &event.Target, &event.OrganizationID, &event.Result, &event.RequestID, &event.UpstreamOperationID, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) insertAuditEvent(tx *sql.Tx, actor, action, target, createdAt string) error {
	_, err := tx.Exec(`
INSERT INTO audit_events (actor, actor_kind, action, target, organization_id, result, request_id, upstream_operation_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, actor, "demo", action, target, "", "accepted", "", "", createdAt)
	return err
}

func (s *Store) CreateAuditEvent(actor, action, target string) error {
	return s.CreateAuditEventWithMetadata(AuditEventInput{
		Actor:     actor,
		ActorKind: "operator",
		Action:    action,
		Target:    target,
		Result:    "accepted",
	})
}

func (s *Store) CreateAuditEventWithMetadata(input AuditEventInput) error {
	if input.ActorKind == "" {
		input.ActorKind = "operator"
	}
	if input.Result == "" {
		input.Result = "accepted"
	}
	if input.CreatedAt == "" {
		input.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := s.db.Exec(`
INSERT INTO audit_events (actor, actor_kind, action, target, organization_id, result, request_id, upstream_operation_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Actor, input.ActorKind, input.Action, input.Target, input.OrganizationID, input.Result, input.RequestID, input.UpstreamOperationID, input.CreatedAt)
	return err
}

func (s *Store) BootstrapPlatformAdmin(email, password string) error {
	if email == "" || password == "" {
		return nil
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM platform_admins WHERE email = ?`, email).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.Exec(`
INSERT INTO platform_admins (id, email, password_hash, role, created_at)
VALUES (?, ?, ?, ?, ?)`, "admin-"+randomHex(12), email, string(hash), "platform_admin", now)
	return err
}

func (s *Store) VerifyPlatformAdmin(email, password string) (PlatformAdmin, error) {
	var admin PlatformAdmin
	var hash string
	err := s.db.QueryRow(`
SELECT id, email, password_hash, role, created_at
FROM platform_admins
WHERE email = ?`, email).Scan(&admin.ID, &admin.Email, &hash, &admin.Role, &admin.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$000000000000000000000O4vRLXwD8C6VJpygDgMMtFdQFb7MCcfu"), []byte(password))
		}
		return PlatformAdmin{}, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return PlatformAdmin{}, err
	}
	return admin, nil
}

func (s *Store) CreateSession(kind, subject, email, accessToken, refreshToken, activeOrgID string, ttl time.Duration) (Session, error) {
	now := time.Now().UTC()
	session := Session{
		ID:           "sess-" + randomHex(24),
		Kind:         kind,
		Subject:      subject,
		Email:        email,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ActiveOrgID:  activeOrgID,
		ExpiresAt:    now.Add(ttl).Format(time.RFC3339),
		CreatedAt:    now.Format(time.RFC3339),
	}
	_, err := s.db.Exec(`
INSERT INTO sessions (id, kind, subject, email, access_token, refresh_token, active_org_id, expires_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.ID, session.Kind, session.Subject, session.Email, session.AccessToken, session.RefreshToken, session.ActiveOrgID, session.ExpiresAt, session.CreatedAt)
	return session, err
}

func (s *Store) GetSession(id string) (Session, error) {
	var session Session
	err := s.db.QueryRow(`
SELECT id, kind, subject, email, access_token, refresh_token, active_org_id, expires_at, created_at
FROM sessions
WHERE id = ?`, id).Scan(&session.ID, &session.Kind, &session.Subject, &session.Email, &session.AccessToken, &session.RefreshToken, &session.ActiveOrgID, &session.ExpiresAt, &session.CreatedAt)
	if err != nil {
		return Session{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339, session.ExpiresAt)
	if err != nil {
		return Session{}, err
	}
	if !expiresAt.After(time.Now().UTC()) {
		_ = s.DeleteSession(id)
		return Session{}, sql.ErrNoRows
	}
	return session, nil
}

func (s *Store) UpdateSessionActiveOrg(id, orgID string) error {
	_, err := s.db.Exec(`UPDATE sessions SET active_org_id = ? WHERE id = ?`, orgID, id)
	return err
}

func (s *Store) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func randomHex(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func (s *Store) CreateLifecycleOperation(deviceID, operationType string) (contracts.Operation, error) {
	device, err := s.GetDevice(deviceID)
	if err != nil {
		return contracts.Operation{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	nextReadiness := contracts.ReadinessCloudActivationPending
	message := "Published lifecycle command to account.video.commands demo queue"
	if operationType == "DeviceDeactivateRequested" {
		nextReadiness = contracts.ReadinessDeactivationPending
		message = "Published deactivation command to account.video.commands demo queue"
	}

	op := contracts.Operation{
		ID:           fmt.Sprintf("op-%d", time.Now().UTC().UnixNano()),
		DeviceID:     device.ID,
		DeviceName:   device.Name,
		Organization: device.Organization,
		Type:         operationType,
		State:        contracts.OperationPublished,
		Message:      message,
		UpdatedAt:    now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return contracts.Operation{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
INSERT INTO operations (id, device_id, device_name, organization, type, state, message, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		op.ID, op.DeviceID, op.DeviceName, op.Organization, op.Type, string(op.State), op.Message, op.UpdatedAt); err != nil {
		return contracts.Operation{}, err
	}
	if _, err := tx.Exec(`UPDATE devices SET readiness = ?, updated_at = ? WHERE id = ?`, string(nextReadiness), now, device.ID); err != nil {
		return contracts.Operation{}, err
	}
	if err := s.insertAuditEvent(tx, "demo-platform-operator", operationType, device.ID, now); err != nil {
		return contracts.Operation{}, err
	}
	if err := tx.Commit(); err != nil {
		return contracts.Operation{}, err
	}
	return op, nil
}
