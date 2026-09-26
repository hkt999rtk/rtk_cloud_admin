package app

import (
	"context"
	"fmt"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
)

// The Account Manager owns the immutable target and device set. The console
// keeps only a durable cursor and per-device results; a 202 dispatch never
// advances the cursor until the upstream applied revision is observed.
func (s *Server) runDurableProductServiceApplyJob(ctx context.Context, job contracts.BatchJob, token, owner string, lease time.Duration) {
	product, _ := job.Scope["product_id"].(string)
	if product == "" || job.Total < 0 {
		s.failProductApplyJob(job)
		return
	}
	target, ok := scopeRevision(job.Scope["target_revision"])
	if !ok || target < 1 {
		s.failProductApplyJob(job)
		return
	}
	job, err := s.jobs.ReconcileProductApplyProgress(job.OrganizationID, job.ID)
	if err != nil {
		s.failProductApplyJob(job)
		return
	}
	upstream, err := s.accountClient.ServiceApplyJob(ctx, token, job.OrganizationID, product, job.ID)
	if err != nil {
		s.yieldProductApplyJob(job)
		return
	}
	if upstream.TargetRevision != target || upstream.TargetDigest != job.Scope["target_digest"] || upstream.TotalDevices != job.Total {
		s.failProductApplyJob(job)
		return
	}
	if upstream.Status == "canceled" || upstream.Status == "cancelled" {
		_, _ = s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "cancelled", job.Completed, job.Failed, job.Total-job.Completed-job.Failed)
		return
	}
	start := 0
	if value, valid := scopeRevision(job.Checkpoint["next_position"]); valid && value >= 0 {
		start = int(value)
	}
	completed, failed := job.Completed, job.Failed
	for position, processed := start, 0; position < job.Total && processed < 100; position, processed = position+1, processed+1 {
		current, err := s.jobs.CompleteBatchJobBoundary(job.OrganizationID, job.ID, owner)
		if err != nil || current.State == "paused" || current.State == "cancelled" {
			return
		}
		_ = s.jobs.RenewBatchJobLease(job.OrganizationID, job.ID, owner, time.Now().UTC(), lease)
		item, err := s.productApplyItem(ctx, token, job, product, position)
		if err != nil {
			s.yieldProductApplyJob(job)
			return
		}
		attempt := 1
		if item.Status == "pending" || (item.Status == "failed" && item.Retryable) {
			if err = s.accountClient.DispatchServiceApplyItem(ctx, token, job.OrganizationID, product, job.ID, item.DeviceID); err != nil {
				// Response loss is ambiguous. The fixed operation ID lets the next
				// scheduler pass safely read and resend the same operation.
				s.recordProductApplyWaiting(job, item, position, attempt)
				s.yieldProductApplyJob(job)
				return
			}
			item, err = s.productApplyItem(ctx, token, job, product, position)
			if err != nil {
				s.yieldProductApplyJob(job)
				return
			}
		}
		switch item.Status {
		case "applied":
			if item.AppliedRevision != target {
				s.failProductApplyJob(job)
				return
			}
			job, err = s.jobs.CommitProductApplyResult(job.OrganizationID, job.ID, contracts.BatchJobItem{JobID: job.ID, ItemKey: item.DeviceID, Position: position, State: "completed", Attempt: attempt, UpstreamOperationID: item.OperationID})
		case "failed":
			code := item.FailureCode
			if code == "" {
				code = "UPSTREAM_APPLY_FAILED"
			}
			job, err = s.jobs.CommitProductApplyResult(job.OrganizationID, job.ID, contracts.BatchJobItem{JobID: job.ID, ItemKey: item.DeviceID, Position: position, State: "failed", Attempt: attempt, FailureCode: code, FailureReason: "Product authorization was not applied", Retryable: item.Retryable, UpstreamOperationID: item.OperationID})
		case "accepted", "pending", "running":
			s.recordProductApplyWaiting(job, item, position, attempt)
			s.yieldProductApplyJob(job)
			return
		default:
			s.failProductApplyJob(job)
			return
		}
		if err != nil {
			s.yieldProductApplyJob(job)
			return
		}
		completed, failed = job.Completed, job.Failed
	}
	if completed+failed < job.Total {
		s.yieldProductApplyJob(job)
		return
	}
	if failed != 0 {
		updated, _ := s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "partial_failed", completed, failed, 0)
		if !updated.Retryable {
			if err := s.accountClient.CancelServiceApplyJob(ctx, token, job.OrganizationID, product, job.ID); err == nil {
				s.revokeBatchJobAuthorization(job.OrganizationID, job.ID, job.AuthorizationID)
			}
		}
		return
	}
	if err := s.accountClient.CompleteServiceApplyJob(ctx, token, job.OrganizationID, product, job.ID); err != nil {
		// Completion is idempotent and releases the one-job-per-Product lock.
		// Keep this job resumable until that acknowledgement is received.
		s.yieldProductApplyJob(job)
		return
	}
	_, _ = s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "completed", completed, 0, 0)
}

func (s *Server) productApplyItem(ctx context.Context, token string, job contracts.BatchJob, product string, position int) (accountclient.ServiceApplyItem, error) {
	page, err := s.accountClient.ServiceApplyItems(ctx, token, job.OrganizationID, product, job.ID, 1, position)
	if err != nil {
		return accountclient.ServiceApplyItem{}, err
	}
	if page.Total != job.Total || len(page.Items) != 1 || page.Items[0].DeviceID == "" || page.Items[0].OperationID == "" {
		return accountclient.ServiceApplyItem{}, fmt.Errorf("Product apply device set changed")
	}
	return page.Items[0], nil
}

func (s *Server) recordProductApplyWaiting(job contracts.BatchJob, item accountclient.ServiceApplyItem, position, attempt int) {
	_ = s.jobs.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: item.DeviceID, Position: position, State: "running", Attempt: attempt, UpstreamOperationID: item.OperationID})
}

func (s *Server) yieldProductApplyJob(job contracts.BatchJob) {
	_ = s.jobs.YieldProductApplyJob(job.OrganizationID, job.ID)
}

func (s *Server) failProductApplyJob(job contracts.BatchJob) {
	_, _ = s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "failed", job.Completed, job.Failed+1, 0)
}

func scopeRevision(value any) (int64, bool) {
	switch n := value.(type) {
	case int64:
		return n, true
	case int:
		return int64(n), true
	case float64:
		return int64(n), n == float64(int64(n))
	default:
		return 0, false
	}
}
