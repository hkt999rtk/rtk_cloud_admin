package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type HandoffSnapshot struct {
	OwnershipVersion       int64  `json:"ownership_version"`
	BillingSnapshotVersion int64  `json:"billing_snapshot_version"`
	BalanceMinor           int64  `json:"balance_minor"`
	Currency               string `json:"currency"`
}
type OwnerHandoff struct {
	ID                 string                 `json:"id"`
	CloudID            string                 `json:"brand_cloud_id"`
	SourceUserID       string                 `json:"source_user_id"`
	RequestedByUserID  string                 `json:"requested_by_user_id"`
	TargetUserID       string                 `json:"target_user_id"`
	TargetEmail        string                 `json:"target_email,omitempty"`
	Status             string                 `json:"status"`
	Phase              string                 `json:"phase"`
	OperationPhase     string                 `json:"operation_phase,omitempty"`
	HasSettledSnapshot bool                   `json:"has_settled_snapshot"`
	BalanceSnapshot    *HandoffSnapshot       `json:"balance_snapshot,omitempty"`
	SourceConfirmed    *bool                  `json:"source_confirmed,omitempty"`
	TargetConfirmed    *bool                  `json:"target_confirmed,omitempty"`
	OwnershipVersion   int64                  `json:"ownership_version,omitempty"`
	Operation          *ManagedCloudOperation `json:"operation,omitempty"`
	Blockers           []CloudBlocker         `json:"blockers"`
	ExpiresAt          string                 `json:"expires_at"`
}

// Participant endpoints must not use current cloud membership: the recipient
// has none before commit and the former owner loses theirs after commit.
func (c *Client) OwnerHandoff(ctx context.Context, token, subject, method, path, cloud, transfer, key string, body any) (OwnerHandoff, error) {
	var result struct {
		Transfer OwnerHandoff `json:"owner_transfer"`
	}
	if err := c.doJSONWithIdempotency(ctx, method, path, token, key, body, &result); err != nil {
		return OwnerHandoff{}, err
	}
	v := result.Transfer
	if v.Blockers == nil {
		return v, fmt.Errorf("missing handoff blocker evidence")
	}
	if !managedOperationID.MatchString(v.ID) || !managedOperationID.MatchString(v.CloudID) || (cloud != "" && v.CloudID != cloud) || (transfer != "" && v.ID != transfer) || v.SourceUserID == "" || v.SourceUserID != v.RequestedByUserID || v.TargetUserID == "" || v.TargetUserID == v.SourceUserID || (subject != v.SourceUserID && subject != v.TargetUserID) {
		return v, fmt.Errorf("invalid handoff participant or scope")
	}
	if strings.HasSuffix(path, "/accept") && subject != v.TargetUserID {
		return v, fmt.Errorf("handoff recipient mismatch")
	}
	if method == http.MethodPost && transfer == "" && cloud != "" && subject != v.SourceUserID {
		return v, fmt.Errorf("handoff source mismatch")
	}
	switch v.Phase {
	case "requested", "awaiting_acceptance", "preparing", "awaiting_balance_confirmation", "committing", "finalizing", "succeeded", "blocked", "canceled", "expired":
	default:
		return v, fmt.Errorf("missing or unknown handoff phase")
	}
	if v.HasSettledSnapshot != (v.BalanceSnapshot != nil) || v.HasSettledSnapshot != (v.SourceConfirmed != nil && v.TargetConfirmed != nil) || (!v.HasSettledSnapshot && (v.SourceConfirmed != nil || v.TargetConfirmed != nil)) {
		return v, fmt.Errorf("incomplete handoff snapshot")
	}
	if snap := v.BalanceSnapshot; snap != nil && (snap.OwnershipVersion < 1 || snap.OwnershipVersion != v.OwnershipVersion || snap.BillingSnapshotVersion < 2 || snap.BalanceMinor < 0 || snap.Currency != "TWD") {
		return v, fmt.Errorf("invalid handoff snapshot")
	}
	if op := v.Operation; op != nil && (op.ID != v.ID || op.CloudID != v.CloudID || op.Type != "owner_transfer") {
		return v, fmt.Errorf("invalid handoff operation")
	}
	if v.Phase == "awaiting_balance_confirmation" && (v.BalanceSnapshot == nil || len(v.Blockers) != 0 || v.Operation == nil || v.OperationPhase != "preparing") {
		return v, fmt.Errorf("unready confirmation response")
	}
	if (v.Phase == "finalizing" || v.Phase == "succeeded") && (v.Operation == nil || v.OperationPhase != v.Phase || v.Status != "accepted" || v.BalanceSnapshot == nil || !*v.SourceConfirmed || !*v.TargetConfirmed) {
		return v, fmt.Errorf("unproven ownership commit")
	}
	if v.Phase == "succeeded" && v.Operation.State != "succeeded" {
		return v, fmt.Errorf("incomplete finalization")
	}
	return v, nil
}
