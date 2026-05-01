package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"rtk_cloud_admin/internal/contracts"
)

type Store struct {
	db *sql.DB
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
	_, err := s.db.Exec(`
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
`)
	return err
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
SELECT id, actor, action, target, created_at
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
		if err := rows.Scan(&event.ID, &event.Actor, &event.Action, &event.Target, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) insertAuditEvent(tx *sql.Tx, actor, action, target, createdAt string) error {
	_, err := tx.Exec(`
INSERT INTO audit_events (actor, action, target, created_at)
VALUES (?, ?, ?, ?)`, actor, action, target, createdAt)
	return err
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
