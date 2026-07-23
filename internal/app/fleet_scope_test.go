package app

import (
	"rtk_cloud_admin/internal/accountclient"
	"testing"
)

func TestScopeStringSliceNormalizesJSONAndGoSlices(t *testing.T) {
	if got := scopeStringSlice([]any{" dev-1 ", "", "dev-2"}); len(got) != 2 || got[0] != "dev-1" || got[1] != "dev-2" {
		t.Fatalf("unexpected []any normalization: %#v", got)
	}
	if got := scopeStringSlice([]string{" dev-3 ", ""}); len(got) != 1 || got[0] != "dev-3" {
		t.Fatalf("unexpected []string normalization: %#v", got)
	}
}

func TestDeviceMatchesScopeQueryUsesServerDeviceFacts(t *testing.T) {
	device := accountclient.Device{
		ID:                  "dev-1",
		DeviceItemProfileID: "sku-1",
		Category:            "camera",
		Model:               "model-a",
		Status:              "warning",
		Readiness:           "ready",
		Metadata: map[string]any{
			"region":   "na",
			"firmware": "v3.8.0",
		},
	}

	if !deviceMatchesScopeQuery(device, map[string]any{
		"sku_id":   "sku-1",
		"region":   []any{"na"},
		"firmware": []any{"v3.8.0"},
		"status":   []any{"warning"},
	}) {
		t.Fatal("expected device to match its immutable scope")
	}
	if deviceMatchesScopeQuery(device, map[string]any{"region": []any{"eu"}}) {
		t.Fatal("expected device outside region filter to be rejected")
	}
}
