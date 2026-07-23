package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/readinessfacts"
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
		name:    "operations_upstream_projection",
		sql: `
	ALTER TABLE operations ADD COLUMN upstream_operation_id TEXT;
	ALTER TABLE operations ADD COLUMN upstream_state TEXT;
	`,
	},
	{
		version: 4,
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
	{
		version: 5,
		name:    "brand_fleet_batch_jobs",
		sql: `
CREATE TABLE IF NOT EXISTS batch_jobs (
	id TEXT PRIMARY KEY,
	organization_id TEXT NOT NULL,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	created_by TEXT NOT NULL,
	scope_json TEXT NOT NULL,
	state TEXT NOT NULL,
	total INTEGER NOT NULL DEFAULT 0,
	completed INTEGER NOT NULL DEFAULT 0,
	failed INTEGER NOT NULL DEFAULT 0,
	skipped INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_org_updated ON batch_jobs (organization_id, updated_at DESC);
`,
	},
	{
		version: 6,
		name:    "batch_job_result",
		sql:     `ALTER TABLE batch_jobs ADD COLUMN result_json TEXT NOT NULL DEFAULT '[]';`,
	},
	{
		version: 7,
		name:    "batch_job_idempotency",
		sql: `ALTER TABLE batch_jobs ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_jobs_org_idempotency ON batch_jobs (organization_id, idempotency_key) WHERE idempotency_key <> '';`,
	},
	{
		version: 8,
		name:    "provisioning_sources",
		sql: `CREATE TABLE IF NOT EXISTS provisioning_sources (
	id TEXT PRIMARY KEY,
	organization_id TEXT NOT NULL,
	sku_id TEXT NOT NULL,
	production_run TEXT NOT NULL DEFAULT '',
	filename TEXT NOT NULL,
	checksum TEXT NOT NULL,
	row_count INTEGER NOT NULL,
	device_ids_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	idempotency_key TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provisioning_sources_org_idempotency ON provisioning_sources (organization_id, idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_provisioning_sources_org_expires ON provisioning_sources (organization_id, expires_at);`,
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
	INSERT OR IGNORE INTO operations (id, device_id, device_name, organization, type, state, message, updated_at, upstream_operation_id, upstream_state)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			op.ID, op.DeviceID, op.DeviceName, op.Organization, op.Type, string(op.State), op.Message, op.UpdatedAt, "", ""); err != nil {
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range devices {
		facts, err := s.sourceFactsForDevice(devices[i])
		if err != nil {
			return nil, err
		}
		devices[i].SourceFacts = facts
	}
	return devices, nil
}

func (s *Store) GetDevice(id string) (contracts.Device, error) {
	var d contracts.Device
	err := s.db.QueryRow(`
SELECT id, organization_id, organization, name, category, model, serial_number, video_cloud_devid, status, readiness, last_seen_at, updated_at
FROM devices
WHERE id = ?`, id).Scan(&d.ID, &d.OrganizationID, &d.Organization, &d.Name, &d.Category, &d.Model, &d.SerialNumber, &d.VideoCloudDevID, &d.Status, &d.Readiness, &d.LastSeenAt, &d.UpdatedAt)
	if err != nil {
		return d, err
	}
	d.SourceFacts, err = s.sourceFactsForDevice(d)
	return d, err
}

func (s *Store) ListOperations() ([]contracts.Operation, error) {
	rows, err := s.db.Query(`
	SELECT id, device_id, device_name, organization, type, state, message, updated_at, upstream_operation_id, upstream_state
	FROM operations
	ORDER BY updated_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ops []contracts.Operation
	for rows.Next() {
		var op contracts.Operation
		if err := rows.Scan(&op.ID, &op.DeviceID, &op.DeviceName, &op.Organization, &op.Type, &op.State, &op.Message, &op.UpdatedAt, &op.UpstreamOperationID, &op.UpstreamState); err != nil {
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

func (s *Store) UpdateSessionTokens(id, accessToken, refreshToken string, ttl time.Duration) error {
	expiresAt := time.Now().UTC().Add(ttl).Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE sessions SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?`, accessToken, refreshToken, expiresAt, id)
	return err
}

func (s *Store) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (s *Store) CreateBatchJob(job contracts.BatchJob) (contracts.BatchJob, error) {
	if job.ID == "" {
		job.ID = "job-" + randomHex(12)
	}
	if job.State == "" {
		job.State = "queued"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if job.CreatedAt == "" {
		job.CreatedAt = now
	}
	job.UpdatedAt = now
	scope, err := json.Marshal(job.Scope)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	result, err := json.Marshal(job.Result)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	_, err = s.db.Exec(`INSERT INTO batch_jobs (id, organization_id, type, name, created_by, scope_json, state, total, completed, failed, skipped, created_at, updated_at, result_json, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, job.ID, job.OrganizationID, job.Type, job.Name, job.CreatedBy, scope, job.State, job.Total, job.Completed, job.Failed, job.Skipped, job.CreatedAt, job.UpdatedAt, result, job.IdempotencyKey)
	return job, err
}

func (s *Store) CreateProvisioningSource(source contracts.ProvisioningSource, idempotencyKey string) (contracts.ProvisioningSource, error) {
	if source.ID == "" {
		source.ID = "source-" + randomHex(12)
	}
	if source.CreatedAt == "" {
		source.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if source.ExpiresAt == "" {
		source.ExpiresAt = time.Now().UTC().Add(7 * 24 * time.Hour).Format(time.RFC3339)
	}
	raw, err := json.Marshal(source.DeviceIDs)
	if err != nil {
		return contracts.ProvisioningSource{}, err
	}
	_, err = s.db.Exec(`INSERT INTO provisioning_sources (id, organization_id, sku_id, production_run, filename, checksum, row_count, device_ids_json, created_at, expires_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, source.ID, source.OrganizationID, source.SKU, source.ProductionRun, source.Filename, source.Checksum, source.RowCount, string(raw), source.CreatedAt, source.ExpiresAt, idempotencyKey)
	return source, err
}

func (s *Store) GetProvisioningSource(organizationID, id string) (contracts.ProvisioningSource, error) {
	return scanProvisioningSource(s.db.QueryRow(`SELECT id, organization_id, sku_id, production_run, filename, checksum, row_count, device_ids_json, created_at, expires_at FROM provisioning_sources WHERE organization_id = ? AND id = ?`, organizationID, id))
}

func (s *Store) GetProvisioningSourceByIdempotency(organizationID, key string) (contracts.ProvisioningSource, error) {
	return scanProvisioningSource(s.db.QueryRow(`SELECT id, organization_id, sku_id, production_run, filename, checksum, row_count, device_ids_json, created_at, expires_at FROM provisioning_sources WHERE organization_id = ? AND idempotency_key = ?`, organizationID, key))
}

func scanProvisioningSource(row rowScannerSQL) (contracts.ProvisioningSource, error) {
	var source contracts.ProvisioningSource
	var raw string
	if err := row.Scan(&source.ID, &source.OrganizationID, &source.SKU, &source.ProductionRun, &source.Filename, &source.Checksum, &source.RowCount, &raw, &source.CreatedAt, &source.ExpiresAt); err != nil {
		return contracts.ProvisioningSource{}, err
	}
	if err := json.Unmarshal([]byte(raw), &source.DeviceIDs); err != nil {
		return contracts.ProvisioningSource{}, err
	}
	return source, nil
}

func (s *Store) GetBatchJobByIdempotency(organizationID, key string) (contracts.BatchJob, error) {
	return scanBatchJob(s.db.QueryRow(`SELECT id, organization_id, type, name, created_by, scope_json, state, total, completed, failed, skipped, created_at, updated_at, result_json, idempotency_key FROM batch_jobs WHERE organization_id = ? AND idempotency_key = ?`, organizationID, key))
}

func (s *Store) ListBatchJobs(organizationID string, limit int) ([]contracts.BatchJob, error) {
	page, err := s.ListBatchJobsPage(organizationID, contracts.BatchJobQuery{Limit: limit})
	return page.Jobs, err
}

func (s *Store) ListBatchJobsPage(organizationID string, query contracts.BatchJobQuery) (contracts.BatchJobPage, error) {
	if query.Limit <= 0 || query.Limit > 250 {
		query.Limit = 100
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	where := []string{"organization_id = ?"}
	args := []any{organizationID}
	for _, filter := range []struct{ column, value string }{{"state", query.State}, {"type", query.Type}, {"created_by", query.CreatedBy}} {
		if strings.TrimSpace(filter.value) != "" {
			where = append(where, filter.column+" = ?")
			args = append(args, strings.TrimSpace(filter.value))
		}
	}
	if query.From != "" {
		where = append(where, "created_at >= ?")
		args = append(args, query.From)
	}
	if query.To != "" {
		where = append(where, "created_at <= ?")
		args = append(args, query.To)
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM batch_jobs WHERE "+clause, args...).Scan(&total); err != nil {
		return contracts.BatchJobPage{}, err
	}
	rows, err := s.db.Query("SELECT id, organization_id, type, name, created_by, scope_json, state, total, completed, failed, skipped, created_at, updated_at, result_json, idempotency_key FROM batch_jobs WHERE "+clause+" ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?", append(args, query.Limit, query.Offset)...)
	if err != nil {
		return contracts.BatchJobPage{}, err
	}
	defer rows.Close()
	jobs := []contracts.BatchJob{}
	for rows.Next() {
		job, err := scanBatchJob(rows)
		if err != nil {
			return contracts.BatchJobPage{}, err
		}
		jobs = append(jobs, job)
	}
	return contracts.BatchJobPage{Jobs: jobs, Total: total, Limit: query.Limit, Offset: query.Offset}, rows.Err()
}

func (s *Store) GetBatchJob(organizationID, id string) (contracts.BatchJob, error) {
	return scanBatchJob(s.db.QueryRow(`SELECT id, organization_id, type, name, created_by, scope_json, state, total, completed, failed, skipped, created_at, updated_at, result_json, idempotency_key FROM batch_jobs WHERE organization_id = ? AND id = ?`, organizationID, id))
}

func (s *Store) UpdateBatchJobState(organizationID, id, state string) (contracts.BatchJob, error) {
	if _, err := s.db.Exec(`UPDATE batch_jobs SET state = ?, updated_at = ? WHERE organization_id = ? AND id = ?`, state, time.Now().UTC().Format(time.RFC3339), organizationID, id); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, id)
}

func (s *Store) UpdateBatchJobProgress(organizationID, id, state string, completed, failed, skipped int) (contracts.BatchJob, error) {
	if _, err := s.db.Exec(`UPDATE batch_jobs SET state = ?, completed = ?, failed = ?, skipped = ?, updated_at = ? WHERE organization_id = ? AND id = ?`, state, completed, failed, skipped, time.Now().UTC().Format(time.RFC3339), organizationID, id); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, id)
}

func (s *Store) UpdateBatchJobScope(organizationID, id string, scope map[string]any) (contracts.BatchJob, error) {
	raw, err := json.Marshal(scope)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if _, err := s.db.Exec(`UPDATE batch_jobs SET scope_json = ?, updated_at = ? WHERE organization_id = ? AND id = ?`, string(raw), time.Now().UTC().Format(time.RFC3339), organizationID, id); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, id)
}

func (s *Store) UpdateBatchJobResult(organizationID, id string, result []map[string]any) (contracts.BatchJob, error) {
	raw, err := json.Marshal(result)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if _, err := s.db.Exec(`UPDATE batch_jobs SET result_json = ?, updated_at = ? WHERE organization_id = ? AND id = ?`, raw, time.Now().UTC().Format(time.RFC3339), organizationID, id); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, id)
}

type rowScannerSQL interface{ Scan(...any) error }

func scanBatchJob(row rowScannerSQL) (contracts.BatchJob, error) {
	var job contracts.BatchJob
	var rawScope, rawResult string
	if err := row.Scan(&job.ID, &job.OrganizationID, &job.Type, &job.Name, &job.CreatedBy, &rawScope, &job.State, &job.Total, &job.Completed, &job.Failed, &job.Skipped, &job.CreatedAt, &job.UpdatedAt, &rawResult, &job.IdempotencyKey); err != nil {
		return contracts.BatchJob{}, err
	}
	if err := json.Unmarshal([]byte(rawScope), &job.Scope); err != nil {
		return contracts.BatchJob{}, err
	}
	if err := json.Unmarshal([]byte(rawResult), &job.Result); err != nil {
		return contracts.BatchJob{}, err
	}
	job.Retryable = job.State == "failed" || job.State == "partial_failed"
	if created, err := time.Parse(time.RFC3339, job.CreatedAt); err == nil {
		if os.Getenv("E2E_RESULT_EXPIRED") == "true" {
			job.ExpiresAt = created.Add(-time.Hour).Format(time.RFC3339)
		} else {
			job.ExpiresAt = created.Add(7 * 24 * time.Hour).Format(time.RFC3339)
		}
		downloadStatus := "pending"
		switch job.State {
		case "completed", "partial_failed":
			downloadStatus = "ready"
		case "failed", "cancelled":
			downloadStatus = "unavailable"
		}
		job.ResultMetadata = map[string]any{"download_status": downloadStatus, "expires_at": job.ExpiresAt}
	}
	if value, ok := job.Scope["failure_reason"].(string); ok {
		job.FailureReason = value
	}
	return job, nil
}

func randomHex(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func (s *Store) CreateLifecycleOperation(deviceID, operationType string) (contracts.Operation, error) {
	return s.createLifecycleOperation(deviceID, operationType, "demo-platform-operator", operationType, "", "", "Published lifecycle command to account.video.commands demo queue", true)
}

func (s *Store) CreateUpstreamLifecycleOperation(deviceID, operationType, actor, upstreamOperationID, upstreamState, message string) (contracts.Operation, error) {
	return s.createLifecycleOperation(deviceID, operationType, actor, operationType+".completed", upstreamOperationID, upstreamState, message, true)
}

func (s *Store) CreateFailedUpstreamLifecycleOperation(deviceID, operationType, actor, message string) (contracts.Operation, error) {
	return s.createLifecycleOperation(deviceID, operationType, actor, operationType+".failed", "", string(contracts.OperationFailed), message, false)
}

func (s *Store) GetOpenLifecycleOperation(deviceID, operationType string) (contracts.Operation, bool, error) {
	var op contracts.Operation
	err := s.db.QueryRow(`
	SELECT id, device_id, device_name, organization, type, state, message, updated_at, upstream_operation_id, upstream_state
	FROM operations
	WHERE device_id = ? AND type = ? AND state != ?
	ORDER BY updated_at DESC, id DESC
	LIMIT 1`, deviceID, operationType, string(contracts.OperationSucceeded)).Scan(
		&op.ID, &op.DeviceID, &op.DeviceName, &op.Organization, &op.Type, &op.State, &op.Message, &op.UpdatedAt, &op.UpstreamOperationID, &op.UpstreamState,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return contracts.Operation{}, false, nil
		}
		return contracts.Operation{}, false, err
	}
	return op, true, nil
}

func (s *Store) createLifecycleOperation(deviceID, operationType, actor, auditAction, upstreamOperationID, upstreamState, message string, updateReadiness bool) (contracts.Operation, error) {
	device, err := s.GetDevice(deviceID)
	if err != nil {
		return contracts.Operation{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	nextReadiness := contracts.ReadinessCloudActivationPending
	operationState := mapOperationState(upstreamState)
	if operationType == "DeviceDeactivateRequested" {
		nextReadiness = contracts.ReadinessDeactivationPending
	}
	if message == "" {
		message = "Accepted by Account Manager."
	}
	if operationState == contracts.OperationFailed {
		updateReadiness = false
	}
	if operationType == "DeviceProvisionRequested" && operationState == contracts.OperationSucceeded {
		nextReadiness = contracts.ReadinessActivated
	}
	if operationType == "DeviceDeactivateRequested" && operationState == contracts.OperationSucceeded {
		nextReadiness = contracts.ReadinessDeactivated
	}

	op := contracts.Operation{
		ID:                  fallback(fmt.Sprintf("op-%d", time.Now().UTC().UnixNano()), ""),
		DeviceID:            device.ID,
		DeviceName:          device.Name,
		Organization:        device.Organization,
		Type:                operationType,
		State:               operationState,
		Message:             message,
		UpstreamOperationID: upstreamOperationID,
		UpstreamState:       upstreamState,
		UpdatedAt:           now,
	}
	if op.ID == "" {
		op.ID = fmt.Sprintf("op-%d", time.Now().UTC().UnixNano())
	}
	if upstreamOperationID != "" {
		op.ID = upstreamOperationID
	}
	if op.State == "" {
		op.State = contracts.OperationPublished
	}
	if op.UpdatedAt == "" {
		op.UpdatedAt = now
	}

	tx, err := s.db.Begin()
	if err != nil {
		return contracts.Operation{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
	INSERT INTO operations (id, device_id, device_name, organization, type, state, message, updated_at, upstream_operation_id, upstream_state)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		op.ID, op.DeviceID, op.DeviceName, op.Organization, op.Type, string(op.State), op.Message, op.UpdatedAt, op.UpstreamOperationID, op.UpstreamState); err != nil {
		return contracts.Operation{}, err
	}
	if updateReadiness {
		if _, err := tx.Exec(`UPDATE devices SET readiness = ?, updated_at = ? WHERE id = ?`, string(nextReadiness), now, device.ID); err != nil {
			return contracts.Operation{}, err
		}
	}
	if actor != "" {
		if err := s.insertAuditEvent(tx, actor, auditAction, device.ID, now); err != nil {
			return contracts.Operation{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return contracts.Operation{}, err
	}
	return op, nil
}

func mapOperationState(state string) contracts.OperationState {
	switch contracts.OperationState(state) {
	case contracts.OperationPending, contracts.OperationPublished, contracts.OperationSucceeded, contracts.OperationFailed, contracts.OperationRetrying, contracts.OperationDeadLettered:
		return contracts.OperationState(state)
	default:
		return contracts.OperationPublished
	}
}

func fallback(value, fallbackValue string) string {
	if value != "" {
		return value
	}
	return fallbackValue
}

func (s *Store) sourceFactsForDevice(device contracts.Device) ([]contracts.SourceFact, error) {
	latest, err := s.latestOperationForDevice(device.ID)
	if err != nil {
		return nil, err
	}
	return readinessfacts.Build(device, latest, nil), nil
}

func (s *Store) latestOperationForDevice(deviceID string) (*contracts.Operation, error) {
	var op contracts.Operation
	err := s.db.QueryRow(`
	SELECT id, device_id, device_name, organization, type, state, message, updated_at
	FROM operations
	WHERE device_id = ?
	ORDER BY updated_at DESC, id DESC
	LIMIT 1`, deviceID).Scan(&op.ID, &op.DeviceID, &op.DeviceName, &op.Organization, &op.Type, &op.State, &op.Message, &op.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &op, nil
}
