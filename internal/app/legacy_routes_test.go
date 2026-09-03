package app

import "testing"

func TestIsRetiredLegacyCustomerPath(t *testing.T) {
	for _, path := range []string{"/api/fleet/summary", "/api/reports/1", "/api/update-plans", "/console/billing"} {
		if !isRetiredLegacyCustomerPath(path) {
			t.Fatalf("%s should be retired", path)
		}
	}
	for _, path := range []string{"/api/developer/brand-clouds/cloud-1/reports", "/api/admin/audit", "/console/clouds/cloud-1/fleet"} {
		if isRetiredLegacyCustomerPath(path) {
			t.Fatalf("%s should remain scoped or platform-owned", path)
		}
	}
}
