package store

import (
	"database/sql"
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
}

func TestPlatformAdminAndSessions(t *testing.T) {
	t.Parallel()

	st, err := Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatalf("Migrate returned error: %v", err)
	}
	if err := st.BootstrapPlatformAdmin("admin@example.com", "secret"); err != nil {
		t.Fatalf("BootstrapPlatformAdmin returned error: %v", err)
	}
	if _, err := st.VerifyPlatformAdmin("admin@example.com", "wrong"); err == nil {
		t.Fatalf("VerifyPlatformAdmin with wrong password unexpectedly succeeded")
	}
	admin, err := st.VerifyPlatformAdmin("admin@example.com", "secret")
	if err != nil {
		t.Fatalf("VerifyPlatformAdmin returned error: %v", err)
	}
	if admin.Email != "admin@example.com" {
		t.Fatalf("admin email = %q", admin.Email)
	}

	session, err := st.CreateSession("platform_admin", admin.ID, admin.Email, "", "", "", time.Hour)
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	got, err := st.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if got.Email != admin.Email || got.Kind != "platform_admin" {
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
