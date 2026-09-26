package store

import (
	"testing"

	"rtk_cloud_admin/internal/contracts"
)

func TestProductApplyProgressCommitsCountsAndCursorAtomicallyAcrossRestart(t *testing.T) {
	path := t.TempDir() + "/product-progress.db"
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	job, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "cloud-a", Type: "product_services_apply", State: "running", Total: 3})
	if err != nil {
		t.Fatal(err)
	}
	commit := func(position int, device, state string) contracts.BatchJob {
		t.Helper()
		updated, err := st.CommitProductApplyResult("cloud-a", job.ID, contracts.BatchJobItem{
			JobID: job.ID, ItemKey: device, Position: position, State: state, Attempt: 1,
			FailureCode: "", Retryable: state == "failed", UpstreamOperationID: "operation-" + device,
		})
		if err != nil {
			t.Fatal(err)
		}
		return updated
	}
	assertProgress := func(got contracts.BatchJob, completed, failed, next int, state string) {
		t.Helper()
		if got.Completed != completed || got.Failed != failed || got.Checkpoint["next_position"] != float64(next) || got.State != state {
			t.Fatalf("progress = %+v, want completed=%d failed=%d next=%d state=%s", got, completed, failed, next, state)
		}
	}
	assertProgress(commit(0, "device-0", "completed"), 1, 0, 1, "running")
	if err := st.YieldProductApplyJob("cloud-a", job.ID); err != nil {
		t.Fatal(err)
	}
	yielded, err := st.GetBatchJob("cloud-a", job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertProgress(yielded, 1, 0, 1, "queued")
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	reconciled, err := st.ReconcileProductApplyProgress("cloud-a", job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertProgress(reconciled, 1, 0, 1, "queued")
	assertProgress(commit(1, "device-1", "failed"), 1, 1, 2, "running")
	if _, err := st.UpdateBatchJobState("cloud-a", job.ID, "pausing"); err != nil {
		t.Fatal(err)
	}
	if err := st.YieldProductApplyJob("cloud-a", job.ID); err != nil {
		t.Fatal(err)
	}
	assertProgress(commit(2, "device-2", "completed"), 2, 1, 3, "pausing")
	items, err := st.ListBatchJobItems("cloud-a", job.ID, "", nil, 10, 0)
	if err != nil || items.Total != 3 || items.Items[0].ItemKey != "device-0" || items.Items[1].State != "failed" || items.Items[2].ItemKey != "device-2" {
		t.Fatalf("durable result items = %+v, %v", items, err)
	}
	if _, err := st.CommitProductApplyResult("cloud-a", job.ID, contracts.BatchJobItem{JobID: job.ID, ItemKey: "device-2", Position: 2, State: "completed"}); err == nil {
		t.Fatal("duplicate position advanced the cursor")
	}
	if _, err := st.UpdateBatchJobProgress("cloud-a", job.ID, "partial_failed", 2, 1, 0); err != nil {
		t.Fatal(err)
	}
	retried, _, replay, err := st.ActBatchJob("cloud-a", job.ID, "retry", "retry-after-restart")
	if err != nil || replay {
		t.Fatalf("retry transition = %+v, replay=%v, err=%v", retried, replay, err)
	}
	assertProgress(retried, 0, 0, 0, "queued")
	reconciled, err = st.ReconcileProductApplyProgress("cloud-a", job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertProgress(reconciled, 0, 0, 0, "queued")
	assertProgress(commit(0, "device-0", "failed"), 0, 1, 1, "running")
	reconciled, err = st.ReconcileProductApplyProgress("cloud-a", job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertProgress(reconciled, 0, 1, 1, "running")
	assertProgress(commit(1, "device-1", "completed"), 1, 1, 2, "running")
	if _, err := st.ReconcileProductApplyProgress("cloud-b", job.ID); err == nil {
		t.Fatal("cross-cloud worker reconciled another cloud's Product job")
	}
}

func TestProductApplyProgressRejectsInvalidAndIncompleteCheckpoints(t *testing.T) {
	st, err := Open(t.TempDir() + "/invalid-progress.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	job, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "cloud-a", Type: "product_services_apply", State: "running", Total: 2})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []contracts.BatchJobItem{
		{JobID: "other-job", ItemKey: "device-0", Position: 0, State: "completed"},
		{JobID: job.ID, Position: 0, State: "completed"},
		{JobID: job.ID, ItemKey: "device-0", Position: -1, State: "completed"},
		{JobID: job.ID, ItemKey: "device-0", Position: 0, State: "running"},
		{JobID: job.ID, ItemKey: "device-0", Position: 1, State: "completed"},
	} {
		if _, err := st.CommitProductApplyResult("cloud-a", job.ID, item); err == nil {
			t.Fatalf("invalid or out-of-order result accepted: %+v", item)
		}
	}
	if err := st.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: "original-device", Position: 0, State: "pending"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CommitProductApplyResult("cloud-a", job.ID, contracts.BatchJobItem{JobID: job.ID, ItemKey: "different-device", Position: 0, State: "completed"}); err == nil {
		t.Fatal("changed device identity was accepted at a fixed checkpoint")
	}
	if _, err := st.db.Exec(`UPDATE batch_jobs SET checkpoint_json='{"next_position":1}' WHERE id=?`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReconcileProductApplyProgress("cloud-a", job.ID); err == nil {
		t.Fatal("nonterminal item was counted as applied after restart")
	}
	if _, err := st.CommitProductApplyResult("cloud-a", job.ID, contracts.BatchJobItem{JobID: job.ID, ItemKey: "device-1", Position: 1, State: "completed"}); err == nil {
		t.Fatal("commit skipped a nonterminal prefix")
	}
	items, err := st.ListBatchJobItems("cloud-a", job.ID, "", nil, 10, 0)
	if err != nil || items.Total != 1 || items.Items[0].State != "pending" {
		t.Fatalf("failed commit changed item rows: %+v, %v", items, err)
	}
	if _, err := st.db.Exec(`UPDATE batch_jobs SET checkpoint_json='{"next_position":3}' WHERE id=?`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReconcileProductApplyProgress("cloud-a", job.ID); err == nil {
		t.Fatal("checkpoint past total was accepted")
	}
	if _, err := st.db.Exec(`UPDATE batch_jobs SET checkpoint_json='not-json' WHERE id=?`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReconcileProductApplyProgress("cloud-a", job.ID); err == nil {
		t.Fatal("malformed checkpoint was accepted")
	}
	other, err := st.CreateBatchJob(contracts.BatchJob{OrganizationID: "cloud-a", Type: "device_provision", Total: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReconcileProductApplyProgress("cloud-a", other.ID); err == nil {
		t.Fatal("non-Product job accepted Product progress reconciliation")
	}
}
