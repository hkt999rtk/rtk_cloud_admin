package readinessfacts

import (
	"testing"

	"rtk_cloud_admin/internal/contracts"
)

func TestBuildSourceFacts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		device          contracts.Device
		latestOp        *contracts.Operation
		vcFacts         *VideoCloudFacts
		wantStates      []string
		wantErrorCode   string
		wantRetryable   bool
		wantOperationID string
	}{
		{
			name: "online",
			device: contracts.Device{
				ID:              "dev-1",
				VideoCloudDevID: "video-1",
				Status:          "online",
				Readiness:       contracts.ReadinessOnline,
				LastSeenAt:      "2026-05-01T10:00:00Z",
				UpdatedAt:       "2026-05-01T10:01:00Z",
			},
			wantStates: []string{"present", "present", "present"},
		},
		{
			name: "activated",
			device: contracts.Device{
				ID:              "dev-2",
				VideoCloudDevID: "video-2",
				Status:          "offline",
				Readiness:       contracts.ReadinessActivated,
				LastSeenAt:      "2026-05-01T10:00:00Z",
				UpdatedAt:       "2026-05-01T10:01:00Z",
			},
			wantStates: []string{"present", "present", "stale"},
		},
		{
			name: "pending",
			device: contracts.Device{
				ID:              "dev-3",
				VideoCloudDevID: "video-3",
				Status:          "unknown",
				Readiness:       contracts.ReadinessCloudActivationPending,
				UpdatedAt:       "2026-05-01T10:01:00Z",
			},
			latestOp: &contracts.Operation{
				ID:        "op-1",
				State:     contracts.OperationPublished,
				Message:   "Waiting for upstream activation.",
				UpdatedAt: "2026-05-01T10:02:00Z",
			},
			wantStates:      []string{"present", "pending", "missing"},
			wantOperationID: "op-1",
		},
		{
			name: "failed",
			device: contracts.Device{
				ID:              "dev-4",
				VideoCloudDevID: "video-4",
				Status:          "disabled",
				Readiness:       contracts.ReadinessFailed,
				LastSeenAt:      "2026-05-01T10:00:00Z",
				UpdatedAt:       "2026-05-01T10:01:00Z",
			},
			latestOp: &contracts.Operation{
				ID:        "op-2",
				State:     contracts.OperationFailed,
				Message:   "subject mapping rejected: video_cloud_devid mismatch",
				UpdatedAt: "2026-05-01T10:03:00Z",
			},
			wantStates:      []string{"present", "failed", "stale"},
			wantErrorCode:   "subject_mapping_rejected_video_cloud_devid_mismatch",
			wantRetryable:   false,
			wantOperationID: "op-2",
		},
		{
			name: "missing",
			device: contracts.Device{
				ID:        "dev-5",
				Readiness: contracts.ReadinessRegistered,
			},
			wantStates: []string{"present", "missing", "missing"},
		},
		{
			name: "stale",
			device: contracts.Device{
				ID:              "dev-6",
				VideoCloudDevID: "video-6",
				Status:          "offline",
				Readiness:       contracts.ReadinessActivated,
				LastSeenAt:      "2026-04-30T22:45:00Z",
				UpdatedAt:       "2026-05-01T10:01:00Z",
			},
			wantStates: []string{"present", "present", "stale"},
		},
		{
			name: "vc_activated_with_transport",
			device: contracts.Device{
				ID:              "dev-7",
				VideoCloudDevID: "video-7",
				Status:          "offline",
				Readiness:       contracts.ReadinessCloudActivationPending,
				UpdatedAt:       "2026-05-01T10:00:00Z",
			},
			vcFacts: &VideoCloudFacts{
				Activated: true,
				Transport: "websocket",
				UpdatedAt: "2026-05-01T10:05:00Z",
			},
			wantStates: []string{"present", "present", "present"},
		},
		{
			name: "vc_not_activated",
			device: contracts.Device{
				ID:              "dev-8",
				VideoCloudDevID: "video-8",
				Status:          "online",
				Readiness:       contracts.ReadinessOnline,
				LastSeenAt:      "2026-05-01T10:00:00Z",
				UpdatedAt:       "2026-05-01T10:00:00Z",
			},
			vcFacts: &VideoCloudFacts{
				Activated: false,
				UpdatedAt: "2026-05-01T10:05:00Z",
			},
			wantStates:    []string{"present", "stale", "present"},
			wantRetryable: true,
		},
		{
			name: "vc_activated_no_transport",
			device: contracts.Device{
				ID:              "dev-9",
				VideoCloudDevID: "video-9",
				Status:          "offline",
				Readiness:       contracts.ReadinessActivated,
				LastSeenAt:      "2026-05-01T10:00:00Z",
				UpdatedAt:       "2026-05-01T10:00:00Z",
			},
			vcFacts: &VideoCloudFacts{
				Activated: true,
				Transport: "",
				UpdatedAt: "2026-05-01T10:05:00Z",
			},
			// transport falls back to inferred "stale" (status=offline, no VC transport)
			wantStates: []string{"present", "present", "stale"},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			facts := Build(tt.device, tt.latestOp, tt.vcFacts)
			if len(facts) != 3 {
				t.Fatalf("facts len = %d, want 3", len(facts))
			}
			for i, want := range tt.wantStates {
				if got := facts[i].State; got != want {
					t.Fatalf("fact[%d].state = %q, want %q", i, got, want)
				}
			}
			if tt.wantErrorCode != "" && facts[1].ErrorCode != tt.wantErrorCode {
				t.Fatalf("cloud activation error_code = %q, want %q", facts[1].ErrorCode, tt.wantErrorCode)
			}
			if facts[1].Retryable != tt.wantRetryable {
				t.Fatalf("cloud activation retryable = %v, want %v", facts[1].Retryable, tt.wantRetryable)
			}
			if tt.wantOperationID != "" && facts[1].OperationID != tt.wantOperationID {
				t.Fatalf("cloud activation operation_id = %q, want %q", facts[1].OperationID, tt.wantOperationID)
			}
		})
	}
}
