package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
)

func (s *Server) StartBatchScheduler(ctx context.Context) {
	if s.jobs == nil {
		return
	}
	_ = s.jobs.RecoverBatchJobLeases(time.Now().UTC())
	owner := "worker-" + fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano()))))[:12]
	interval := s.cfg.BatchWorkerPollInterval
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.retryPendingBatchJobRevocations()
				s.runNextDurableBatchJob(ctx, owner)
			}
		}
	}()
}

func (s *Server) retryPendingBatchJobRevocations() {
	jobs, err := s.jobs.ListPendingBatchJobRevocations(25)
	if err != nil {
		return
	}
	for _, job := range jobs {
		s.revokeBatchJobAuthorization(job.OrganizationID, job.ID, job.AuthorizationID)
	}
}

func (s *Server) runNextDurableBatchJob(ctx context.Context, owner string) {
	lease := s.cfg.BatchWorkerLeaseDuration
	if lease <= 0 {
		lease = 30 * time.Second
	}
	job, err := s.jobs.AcquireBatchJob(owner, time.Now().UTC(), lease)
	if errors.Is(err, sql.ErrNoRows) {
		return
	}
	if err != nil {
		return
	}
	defer s.jobs.ReleaseBatchJobLease(job.OrganizationID, job.ID, owner)
	if s.accountClient == nil || !s.accountClient.Enabled() || strings.TrimSpace(s.cfg.AccountManagerJobAuthorizationToken) == "" {
		_ = s.jobs.FailBatchJobAuthorization(job.OrganizationID, job.ID)
		return
	}
	token, err := s.accountClient.ExchangeJobAuthorization(ctx, s.cfg.AccountManagerJobAuthorizationToken, job.AuthorizationID, job.ID, batchScopeHash(job.Scope))
	if err != nil {
		_ = s.jobs.FailBatchJobAuthorization(job.OrganizationID, job.ID)
		return
	}
	s.runDurableProvisioningJob(ctx, job, token.AccessToken, owner, lease)
	terminal, _ := s.jobs.GetBatchJob(job.OrganizationID, job.ID)
	if terminal.State == "completed" || terminal.State == "partial_failed" || terminal.State == "failed" || terminal.State == "cancelled" || terminal.State == "expired" {
		s.revokeBatchJobAuthorization(job.OrganizationID, job.ID, job.AuthorizationID)
	}
}

func (s *Server) revokeBatchJobAuthorization(organizationID, jobID, authorizationID string) {
	if strings.TrimSpace(authorizationID) == "" {
		return
	}
	_ = s.jobs.UpdateBatchJobAuthorizationStatus(organizationID, jobID, "revocation_pending")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.accountClient.RevokeJobAuthorization(ctx, s.cfg.AccountManagerJobAuthorizationToken, authorizationID); err == nil {
		_ = s.jobs.UpdateBatchJobAuthorizationStatus(organizationID, jobID, "revoked")
	}
}

func (s *Server) runDurableProvisioningJob(ctx context.Context, job contracts.BatchJob, accessToken, owner string, lease time.Duration) {
	if job.Type != "provisioning_validation" && job.Type != "device_provision" {
		_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, job.Total, 0)
		return
	}
	if sourceID, _ := job.Scope["source_id"].(string); sourceID != "" {
		if source, err := s.jobs.GetProvisioningSource(job.OrganizationID, sourceID); err != nil || expiredRFC3339(source.ExpiresAt) {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "expired", job.Completed, job.Failed, job.Skipped)
			return
		}
	}
	ids := scopeStringList(job.Scope, "snapshot_ids")
	if len(ids) == 0 {
		ids = scopeStringList(job.Scope, "device_ids")
	}
	start := 0
	if value, ok := job.Checkpoint["next_position"].(float64); ok && int(value) >= 0 {
		start = int(value)
	}
	completed, failed := job.Completed, job.Failed
	results := append([]map[string]any(nil), job.Result...)
	productID, _ := job.Scope["product_id"].(string)
	operationSeed := job.ID
	if retryOf, _ := job.Scope["retry_of"].(string); retryOf != "" {
		operationSeed = retryOf
	}
	attempt := 1
	if value, ok := job.Scope["attempt"].(float64); ok && value > 0 {
		attempt = int(value)
	}
	if job.Type == "provisioning_validation" {
		if _, err := s.accountClient.DeviceItemProfile(ctx, accessToken, job.OrganizationID, productID); err != nil {
			_, _ = s.jobs.UpdateBatchJobProgress(job.OrganizationID, job.ID, "failed", 0, len(ids), 0)
			return
		}
	}
	for position := start; position < len(ids); position++ {
		current, err := s.jobs.CompleteBatchJobBoundary(job.OrganizationID, job.ID, owner)
		if err != nil {
			return
		}
		if current.State == "paused" || current.State == "cancelled" {
			return
		}
		_ = s.jobs.RenewBatchJobLease(job.OrganizationID, job.ID, owner, time.Now().UTC(), lease)
		deviceID := ids[position]
		_ = s.jobs.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: deviceID, Position: position, State: "running", Attempt: attempt})
		device, actionErr := s.accountClient.Device(ctx, accessToken, job.OrganizationID, deviceID)
		if actionErr == nil && device.DeviceItemProfileID != productID {
			actionErr = errors.New("device belongs to another Product")
		}
		operationID := ""
		if actionErr == nil && job.Type == "device_provision" {
			operationID = deterministicOperationID(operationSeed, deviceID)
			_, actionErr = s.accountClient.ProvisionWithOperationID(ctx, accessToken, job.OrganizationID, device, operationID)
		}
		if actionErr != nil {
			retryable, code := retryableJobError(actionErr)
			failed++
			item := contracts.BatchJobItem{JobID: job.ID, ItemKey: deviceID, Position: position, State: "failed", Attempt: attempt, FailureCode: code, FailureReason: "device action failed", Retryable: retryable, UpstreamOperationID: operationID}
			_ = s.jobs.UpsertBatchJobItem(item)
			results = appendOrReplaceResult(results, map[string]any{"device_id": deviceID, "status": "failed", "failure_code": code, "failure_reason": item.FailureReason, "retryable": retryable, "upstream_operation_id": operationID})
		} else {
			completed++
			state := "completed"
			if job.Type == "provisioning_validation" {
				state = "validated"
			}
			_ = s.jobs.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: deviceID, Position: position, State: state, Attempt: attempt, UpstreamOperationID: operationID})
			results = appendOrReplaceResult(results, map[string]any{"device_id": deviceID, "status": state, "retryable": false, "upstream_operation_id": operationID})
		}
		_ = s.jobs.UpdateBatchJobCheckpoint(job.OrganizationID, job.ID, map[string]any{"next_position": position + 1, "last_item_key": deviceID})
		_, _ = s.jobs.UpdateBatchJobResult(job.OrganizationID, job.ID, results)
		_, _ = s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "running", completed, failed, 0)
		current, err = s.jobs.CompleteBatchJobBoundary(job.OrganizationID, job.ID, owner)
		if err != nil {
			return
		}
		if current.State == "paused" || current.State == "cancelled" {
			return
		}
	}
	state := "completed"
	if failed > 0 {
		state = "partial_failed"
	}
	if job.Type == "provisioning_validation" {
		validation := map[string]any{"valid": failed == 0}
		_, _ = s.jobs.UpdateBatchJobScope(job.OrganizationID, job.ID, mergeBatchJobScope(job.Scope, map[string]any{"validation": validation}))
	}
	_, _ = s.jobs.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, state, completed, failed, 0)
}

func scopeStringList(scope map[string]any, key string) []string {
	out := []string{}
	switch raw := scope[key].(type) {
	case []any:
		for _, value := range raw {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, text)
			}
		}
	case []string:
		out = append(out, raw...)
	}
	return out
}
func expiredRFC3339(value string) bool {
	parsed, err := time.Parse(time.RFC3339, value)
	return err != nil || !parsed.After(time.Now().UTC())
}
func deterministicOperationID(jobID, itemKey string) string {
	sum := sha256.Sum256([]byte(jobID + "\x00" + itemKey))
	b := sum[:16]
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func retryableJobError(err error) (bool, string) {
	var upstream *accountclient.HTTPError
	if errors.As(err, &upstream) {
		if upstream.StatusCode == http.StatusTooManyRequests || upstream.StatusCode >= 500 {
			return true, "UPSTREAM_TRANSIENT"
		}
		return false, "UPSTREAM_REJECTED"
	}
	return true, "UPSTREAM_UNAVAILABLE"
}
func appendOrReplaceResult(items []map[string]any, next map[string]any) []map[string]any {
	key := fmt.Sprint(next["device_id"])
	for index, item := range items {
		if fmt.Sprint(item["device_id"]) == key {
			items[index] = next
			return items
		}
	}
	return append(items, next)
}
