package store

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/contracts"
)

func TestStoreInitializesWithSeedData(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	devices, err := st.ListDevices()
	if err != nil {
		t.Fatalf("ListDevices returned error: %v", err)
	}
	if len(devices) < 3 {
		t.Fatalf("device count = %d, want at least 3", len(devices))
	}
	if devices[0].Readiness == "" {
		t.Fatalf("first device readiness is empty")
	}
	acmeOnline := deviceByID(t, devices, "dev-001")
	if len(acmeOnline.SourceFacts) != 3 {
		t.Fatalf("dev-001 source facts = %d, want 3", len(acmeOnline.SourceFacts))
	}
	if acmeOnline.SourceFacts[0].State != "present" || acmeOnline.SourceFacts[1].State != "present" || acmeOnline.SourceFacts[2].State != "present" {
		t.Fatalf("dev-001 source facts = %#v", acmeOnline.SourceFacts)
	}
	failed := deviceByID(t, devices, "dev-004")
	if failed.SourceFacts[1].State != "failed" {
		t.Fatalf("dev-004 cloud activation state = %q, want failed", failed.SourceFacts[1].State)
	}
	if failed.SourceFacts[1].OperationID == "" {
		t.Fatalf("dev-004 cloud activation missing operation id: %#v", failed.SourceFacts[1])
	}
	if failed.SourceFacts[1].ErrorCode == "" {
		t.Fatalf("dev-004 cloud activation missing error code: %#v", failed.SourceFacts[1])
	}

	ops, err := st.ListOperations()
	if err != nil {
		t.Fatalf("ListOperations returned error: %v", err)
	}
	if len(ops) < 2 {
		t.Fatalf("operation count = %d, want at least 2", len(ops))
	}

	auditEvents, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	if auditEvents == nil {
		t.Fatalf("audit events = nil, want empty slice")
	}
	if len(auditEvents) != 0 {
		t.Fatalf("audit event count = %d, want 0", len(auditEvents))
	}

	customers, err := st.ListCustomers()
	if err != nil {
		t.Fatalf("ListCustomers returned error: %v", err)
	}
	if len(customers) != 2 {
		t.Fatalf("customer count = %d, want 2", len(customers))
	}
	if customers[0].OrganizationID != "org-acme" {
		t.Fatalf("first customer org = %q, want org-acme", customers[0].OrganizationID)
	}
	if customers[0].TotalDevices != 2 {
		t.Fatalf("org-acme devices = %d, want 2", customers[0].TotalDevices)
	}
	if customers[1].FailedDevices != 1 {
		t.Fatalf("org-nova failed devices = %d, want 1", customers[1].FailedDevices)
	}
}

func TestBatchJobsPersistByOrganizationAndCanRetry(t *testing.T) {
	st, err := Open(t.TempDir() + "/jobs.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	job, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "org-a", Type: "report_export", Name: "設備報表", CreatedBy: "ops@example.com", Scope: map[string]any{"sku_id": "sku-1"}, Total: 42, IdempotencyKey: "report-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if job.State != "queued" || job.ID == "" {
		t.Fatalf("unexpected created job: %+v", job)
	}
	replayed, err := st.GetBatchJobByIdempotency("org-a", "report-key-1")
	if err != nil || replayed.ID != job.ID {
		t.Fatalf("unexpected idempotency lookup: %+v, %v", replayed, err)
	}
	if _, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "org-a", Type: "report_export", Name: "重複報表", CreatedBy: "ops@example.com", Scope: map[string]any{}, IdempotencyKey: "report-key-1"}); err == nil {
		t.Fatal("expected duplicate idempotency key to fail")
	}
	listed, err := st.ListBatchJobs("org-a", 10)
	if err != nil || len(listed) != 1 || listed[0].Scope["sku_id"] != "sku-1" {
		t.Fatalf("unexpected job list: %+v, %v", listed, err)
	}
	if _, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "org-a", Type: "device_provision", Name: "Provision", CreatedBy: "release@example.com", Scope: map[string]any{}, State: "failed"}); err != nil {
		t.Fatal(err)
	}
	page, err := st.ListBatchJobsPage("org-a", contracts.BatchJobQuery{Limit: 1, State: "failed", CreatedBy: "release@example.com"})
	if err != nil || page.Total != 1 || len(page.Jobs) != 1 || page.Jobs[0].Type != "device_provision" {
		t.Fatalf("unexpected filtered job page: %+v, %v", page, err)
	}
	if _, err := st.UpdateBatchJobState("org-a", job.ID, "running"); err != nil {
		t.Fatal(err)
	}
	updated, err := st.UpdateBatchJobScope("org-a", job.ID, map[string]any{"snapshot_ids": []string{"device-1", "device-2"}, "snapshot_at": "2026-07-11T00:00:00Z"})
	if err != nil || len(updated.Scope["snapshot_ids"].([]any)) != 2 {
		t.Fatalf("unexpected immutable scope update: %+v, %v", updated.Scope, err)
	}
	if _, err := st.GetBatchJob("org-b", job.ID); err == nil {
		t.Fatal("expected cross-organization job lookup to fail")
	}
}

func TestMigrateTracksVersionsAndIsIdempotent(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.Migrate(); err != nil {
		t.Fatalf("second Migrate returned error: %v", err)
	}
	versions, err := st.AppliedMigrations()
	if err != nil {
		t.Fatalf("AppliedMigrations returned error: %v", err)
	}
	if len(versions) != len(migrations) {
		t.Fatalf("versions = %#v, want %d migrations", versions, len(migrations))
	}
	for _, table := range []string{
		"upstream_organizations",
		"upstream_devices",
		"upstream_operations",
		"readiness_facts",
		"integration_settings",
	} {
		assertTableExists(t, st, table)
	}
	assertColumnExists(t, st, "audit_events", "actor_kind")
	assertColumnExists(t, st, "audit_events", "organization_id")
	assertColumnExists(t, st, "audit_events", "result")
	assertColumnExists(t, st, "audit_events", "request_id")
	assertColumnExists(t, st, "audit_events", "upstream_operation_id")
}

func TestMigrateUpgradesVersionTwoSchemaWithoutDataLoss(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	applyMigrationFixture(t, st, migrations[0])
	applyMigrationFixture(t, st, migrations[1])
	if _, err := st.db.Exec(`
INSERT INTO devices (id, organization_id, organization, name, category, model, serial_number, video_cloud_devid, status, readiness, last_seen_at, updated_at)
VALUES ('dev-upgrade', 'org-upgrade', 'Upgrade Org', 'camera-upgrade', 'ip_camera', 'RTK-CAM', 'SERIAL-1', 'video-upgrade', 'online', 'online', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
INSERT INTO audit_events (actor, action, target, created_at)
VALUES ('operator@example.com', 'DeviceProvisionRequested', 'dev-upgrade', '2026-05-01T00:00:00Z');
`); err != nil {
		t.Fatalf("seed v2 fixture: %v", err)
	}

	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}

	var deviceCount int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE id = 'dev-upgrade'`).Scan(&deviceCount); err != nil {
		t.Fatalf("count upgraded devices: %v", err)
	}
	if deviceCount != 1 {
		t.Fatalf("device count = %d, want 1", deviceCount)
	}

	auditEvents, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	if len(auditEvents) != 1 {
		t.Fatalf("audit event count = %d, want 1", len(auditEvents))
	}
	if auditEvents[0].ActorKind != "operator" || auditEvents[0].Result != "accepted" {
		t.Fatalf("audit defaults after upgrade = %#v", auditEvents[0])
	}
	assertTableExists(t, st, "upstream_devices")
	assertTableExists(t, st, "readiness_facts")
}

func TestSessions(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}

	session, err := st.CreateSession("platform_admin", "admin-1", "admin@example.com", "admin-access", "admin-refresh", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	got, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if got.Email != "admin@example.com" || got.Kind != "platform_admin" || got.AccessToken != "admin-access" {
		t.Fatalf("session = %#v", got)
	}

	expired, err := st.CreateSession("customer", "u1", "user@example.com", "token", "", "org-1", -time.Hour)
	if err != nil {
		t.Fatalf("CreateSession expired returned error: %v", err)
	}
	if _, err := st.GetSession(expired.ID); err != sql.ErrNoRows {
		t.Fatalf("expired GetSession err = %v, want sql.ErrNoRows", err)
	}
}

func TestCreateLifecycleOperationUpdatesDeviceReadiness(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	op, err := st.CreateLifecycleOperation("dev-002", "DeviceDeactivateRequested")
	if err != nil {
		t.Fatalf("CreateLifecycleOperation returned error: %v", err)
	}
	if op.DeviceID != "dev-002" {
		t.Fatalf("operation device = %q, want dev-002", op.DeviceID)
	}
	if op.Type != "DeviceDeactivateRequested" {
		t.Fatalf("operation type = %q, want DeviceDeactivateRequested", op.Type)
	}
	if op.State != "published" {
		t.Fatalf("operation state = %q, want published", op.State)
	}

	device, err := st.GetDevice("dev-002")
	if err != nil {
		t.Fatalf("GetDevice returned error: %v", err)
	}
	if device.Readiness != "deactivation_pending" {
		t.Fatalf("device readiness = %q, want deactivation_pending", device.Readiness)
	}

	auditEvents, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	if len(auditEvents) != 1 {
		t.Fatalf("audit event count = %d, want 1", len(auditEvents))
	}
	if auditEvents[0].Action != "DeviceDeactivateRequested" {
		t.Fatalf("audit action = %q, want DeviceDeactivateRequested", auditEvents[0].Action)
	}
	if auditEvents[0].Target != "dev-002" {
		t.Fatalf("audit target = %q, want dev-002", auditEvents[0].Target)
	}
	if auditEvents[0].ActorKind != "demo" {
		t.Fatalf("audit actor kind = %q, want demo", auditEvents[0].ActorKind)
	}
	if auditEvents[0].Result != "accepted" {
		t.Fatalf("audit result = %q, want accepted", auditEvents[0].Result)
	}
}

func TestCreateAuditEventWithMetadata(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}

	err = st.CreateAuditEventWithMetadata(AuditEventInput{
		Actor:               "admin@example.com",
		ActorKind:           "platform_admin",
		Action:              "DeviceProvisionRequested.completed",
		Target:              "dev-001",
		OrganizationID:      "org-acme",
		Result:              "accepted",
		RequestID:           "req-001",
		UpstreamOperationID: "op-upstream-001",
		CreatedAt:           "2026-05-01T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateAuditEventWithMetadata returned error: %v", err)
	}

	events, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("audit event count = %d, want 1", len(events))
	}
	event := events[0]
	if event.ActorKind != "platform_admin" || event.OrganizationID != "org-acme" || event.Result != "accepted" || event.RequestID != "req-001" || event.UpstreamOperationID != "op-upstream-001" {
		t.Fatalf("audit metadata = %#v", event)
	}
}

func TestSummarySessionsFailedOperationsAndAuditWrapper(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	summary, err := st.Summary()
	if err != nil {
		t.Fatalf("Summary returned error: %v", err)
	}
	if summary.TotalDevices != 4 || summary.Customers != 2 || summary.OnlineDevices != 1 || summary.ActivatedDevices != 2 || summary.PendingDevices != 1 || summary.FailedDevices != 1 || summary.OpenOperations != 2 {
		t.Fatalf("summary = %#v", summary)
	}

	session, err := st.CreateSession("customer", "u1", "user@example.com", "access-1", "refresh-1", "org-acme", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if err := st.UpdateSessionActiveOrg(session.ID, "org-nova"); err != nil {
		t.Fatalf("UpdateSessionActiveOrg returned error: %v", err)
	}
	if err := st.UpdateSessionActiveOrg("missing-session", "org-acme"); err != nil {
		t.Fatalf("UpdateSessionActiveOrg missing session returned error: %v", err)
	}
	if err := st.UpdateSessionTokens(session.ID, "access-2", "refresh-2", 2*time.Hour); err != nil {
		t.Fatalf("UpdateSessionTokens returned error: %v", err)
	}
	if err := st.UpdateSessionTokens("missing-session", "access-x", "refresh-x", time.Hour); err != nil {
		t.Fatalf("UpdateSessionTokens missing session returned error: %v", err)
	}
	updated, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if updated.ActiveOrgID != "org-nova" || updated.AccessToken != "access-2" || updated.RefreshToken != "refresh-2" {
		t.Fatalf("updated session = %#v", updated)
	}

	failed, err := st.CreateFailedUpstreamLifecycleOperation("dev-002", "DeviceProvisionRequested", "user@example.com", "upstream rejected device")
	if err != nil {
		t.Fatalf("CreateFailedUpstreamLifecycleOperation returned error: %v", err)
	}
	if failed.State != contracts.OperationFailed || failed.UpstreamState != string(contracts.OperationFailed) || failed.UpstreamOperationID != "" {
		t.Fatalf("failed operation = %#v", failed)
	}
	if _, found, err := st.GetOpenLifecycleOperation("dev-002", "DeviceDeactivateRequested"); err != nil || found {
		t.Fatalf("GetOpenLifecycleOperation empty result found=%v err=%v", found, err)
	}
	device, err := st.GetDevice("dev-002")
	if err != nil {
		t.Fatalf("GetDevice returned error: %v", err)
	}
	if device.Readiness != contracts.ReadinessActivated {
		t.Fatalf("failed operation changed readiness to %q", device.Readiness)
	}

	if err := st.CreateAuditEvent("operator@example.com", "ManualReview", "dev-002"); err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}
	events, err := st.ListAuditEvents()
	if err != nil {
		t.Fatalf("ListAuditEvents returned error: %v", err)
	}
	found := false
	for _, event := range events {
		if event.Actor == "operator@example.com" && event.Action == "ManualReview" && event.Target == "dev-002" {
			found = true
			if event.ActorKind != "operator" || event.Result != "accepted" {
				t.Fatalf("audit wrapper defaults = %#v", event)
			}
		}
	}
	if !found {
		t.Fatalf("manual audit event not found in %#v", events)
	}
}

func applyMigrationFixture(t *testing.T, st *Store, migration migration) {
	t.Helper()

	if _, err := st.db.Exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL
);`); err != nil {
		t.Fatalf("create schema_migrations: %v", err)
	}
	if _, err := st.db.Exec(migration.sql); err != nil {
		t.Fatalf("apply migration %d fixture: %v", migration.version, err)
	}
	if _, err := st.db.Exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, migration.version, migration.name, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatalf("record migration %d fixture: %v", migration.version, err)
	}
}

func assertTableExists(t *testing.T, st *Store, table string) {
	t.Helper()

	var count int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
		t.Fatalf("lookup table %s: %v", table, err)
	}
	if count != 1 {
		t.Fatalf("table %s count = %d, want 1", table, count)
	}
}

func assertColumnExists(t *testing.T, st *Store, table, column string) {
	t.Helper()

	rows, err := st.db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		t.Fatalf("pragma table_info(%s): %v", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan table_info(%s): %v", table, err)
		}
		if name == column {
			return
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("table_info(%s) rows: %v", table, err)
	}
	t.Fatalf("column %s.%s not found", table, column)
}

func deviceByID(t *testing.T, devices []contracts.Device, id string) contracts.Device {
	t.Helper()
	for _, device := range devices {
		if device.ID == id {
			return device
		}
	}
	t.Fatalf("device %s not found", id)
	return contracts.Device{}
}

func TestGetOpenLifecycleOperation(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	op, found, err := st.GetOpenLifecycleOperation("dev-004", "DeviceProvisionRequested")
	if err != nil {
		t.Fatalf("GetOpenLifecycleOperation returned error: %v", err)
	}
	if !found {
		t.Fatalf("expected open operation for dev-004")
	}
	if op.UpstreamState != "" {
		t.Fatalf("upstream state = %q, want empty", op.UpstreamState)
	}
}

func TestCreateUpstreamLifecycleOperationPersistsProjection(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		t.Fatalf("SeedDemoData returned error: %v", err)
	}

	recorded, err := st.CreateUpstreamLifecycleOperation("dev-002", "DeviceProvisionRequested", "user@example.com", "up-op-1", "published", "accepted")
	if err != nil {
		t.Fatalf("CreateUpstreamLifecycleOperation returned error: %v", err)
	}
	if recorded.ID != "up-op-1" {
		t.Fatalf("recorded id = %q, want up-op-1", recorded.ID)
	}
	if recorded.UpstreamOperationID != "up-op-1" {
		t.Fatalf("upstream id = %q, want up-op-1", recorded.UpstreamOperationID)
	}
	if recorded.UpstreamState != "published" {
		t.Fatalf("upstream state = %q, want published", recorded.UpstreamState)
	}

	open, found, err := st.GetOpenLifecycleOperation("dev-002", "DeviceProvisionRequested")
	if err != nil {
		t.Fatalf("GetOpenLifecycleOperation returned error: %v", err)
	}
	if !found || open.ID != recorded.ID {
		t.Fatalf("expected open operation to match recorded, found=%v open=%#v", found, open)
	}

	if !strings.Contains(recorded.Message, "accepted") {
		t.Fatalf("message = %q", recorded.Message)
	}
}

func TestProvisioningSourcePersistenceAndIdempotency(t *testing.T) {
	t.Parallel()
	st, err := Open(t.TempDir() + "/sources.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	want := contracts.ProvisioningSource{
		OrganizationID: "org-acme",
		SKU:            "sku-home-hub",
		Filename:       "devices.csv",
		Checksum:       "sha256:abc",
		RowCount:       2,
		DeviceIDs:      []string{"dev-001", "dev-002"},
	}
	created, err := st.CreateProvisioningSource(want, "source-key-1")
	if err != nil {
		t.Fatalf("CreateProvisioningSource returned error: %v", err)
	}
	if created.ID == "" || created.ExpiresAt == "" {
		t.Fatalf("created source missing identity/expiry: %#v", created)
	}
	byID, err := st.GetProvisioningSource("org-acme", created.ID)
	if err != nil {
		t.Fatalf("GetProvisioningSource returned error: %v", err)
	}
	if strings.Join(byID.DeviceIDs, ",") != "dev-001,dev-002" || byID.Checksum != want.Checksum {
		t.Fatalf("stored source = %#v", byID)
	}
	byKey, err := st.GetProvisioningSourceByIdempotency("org-acme", "source-key-1")
	if err != nil || byKey.ID != created.ID {
		t.Fatalf("idempotent source lookup = %#v, err=%v", byKey, err)
	}
	if _, err := st.CreateProvisioningSource(want, "source-key-1"); err == nil {
		t.Fatal("expected duplicate source idempotency key to fail")
	}
}
