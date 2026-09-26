package store

import (
	"fmt"
	"testing"

	"rtk_cloud_admin/internal/contracts"
)

func TestProductApplyJobListingAndCancelCleanupStayScoped(t *testing.T) {
	st, err := Open(t.TempDir() + "/product-apply.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}

	create := func(cloud, product, jobType, state, authorizationStatus string) contracts.BatchJob {
		t.Helper()
		job, err := st.CreateBatchJob(contracts.BatchJob{
			OrganizationID:      cloud,
			Type:                jobType,
			State:               state,
			Scope:               map[string]any{"product_id": product},
			AuthorizationID:     "grant-" + cloud + "-" + product + "-" + state,
			AuthorizationStatus: authorizationStatus,
		})
		if err != nil {
			t.Fatal(err)
		}
		return job
	}

	cancelled := create("cloud-a", "product-a", "product_services_apply", "cancelled", "active")
	failed := create("cloud-a", "product-a", "product_services_apply", "failed", "active")
	permanent := create("cloud-a", "product-a", "product_services_apply", "partial_failed", "active")
	retryable := create("cloud-a", "product-a", "product_services_apply", "partial_failed", "active")
	otherProduct := create("cloud-a", "product-b", "product_services_apply", "cancelled", "active")
	otherCloud := create("cloud-b", "product-a", "product_services_apply", "cancelled", "active")
	create("cloud-a", "product-a", "device_provision", "cancelled", "active")
	create("cloud-a", "product-a", "product_services_apply", "cancelled", "revoked")
	create("cloud-a", "product-a", "product_services_apply", "running", "active")
	for _, tc := range []struct {
		job       contracts.BatchJob
		retryable bool
	}{
		{permanent, false},
		{retryable, true},
	} {
		if err := st.UpsertBatchJobItem(contracts.BatchJobItem{JobID: tc.job.ID, ItemKey: "device-1", State: "failed", Retryable: tc.retryable}); err != nil {
			t.Fatal(err)
		}
	}

	listed, err := st.ListProductApplyJobs("cloud-a", "product-a", 0)
	if err != nil || len(listed) != 6 {
		t.Fatalf("scoped Product jobs = %+v, %v", listed, err)
	}
	for _, job := range listed {
		if job.OrganizationID != "cloud-a" || job.Type != "product_services_apply" || job.Scope["product_id"] != "product-a" {
			t.Fatalf("job escaped Product scope: %+v", job)
		}
	}
	page, err := st.ListProductApplyJobs("cloud-a", "product-a", 1)
	if err != nil || len(page) != 1 {
		t.Fatalf("limited Product jobs = %+v, %v", page, err)
	}
	all, err := st.ListProductApplyJobs("cloud-a", "product-a", 101)
	if err != nil || len(all) != 6 {
		t.Fatalf("oversized limit should use safe default: %+v, %v", all, err)
	}
	missing, err := st.ListProductApplyJobs("cloud-a", "missing", 10)
	if err != nil || len(missing) != 0 {
		t.Fatalf("missing Product jobs = %+v, %v", missing, err)
	}

	pending, err := st.ListPendingProductApplyCancels(0)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{cancelled.ID: true, failed.ID: true, permanent.ID: true, otherProduct.ID: true, otherCloud.ID: true}
	for _, job := range pending {
		if !want[job.ID] {
			t.Fatalf("cleanup would revoke active or retryable job: %+v", job)
		}
		delete(want, job.ID)
	}
	if len(want) != 0 {
		t.Fatalf("terminal Product grants not queued for cleanup: %v", want)
	}

	if _, _, _, err := st.ActBatchJob("cloud-a", permanent.ID, "retry", "retry-permanent"); err == nil {
		t.Fatal("permanent failure was eligible for retry")
	}
	if _, _, _, err := st.ActBatchJob("cloud-a", cancelled.ID, "retry", "retry-cancelled"); err == nil {
		t.Fatal("cancelled job was eligible for retry")
	}
	if _, err := st.ListPendingProductApplyCancels(1); err != nil {
		t.Fatalf("limited cleanup query: %v", err)
	}
	if _, err := st.ListPendingProductApplyCancels(101); err != nil {
		t.Fatalf("oversized cleanup query: %v", err)
	}
}

func TestProductApplyRetryResetsProgressAndPaginatesAllResults(t *testing.T) {
	st, err := Open(t.TempDir() + "/product-apply-retry.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	job, err := st.CreateBatchJob(contracts.BatchJob{
		OrganizationID: "cloud-a", Type: "product_services_apply", State: "partial_failed",
		Scope: map[string]any{"product_id": "product-a"}, Total: 301, Completed: 300, Failed: 1,
		AuthorizationID: "grant-1", AuthorizationStatus: "active", Checkpoint: map[string]any{"next_position": 301},
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 301; i++ {
		item := contracts.BatchJobItem{JobID: job.ID, ItemKey: fmt.Sprintf("device-%03d", i), Position: i, State: "completed"}
		if i == 300 {
			item.State = "failed"
			item.FailureCode = "UPSTREAM_TEMPORARY"
			item.Retryable = true
		}
		if err := st.UpsertBatchJobItem(item); err != nil {
			t.Fatal(err)
		}
	}
	first, err := st.ListBatchJobItems("cloud-a", job.ID, "", nil, 200, 0)
	if err != nil || first.Total != 301 || len(first.Items) != 200 || first.Items[0].ItemKey != "device-000" {
		t.Fatalf("first results page = %+v, %v", first, err)
	}
	second, err := st.ListBatchJobItems("cloud-a", job.ID, "", nil, 200, 200)
	if err != nil || second.Total != 301 || len(second.Items) != 101 || second.Items[100].ItemKey != "device-300" {
		t.Fatalf("second results page = %+v, %v", second, err)
	}
	crossCloud, err := st.ListBatchJobItems("cloud-b", job.ID, "", nil, 200, 0)
	if err != nil || crossCloud.Total != 0 || len(crossCloud.Items) != 0 {
		t.Fatalf("cross-cloud results leaked: %+v, %v", crossCloud, err)
	}

	retried, receipt, replay, err := st.ActBatchJob("cloud-a", job.ID, "retry", "retry-1")
	if err != nil || replay || receipt.FromState != "partial_failed" || retried.State != "queued" || retried.Completed != 0 || retried.Failed != 0 || retried.Skipped != 0 || retried.Checkpoint["next_position"] != float64(0) {
		t.Fatalf("retry did not reset progress: job=%+v receipt=%+v replay=%v err=%v", retried, receipt, replay, err)
	}
	_, repeatReceipt, replay, err := st.ActBatchJob("cloud-a", job.ID, "retry", "retry-1")
	if err != nil || !replay || repeatReceipt.StateVersion != receipt.StateVersion {
		t.Fatalf("duplicate retry changed job: receipt=%+v replay=%v err=%v", repeatReceipt, replay, err)
	}
	if _, _, _, err := st.ActBatchJob("cloud-a", job.ID, "retry", "retry-2"); err == nil {
		t.Fatal("queued job accepted a second retry action")
	}
	if _, err := st.ListPendingProductApplyCancels(10); err != nil {
		t.Fatal(err)
	}
}
