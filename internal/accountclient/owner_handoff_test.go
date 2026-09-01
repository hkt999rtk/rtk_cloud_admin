package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOwnerHandoffRequiresConsistentCommitEvidence(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const transfer = "22222222-2222-4222-8222-222222222222"
	for _, tc := range []struct {
		name   string
		modify func(*OwnerHandoff)
		valid  bool
	}{
		{"complete", func(v *OwnerHandoff) {}, true},
		{"wrong cloud", func(v *OwnerHandoff) { v.CloudID = transfer }, false},
		{"wrong transfer", func(v *OwnerHandoff) { v.ID = cloud }, false},
		{"unknown phase", func(v *OwnerHandoff) { v.Phase = "accepted" }, false},
		{"missing snapshot", func(v *OwnerHandoff) { v.BalanceSnapshot = nil }, false},
		{"negative balance", func(v *OwnerHandoff) { v.BalanceSnapshot.BalanceMinor = -1 }, false},
		{"missing confirmation", func(v *OwnerHandoff) { v.SourceConfirmed = nil }, false},
		{"wrong operation scope", func(v *OwnerHandoff) { v.Operation.CloudID = transfer }, false},
		{"still finalizing", func(v *OwnerHandoff) { v.OperationPhase = "finalizing" }, false},
		{"no success receipt", func(v *OwnerHandoff) { v.Operation.State = "running" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			yes := true
			v := OwnerHandoff{ID: transfer, CloudID: cloud, SourceUserID: "source", RequestedByUserID: "source", TargetUserID: "target", Phase: "succeeded", Status: "accepted", OperationPhase: "succeeded", Blockers: []CloudBlocker{}, OwnershipVersion: 1, HasSettledSnapshot: true, SourceConfirmed: &yes, TargetConfirmed: &yes, BalanceSnapshot: &HandoffSnapshot{OwnershipVersion: 1, BillingSnapshotVersion: 2, BalanceMinor: 0, Currency: "TWD"}, Operation: &ManagedCloudOperation{ID: transfer, CloudID: cloud, Type: "owner_transfer", State: "succeeded", Phase: "succeeded"}}
			tc.modify(&v)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"owner_transfer": v})
			}))
			defer upstream.Close()
			_, err := New(upstream.URL).OwnerHandoff(context.Background(), "global", "source", "GET", "/v1/developer/brand-clouds/"+cloud+"/owner-transfer/"+transfer, cloud, transfer, "", nil)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
		})
	}
}
