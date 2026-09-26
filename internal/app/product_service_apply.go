package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

const capabilityProductServicesApply = "product_services.apply"

func productApplyJobID(cloud, product, key string) string {
	sum := sha256.Sum256([]byte(cloud + "\x00" + product + "\x00" + key + "\x00product_services_apply"))
	return fmt.Sprintf("job-%x", sum[:12])
}

func productApplyPreviewHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("sha256:%x", sum[:])
}

func (s *Server) createProductApplyJob(w http.ResponseWriter, r *http.Request, session store.Session, cloud, product, token, previewToken, key string) {
	if previewToken == "" || len(previewToken) > 4096 {
		http.Error(w, "A current Product apply preview is required.", http.StatusBadRequest)
		return
	}
	jobID := productApplyJobID(cloud, product, key)
	previewHash := productApplyPreviewHash(previewToken)
	if existing, err := s.jobs.GetBatchJobByIdempotency(cloud, key); err == nil {
		if existing.Type != "product_services_apply" || existing.ID != jobID || existing.Scope["product_id"] != product || existing.Scope["preview_hash"] != previewHash {
			writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "IDEMPOTENCY_KEY_REUSED"})
			return
		}
		writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": existing, "idempotent_replay": true})
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "Batch job storage is unavailable.", http.StatusServiceUnavailable)
		return
	}
	if s.accountClient == nil || !s.accountClient.Enabled() || strings.TrimSpace(s.cfg.AccountManagerJobAuthorizationToken) == "" {
		http.Error(w, "Product apply authorization is unavailable.", http.StatusServiceUnavailable)
		return
	}
	upstream, err := s.accountClient.CreateServiceApplyJob(r.Context(), token, cloud, product, jobID, previewToken)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	scope := map[string]any{"product_id": product, "upstream_job_id": upstream.ID, "target_revision": upstream.TargetRevision, "target_digest": upstream.TargetDigest, "preview_hash": previewHash}
	// Account Manager returns the original creation time on every idempotent
	// admission. Use it so a lost authorization response can be retried with
	// exactly the same grant request and expiry.
	expiresAt := upstream.CreatedAt.UTC().Add(6*24*time.Hour + 23*time.Hour)
	grant, err := s.accountClient.CreateJobAuthorization(r.Context(), token, cloud, jobID, batchScopeHash(scope), capabilityProductServicesApply, []string{product}, expiresAt)
	if err != nil {
		var upstreamError *accountclient.HTTPError
		if errors.As(err, &upstreamError) && upstreamError.StatusCode >= 400 && upstreamError.StatusCode < 500 {
			_ = s.accountClient.CancelServiceApplyJob(context.Background(), token, cloud, product, jobID)
		}
		s.managedCloudError(w, session.ID, err)
		return
	}
	job := contracts.BatchJob{ID: jobID, Type: "product_services_apply", Name: "Apply Product services", OrganizationID: cloud, CreatedBy: session.Email, Scope: scope, State: "queued", Total: upstream.TotalDevices, IdempotencyKey: key, AuthorizationID: grant.ID, AuthorizationStatus: "active"}
	created, err := s.jobs.CreateBatchJob(job)
	if err != nil {
		if existing, readErr := s.jobs.GetBatchJobByIdempotency(cloud, key); readErr == nil {
			if existing.Type == "product_services_apply" && existing.ID == jobID && existing.Scope["product_id"] == product && existing.Scope["preview_hash"] == previewHash {
				writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": existing, "idempotent_replay": true})
				return
			}
			_ = s.accountClient.RevokeJobAuthorization(context.Background(), s.cfg.AccountManagerJobAuthorizationToken, grant.ID)
			_ = s.accountClient.CancelServiceApplyJob(context.Background(), token, cloud, product, jobID)
			writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "IDEMPOTENCY_KEY_REUSED"})
			return
		}
		// A database error can be an ambiguous commit. Keep the upstream job and
		// authorization so the same idempotency key can reconcile them on retry.
		http.Error(w, "Product apply job could not be stored.", http.StatusServiceUnavailable)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": created})
}

func (s *Server) authorizeCustomerProductApplyJob(w http.ResponseWriter, r *http.Request, session store.Session, cloud, token string, job contracts.BatchJob, manage bool) bool {
	if s.accountClient == nil || !s.accountClient.Enabled() {
		http.Error(w, "Product apply is unavailable", http.StatusServiceUnavailable)
		return false
	}
	access := "registry_device.read"
	if manage {
		access = "registry_device.manage"
	}
	product, _ := job.Scope["product_id"].(string)
	if product == "" || !managedCloudUUID.MatchString(product) {
		http.NotFound(w, r)
		return false
	}
	allowed, err := s.accountClient.CheckAccess(r.Context(), token, cloud, access, "product", product)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return false
	}
	if !allowed {
		http.NotFound(w, r)
		return false
	}
	return true
}

func (s *Server) apiManagedProductServiceApply(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") {
		http.Error(w, "global account authentication required", http.StatusUnauthorized)
		return
	}
	cloud, product := r.PathValue("brandCloudID"), r.PathValue("productID")
	if !managedCloudUUID.MatchString(cloud) || !managedCloudUUID.MatchString(product) {
		http.Error(w, "invalid Product scope", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodGet && !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	detail, err := s.accountClient.ManagedCloudCommand(ctx, session.AccessToken, http.MethodGet, cloud, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if detail.BrandCloud == nil || !hasCapability(detail.BrandCloud.Capabilities, "product.read") {
		http.Error(w, "Product access forbidden", http.StatusForbidden)
		return
	}
	p, err := s.accountClient.DeviceItemProfile(ctx, session.AccessToken, cloud, product)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if p.ID != product || p.BrandCloudID != cloud {
		http.Error(w, "invalid upstream Product scope", http.StatusBadGateway)
		return
	}
	if !hasCapability(scopedProductProjection(p, *detail.BrandCloud).Actions, "edit") {
		http.Error(w, "Product apply forbidden", http.StatusForbidden)
		return
	}
	allowed, err := s.accountClient.CheckAccess(ctx, session.AccessToken, cloud, "registry_device.manage", "product", product)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if !allowed {
		http.Error(w, "Product apply forbidden", http.StatusForbidden)
		return
	}
	jobID := r.PathValue("jobID")
	if jobID == "" {
		if r.Method == http.MethodGet {
			if strings.HasSuffix(r.URL.Path, "/service-apply-preview") {
				preview, err := s.accountClient.ServiceApplyPreview(ctx, session.AccessToken, cloud, product)
				if err != nil {
					s.managedCloudError(w, session.ID, err)
					return
				}
				writeJSON(w, preview)
			} else {
				jobs, err := s.jobs.ListProductApplyJobs(cloud, product, 25)
				if err != nil {
					http.Error(w, "Product apply jobs are unavailable", http.StatusServiceUnavailable)
					return
				}
				writeJSON(w, map[string]any{"jobs": jobs})
			}
			return
		}
		key, ok := requireIdempotencyKey(w, r)
		if !ok {
			return
		}
		var input struct {
			PreviewToken string `json:"preview_token"`
		}
		if decodeStrictManagedJSON(w, r, &input) != nil {
			http.Error(w, "Invalid Product apply request.", http.StatusBadRequest)
			return
		}
		s.createProductApplyJob(w, r.WithContext(ctx), session, cloud, product, session.AccessToken, input.PreviewToken, key)
		return
	}
	job, err := s.jobs.GetBatchJob(cloud, jobID)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "Batch job storage is unavailable.", http.StatusServiceUnavailable)
		return
	}
	if job.Type != "product_services_apply" || job.Scope["product_id"] != product {
		http.NotFound(w, r)
		return
	}
	if r.PathValue("action") != "" {
		key, ok := requireIdempotencyKey(w, r)
		if !ok {
			return
		}
		action := r.PathValue("action")
		if action != "pause" && action != "resume" && action != "cancel" && action != "retry" {
			http.NotFound(w, r)
			return
		}
		s.actProductApplyJob(w, r.WithContext(ctx), session, job, action, key)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/items") {
		s.writeProductApplyItems(w, r, job, session.AccessToken)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/result") {
		s.writeProductApplyResult(w, r, job, session.AccessToken)
		return
	}
	writeJSON(w, map[string]any{"job": job})
}

func (s *Server) actProductApplyJob(w http.ResponseWriter, r *http.Request, session store.Session, job contracts.BatchJob, action, key string) {
	updated, receipt, replay, err := s.jobs.ActBatchJob(job.OrganizationID, job.ID, action, key)
	if err != nil {
		http.Error(w, "This action conflicts with the current job state.", http.StatusConflict)
		return
	}
	if action == "cancel" {
		product, _ := job.Scope["product_id"].(string)
		if err := s.accountClient.CancelServiceApplyJob(r.Context(), session.AccessToken, job.OrganizationID, product, job.ID); err != nil {
			// The local cancelling state prevents further dispatch; the scheduler
			// retries the upstream cancel before releasing the authorization.
			writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": updated, "receipt": receipt, "upstream_cancel_pending": true})
			return
		}
		if updated.State == "cancelled" {
			s.revokeBatchJobAuthorization(job.OrganizationID, job.ID, updated.AuthorizationID)
		}
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": updated, "receipt": receipt, "idempotent_replay": replay})
}

func projectProductApplyItem(item accountclient.ServiceApplyItem, position int, jobID string) contracts.BatchJobItem {
	state := item.Status
	if state == "applied" {
		state = "completed"
	}
	if state == "accepted" {
		state = "running"
	}
	if state == "pending" {
		state = "queued"
	}
	return contracts.BatchJobItem{JobID: jobID, ItemKey: item.DeviceID, Position: position, State: state, Attempt: 1, FailureCode: item.FailureCode, Retryable: item.Retryable, UpstreamOperationID: item.OperationID}
}

func (s *Server) writeProductApplyItems(w http.ResponseWriter, r *http.Request, job contracts.BatchJob, token string) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit < 1 || limit > 250 {
		limit = 100
	}
	if offset < 0 {
		http.Error(w, "invalid offset", http.StatusBadRequest)
		return
	}
	if job.State == "cancelled" && token != "" {
		product, _ := job.Scope["product_id"].(string)
		upstream, err := s.accountClient.ServiceApplyItems(r.Context(), token, job.OrganizationID, product, job.ID, limit, offset)
		if err == nil && upstream.Total == job.Total {
			items := make([]contracts.BatchJobItem, 0, len(upstream.Items))
			for i, item := range upstream.Items {
				items = append(items, projectProductApplyItem(item, offset+i, job.ID))
			}
			writeJSON(w, map[string]any{"items": items, "pagination": map[string]int{"limit": limit, "offset": offset, "total": upstream.Total}})
			return
		}
	}
	page, err := s.jobs.ListBatchJobItems(job.OrganizationID, job.ID, "", nil, limit, offset)
	if err != nil {
		http.Error(w, "Batch job items are unavailable.", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{"items": page.Items, "pagination": map[string]int{"limit": page.Limit, "offset": page.Offset, "total": page.Total}})
}

func (s *Server) writeProductApplyResult(w http.ResponseWriter, r *http.Request, job contracts.BatchJob, token string) {
	if r.URL.Query().Get("format") != "csv" {
		http.Error(w, "CSV format required", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=product-services-apply.csv")
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"device_id", "status", "attempt", "failure_code", "retryable", "operation_id"})
	if job.State == "cancelled" && token != "" {
		product, _ := job.Scope["product_id"].(string)
		for offset := 0; ; offset += 250 {
			page, err := s.accountClient.ServiceApplyItems(r.Context(), token, job.OrganizationID, product, job.ID, 250, offset)
			if err != nil || page.Total != job.Total {
				return
			}
			for i, upstream := range page.Items {
				item := projectProductApplyItem(upstream, offset+i, job.ID)
				_ = writer.Write([]string{item.ItemKey, item.State, strconv.Itoa(item.Attempt), item.FailureCode, strconv.FormatBool(item.Retryable), item.UpstreamOperationID})
			}
			if offset+len(page.Items) >= page.Total {
				break
			}
		}
		writer.Flush()
		return
	}
	for offset := 0; ; offset += 250 {
		page, err := s.jobs.ListBatchJobItems(job.OrganizationID, job.ID, "", nil, 250, offset)
		if err != nil {
			return
		}
		for _, item := range page.Items {
			_ = writer.Write([]string{item.ItemKey, item.State, strconv.Itoa(item.Attempt), item.FailureCode, strconv.FormatBool(item.Retryable), item.UpstreamOperationID})
		}
		if offset+len(page.Items) >= page.Total {
			break
		}
	}
	writer.Flush()
}
