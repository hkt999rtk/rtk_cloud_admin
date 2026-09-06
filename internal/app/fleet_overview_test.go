package app

import (
	"testing"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/videoclient"
)

func TestAggregateFleetOverviewSumsRawSecondsBeforePercentages(t *testing.T) {
	t.Parallel()
	out := contracts.FleetOverview{}
	batches := []fleetOverviewBatch{
		{
			presence: videoclient.FleetPresenceSummary{SourceStatus: "available", Current: videoclient.FleetPresenceCurrent{Online: 1, Total: 1}, History: videoclient.FleetPresenceHistory{OnlineSeconds: 7200, KnownSeconds: 7200, ExpectedSeconds: 10800}},
			health:   videoclient.FleetHealthSummary{Distribution: videoclient.FleetHealthDistribution{Warning: 1, Total: 1}},
			stream:   videoclient.FleetStreamStats{ActiveSessions: 2},
		},
		{
			presence: videoclient.FleetPresenceSummary{SourceStatus: "available", Current: videoclient.FleetPresenceCurrent{Offline: 1, Total: 1}, History: videoclient.FleetPresenceHistory{OfflineSeconds: 3600, KnownSeconds: 3600, ExpectedSeconds: 3600}},
			health:   videoclient.FleetHealthSummary{Distribution: videoclient.FleetHealthDistribution{Critical: 1, Total: 1}},
			stream:   videoclient.FleetStreamStats{ActiveSessions: 3},
		},
	}
	aggregateFleetOverview(&out, batches)
	if out.Presence.OnlineRate7dPct == nil || *out.Presence.OnlineRate7dPct != 66.67 {
		t.Fatalf("online rate = %v", out.Presence.OnlineRate7dPct)
	}
	if out.Presence.Coverage7dPct == nil || *out.Presence.Coverage7dPct != 75 {
		t.Fatalf("coverage = %v", out.Presence.Coverage7dPct)
	}
	if out.Health.NeedsAttention != 2 || out.Sessions.ActiveSessions == nil || *out.Sessions.ActiveSessions != 5 {
		t.Fatalf("overview = %+v", out)
	}
}

func TestEligibleFleetAnalyticsDevicesRequiresProvisionedVideoIdentity(t *testing.T) {
	t.Parallel()
	devices := []accountclient.Device{
		{ID: "ok", VideoCloudDevID: "vc-ok", Status: "online"},
		{ID: "disabled", VideoCloudDevID: "vc-disabled", Status: "disabled"},
		{ID: "missing-video", Status: "online"},
	}
	got := eligibleFleetAnalyticsDevices(devices)
	if len(got) != 1 || got[0].ID != "ok" {
		t.Fatalf("eligible = %+v", got)
	}
	chunks := chunkStrings(make([]string, 1001), 500)
	if len(chunks) != 3 || len(chunks[0]) != 500 || len(chunks[2]) != 1 {
		t.Fatalf("chunks = %d/%d/%d", len(chunks), len(chunks[0]), len(chunks[2]))
	}
}
