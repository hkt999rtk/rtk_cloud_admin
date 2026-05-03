package readinessfacts

import (
	"strings"
	"unicode"

	"rtk_cloud_admin/internal/contracts"
)

// VideoCloudFacts holds ground-truth data retrieved directly from Video Cloud.
// When non-nil it overrides inferred activation and transport state.
type VideoCloudFacts struct {
	Activated bool
	Transport string // e.g. "websocket"; empty if unknown
	UpdatedAt string
}

func Build(device contracts.Device, latestOp *contracts.Operation, vcFacts *VideoCloudFacts) []contracts.SourceFact {
	updatedAt := device.UpdatedAt
	if updatedAt == "" && latestOp != nil {
		updatedAt = latestOp.UpdatedAt
	}

	return []contracts.SourceFact{
		{
			Layer:     "account_registry",
			State:     "present",
			Detail:    "Device exists in the registry projection.",
			UpdatedAt: updatedAt,
		},
		cloudActivationFact(device, latestOp, updatedAt, vcFacts),
		transportOnlineFact(device, updatedAt, vcFacts),
	}
}

func cloudActivationFact(device contracts.Device, latestOp *contracts.Operation, fallbackUpdatedAt string, vcFacts *VideoCloudFacts) contracts.SourceFact {
	fact := contracts.SourceFact{
		Layer:     "cloud_activation",
		UpdatedAt: fallbackUpdatedAt,
	}

	if device.VideoCloudDevID == "" {
		fact.State = "missing"
		fact.Detail = "Missing video_cloud_devid from Account Manager metadata."
		return fact
	}

	switch device.Readiness {
	case contracts.ReadinessFailed:
		fact.State = "failed"
		fact.Detail = "Cloud activation failed."
		fact.Retryable = true
	case contracts.ReadinessClaimPending, contracts.ReadinessLocalOnboardingPending, contracts.ReadinessCloudActivationPending, contracts.ReadinessDeactivationPending:
		fact.State = "pending"
		fact.Detail = "Waiting for cloud activation to complete."
	case contracts.ReadinessActivated, contracts.ReadinessOnline:
		fact.State = "present"
		fact.Detail = "Video Cloud device identity is present."
	case contracts.ReadinessDeactivated:
		fact.State = "stale"
		fact.Detail = "Device is deactivated and cloud activation evidence is stale."
	default:
		fact.State = "present"
		fact.Detail = "Video Cloud device identity is present."
	}

	if latestOp != nil {
		fact.OperationID = latestOp.ID
		if latestOp.UpdatedAt != "" {
			fact.UpdatedAt = latestOp.UpdatedAt
		}

		switch latestOp.State {
		case contracts.OperationPending, contracts.OperationPublished, contracts.OperationRetrying:
			fact.State = "pending"
			if latestOp.Message != "" {
				fact.Detail = latestOp.Message
			}
		case contracts.OperationSucceeded:
			if fact.State != "failed" {
				fact.State = "present"
			}
			if latestOp.Message != "" {
				fact.Detail = latestOp.Message
			}
		case contracts.OperationFailed, contracts.OperationDeadLettered:
			fact.State = "failed"
			if latestOp.Message != "" {
				fact.Detail = latestOp.Message
				fact.ErrorCode = normalizeErrorCode(latestOp.Message)
				fact.Retryable = retryableFromMessage(latestOp.Message)
			}
		default:
			if latestOp.Message != "" && fact.Detail == "" {
				fact.Detail = latestOp.Message
			}
		}
	}

	// Video Cloud ground truth overrides inferred state when present.
	if vcFacts != nil {
		ts := fallbackUpdatedAt
		if vcFacts.UpdatedAt != "" {
			ts = vcFacts.UpdatedAt
		}
		if vcFacts.Activated {
			fact.State = "present"
			fact.Detail = "Video Cloud confirms device activation."
		} else {
			fact.State = "stale"
			fact.Detail = "Video Cloud reports device is not activated."
			fact.Retryable = true
		}
		fact.UpdatedAt = ts
	}

	return fact
}

func transportOnlineFact(device contracts.Device, fallbackUpdatedAt string, vcFacts *VideoCloudFacts) contracts.SourceFact {
	fact := contracts.SourceFact{
		Layer:     "transport_online",
		UpdatedAt: fallbackUpdatedAt,
	}

	// Video Cloud transport is authoritative; use it regardless of LastSeenAt.
	if vcFacts != nil && vcFacts.Transport != "" {
		ts := fallbackUpdatedAt
		if vcFacts.UpdatedAt != "" {
			ts = vcFacts.UpdatedAt
		}
		fact.State = "present"
		fact.Detail = "Video Cloud transport: " + vcFacts.Transport + "."
		fact.UpdatedAt = ts
		return fact
	}

	if device.LastSeenAt == "" {
		fact.State = "missing"
		fact.Detail = "No transport evidence."
		return fact
	}

	fact.UpdatedAt = device.LastSeenAt
	fact.Detail = "Last transport evidence at " + device.LastSeenAt + "."
	switch strings.ToLower(device.Status) {
	case "online":
		fact.State = "present"
	case "offline", "unknown", "disabled":
		fact.State = "stale"
	default:
		fact.State = "present"
	}
	return fact
}

func normalizeErrorCode(text string) string {
	text = strings.ToLower(text)
	var b strings.Builder
	lastUnderscore := false
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteRune('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}

func retryableFromMessage(message string) bool {
	lower := strings.ToLower(message)
	for _, blocked := range []string{"mismatch", "invalid", "forbidden", "unauthorized", "rejected"} {
		if strings.Contains(lower, blocked) {
			return false
		}
	}
	return true
}
