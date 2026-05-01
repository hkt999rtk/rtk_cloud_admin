package store

import "testing"

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
