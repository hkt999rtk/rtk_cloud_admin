package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"rtk_cloud_admin/internal/contracts"
)

// ReconcileProductApplyProgress repairs an interrupted worker using only the
// results before its durable cursor. Items beyond the cursor belong to an
// earlier attempt and must not count after a retry resets the cursor.
func (s *Store) ReconcileProductApplyProgress(organizationID, jobID string) (contracts.BatchJob, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return contracts.BatchJob{}, err
	}
	defer tx.Rollback()
	next, total, err := productApplyCursor(tx, organizationID, jobID)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	completed, failed, err := productApplyResultCounts(tx, jobID, next)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if next > total {
		return contracts.BatchJob{}, fmt.Errorf("Product apply checkpoint exceeds device count")
	}
	if _, err = tx.Exec(`UPDATE batch_jobs SET completed=?,failed=?,updated_at=? WHERE organization_id=? AND id=?`,
		completed, failed, time.Now().UTC().Format(time.RFC3339Nano), organizationID, jobID); err != nil {
		return contracts.BatchJob{}, err
	}
	if err = tx.Commit(); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, jobID)
}

// YieldProductApplyJob leaves pause and cancellation transitions untouched.
func (s *Store) YieldProductApplyJob(organizationID, jobID string) error {
	_, err := s.db.Exec(`UPDATE batch_jobs SET state='queued',updated_at=?
		WHERE organization_id=? AND id=? AND type='product_services_apply' AND state='running'`,
		time.Now().UTC().Format(time.RFC3339Nano), organizationID, jobID)
	return err
}

// CommitProductApplyResult stores the item, counts, and cursor in one SQLite
// transaction so a process restart cannot skip an applied or failed device.
func (s *Store) CommitProductApplyResult(organizationID, jobID string, item contracts.BatchJobItem) (contracts.BatchJob, error) {
	if item.JobID != jobID || item.ItemKey == "" || item.Position < 0 ||
		(item.State != "completed" && item.State != "failed") {
		return contracts.BatchJob{}, fmt.Errorf("invalid Product apply result")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return contracts.BatchJob{}, err
	}
	defer tx.Rollback()
	next, total, err := productApplyCursor(tx, organizationID, jobID)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if item.Position != next || item.Position >= total {
		return contracts.BatchJob{}, fmt.Errorf("Product apply result is outside the current checkpoint")
	}
	var existingKey string
	err = tx.QueryRow(`SELECT item_key FROM batch_job_items WHERE job_id=? AND position=? LIMIT 1`, jobID, item.Position).Scan(&existingKey)
	if err != nil && err != sql.ErrNoRows {
		return contracts.BatchJob{}, err
	}
	if err == nil && existingKey != item.ItemKey {
		return contracts.BatchJob{}, fmt.Errorf("Product apply device changed at checkpoint")
	}
	if item.UpdatedAt == "" {
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if _, err = tx.Exec(`INSERT INTO batch_job_items(job_id,item_key,position,state,attempt,failure_code,failure_reason,retryable,upstream_operation_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(job_id,item_key) DO UPDATE SET state=excluded.state,attempt=excluded.attempt,failure_code=excluded.failure_code,failure_reason=excluded.failure_reason,retryable=excluded.retryable,upstream_operation_id=excluded.upstream_operation_id,updated_at=excluded.updated_at`,
		item.JobID, item.ItemKey, item.Position, item.State, item.Attempt, item.FailureCode, item.FailureReason,
		item.Retryable, item.UpstreamOperationID, item.UpdatedAt); err != nil {
		return contracts.BatchJob{}, err
	}
	next++
	completed, failed, err := productApplyResultCounts(tx, jobID, next)
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if completed+failed != next {
		return contracts.BatchJob{}, fmt.Errorf("Product apply checkpoint contains missing results")
	}
	checkpoint, err := json.Marshal(map[string]int{"next_position": next})
	if err != nil {
		return contracts.BatchJob{}, err
	}
	if _, err = tx.Exec(`UPDATE batch_jobs SET checkpoint_json=?,completed=?,failed=?,
		state=CASE WHEN state IN ('queued','running') THEN 'running' ELSE state END,updated_at=? WHERE organization_id=? AND id=?`,
		checkpoint, completed, failed, time.Now().UTC().Format(time.RFC3339Nano), organizationID, jobID); err != nil {
		return contracts.BatchJob{}, err
	}
	if err = tx.Commit(); err != nil {
		return contracts.BatchJob{}, err
	}
	return s.GetBatchJob(organizationID, jobID)
}

func productApplyCursor(tx *sql.Tx, organizationID, jobID string) (int, int, error) {
	var kind, raw string
	var total int
	if err := tx.QueryRow(`SELECT type,total,checkpoint_json FROM batch_jobs WHERE organization_id=? AND id=?`, organizationID, jobID).
		Scan(&kind, &total, &raw); err != nil {
		return 0, 0, err
	}
	if kind != "product_services_apply" {
		return 0, 0, fmt.Errorf("job is not a Product service apply")
	}
	var checkpoint struct {
		NextPosition *int `json:"next_position"`
	}
	if err := json.Unmarshal([]byte(raw), &checkpoint); err != nil {
		return 0, 0, err
	}
	next := 0
	if checkpoint.NextPosition != nil {
		next = *checkpoint.NextPosition
	}
	if next < 0 || next > total {
		return 0, 0, fmt.Errorf("invalid Product apply checkpoint")
	}
	return next, total, nil
}

func productApplyResultCounts(tx *sql.Tx, jobID string, next int) (int, int, error) {
	var terminal, completed, failed int
	err := tx.QueryRow(`SELECT count(*),COALESCE(sum(CASE WHEN state='completed' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN state='failed' THEN 1 ELSE 0 END),0)
		FROM batch_job_items WHERE job_id=? AND position<?`, jobID, next).Scan(&terminal, &completed, &failed)
	if err != nil {
		return 0, 0, err
	}
	if terminal != next || completed+failed != next {
		return 0, 0, fmt.Errorf("Product apply checkpoint contains incomplete results")
	}
	return completed, failed, nil
}
