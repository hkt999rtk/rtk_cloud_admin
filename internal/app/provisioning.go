package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/correlation"
	"rtk_cloud_admin/internal/store"
)

const (
	provisioningCSVLimit = 10 << 20
	provisioningRowLimit = 100000
)

func (s *Server) apiProvisioningSource(w http.ResponseWriter, r *http.Request) {
	session, org, tokens, ok := s.provisioningContext(w, r)
	if !ok {
		return
	}
	key, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(provisioningCSVLimit); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_SOURCE_INVALID", "message": "A CSV file smaller than 10 MiB is required."})
		return
	}
	productID := strings.TrimSpace(r.FormValue("product_id"))
	if productID == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PRODUCT_REQUIRED", "message": "product_id is required."})
		return
	}
	if s.accountClient == nil {
		http.Error(w, "Product validation is unavailable.", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.accountClient.DeviceItemProfile(r.Context(), tokens.AccessToken, org.ID, productID); err != nil {
		writeJSONStatus(w, http.StatusUnprocessableEntity, map[string]any{"code": "PRODUCT_SCOPE_INVALID", "message": "Product does not belong to this Brand Cloud."})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_SOURCE_INVALID", "message": "CSV file field is required."})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, provisioningCSVLimit+1))
	if err != nil || len(raw) == 0 || len(raw) > provisioningCSVLimit {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_SOURCE_INVALID", "message": "CSV file is empty or exceeds 10 MiB."})
		return
	}
	deviceIDs, err := parseProvisioningCSV(raw)
	if err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_SOURCE_INVALID", "message": err.Error()})
		return
	}
	checksum := fmt.Sprintf("sha256:%x", sha256.Sum256(raw))
	if existing, lookupErr := s.jobs.GetProvisioningSourceByIdempotency(org.ID, key); lookupErr == nil {
		if existing.Checksum != checksum || existing.Product != productID || existing.ProductionRun != strings.TrimSpace(r.FormValue("production_run")) {
			writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "IDEMPOTENCY_KEY_REUSED", "message": "Idempotency-Key was already used with different source data."})
			return
		}
		writeJSON(w, map[string]any{"source": existing, "source_status": "available", "idempotent_replay": true})
		return
	}
	source, err := s.jobs.CreateProvisioningSource(contracts.ProvisioningSource{
		OrganizationID: org.ID,
		Product:        productID,
		ProductionRun:  strings.TrimSpace(r.FormValue("production_run")),
		Filename:       header.Filename,
		Checksum:       checksum,
		RowCount:       len(deviceIDs),
		DeviceIDs:      deviceIDs,
	}, key)
	if err != nil {
		http.Error(w, "Provisioning source could not be stored.", http.StatusServiceUnavailable)
		return
	}
	_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "provisioning.source.create", Target: source.ID, OrganizationID: org.ID, Result: "accepted", RequestID: correlation.FromContext(r.Context()).RequestID})
	writeJSONStatus(w, http.StatusCreated, map[string]any{"source": source, "source_status": "available"})
}

func parseProvisioningCSV(raw []byte) ([]string, error) {
	reader := csv.NewReader(strings.NewReader(string(raw)))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil || len(records) < 2 || len(records[0]) == 0 || !strings.EqualFold(strings.TrimSpace(records[0][0]), "device_id") {
		return nil, errors.New("CSV must contain a device_id header and at least one data row")
	}
	if len(records)-1 > provisioningRowLimit {
		return nil, fmt.Errorf("CSV exceeds the %d-device limit", provisioningRowLimit)
	}
	seen := make(map[string]struct{}, len(records)-1)
	deviceIDs := make([]string, 0, len(records)-1)
	for rowNumber, record := range records[1:] {
		if len(record) == 0 || strings.TrimSpace(record[0]) == "" {
			return nil, fmt.Errorf("row %d has no device_id", rowNumber+2)
		}
		deviceID := strings.TrimSpace(record[0])
		if _, exists := seen[deviceID]; exists {
			return nil, fmt.Errorf("row %d duplicates device_id %s", rowNumber+2, deviceID)
		}
		seen[deviceID] = struct{}{}
		deviceIDs = append(deviceIDs, deviceID)
	}
	return deviceIDs, nil
}

func (s *Server) apiProvisioningValidate(w http.ResponseWriter, r *http.Request) {
	session, org, tokens, ok := s.provisioningContext(w, r)
	if !ok {
		return
	}
	key, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var request struct {
		SourceID string `json:"source_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil || strings.TrimSpace(request.SourceID) == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_SOURCE_REQUIRED", "message": "source_id is required."})
		return
	}
	source, ok := s.currentProvisioningSource(w, org.ID, request.SourceID)
	if !ok {
		return
	}
	scope := map[string]any{
		"source_id":  source.ID,
		"checksum":   source.Checksum,
		"product_id": source.Product,
		"device_ids": stringSliceToAny(source.DeviceIDs),
		"validation": map[string]any{"valid": true},
	}
	job, replay, ok := s.createProvisioningJob(r.Context(), w, tokens.AccessToken, contracts.BatchJob{Type: "provisioning_validation", Name: "Validate " + source.Filename, OrganizationID: org.ID, CreatedBy: session.Email, Scope: scope, State: "queued", Total: source.RowCount, IdempotencyKey: key}, key)
	if !ok {
		return
	}
	if !replay {
		_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "provisioning.validate", Target: job.ID, OrganizationID: org.ID, Result: "accepted", RequestID: correlation.FromContext(r.Context()).RequestID})
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": job, "source_status": "available", "idempotent_replay": replay})
}

func (s *Server) apiProvisioningExecute(w http.ResponseWriter, r *http.Request) {
	session, org, tokens, ok := s.provisioningContext(w, r)
	if !ok {
		return
	}
	key, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var request struct {
		SourceID        string `json:"source_id"`
		ValidationJobID string `json:"validation_job_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil || strings.TrimSpace(request.SourceID) == "" || strings.TrimSpace(request.ValidationJobID) == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "PROVISIONING_CONFIRMATION_REQUIRED", "message": "source_id and validation_job_id are required."})
		return
	}
	source, ok := s.currentProvisioningSource(w, org.ID, request.SourceID)
	if !ok {
		return
	}
	validation, err := s.jobs.GetBatchJob(org.ID, request.ValidationJobID)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	valid, _ := validation.Scope["validation"].(map[string]any)["valid"].(bool)
	if err != nil || validation.Type != "provisioning_validation" || validation.State != "completed" || fmt.Sprint(validation.Scope["source_id"]) != source.ID || !valid {
		writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "PROVISIONING_VALIDATION_REQUIRED", "message": "A completed validation for the same immutable source is required."})
		return
	}
	scope := map[string]any{
		"source_id":         source.ID,
		"validation_job_id": validation.ID,
		"checksum":          source.Checksum,
		"product_id":        source.Product,
		"snapshot_ids":      stringSliceToAny(source.DeviceIDs),
		"snapshot_at":       time.Now().UTC().Format(time.RFC3339),
	}
	job, replay, ok := s.createProvisioningJob(r.Context(), w, tokens.AccessToken, contracts.BatchJob{Type: "device_provision", Name: "Provision " + source.Filename, OrganizationID: org.ID, CreatedBy: session.Email, Scope: scope, State: "queued", Total: source.RowCount, IdempotencyKey: key}, key)
	if !ok {
		return
	}
	if !replay {
		_ = s.audit.CreateAuditEventWithMetadata(store.AuditEventInput{Actor: session.Email, ActorKind: session.Kind, Action: "provisioning.execute", Target: job.ID, OrganizationID: org.ID, Result: "accepted", RequestID: correlation.FromContext(r.Context()).RequestID})
	}
	writeJSONStatus(w, http.StatusAccepted, map[string]any{"job": job, "source_status": "available", "idempotent_replay": replay})
}

func (s *Server) provisioningContext(w http.ResponseWriter, r *http.Request) (store.Session, accountclient.Organization, accountclient.Tokens, bool) {
	session, authenticated := s.customerSession(r)
	if !authenticated {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return session, accountclient.Organization{}, accountclient.Tokens{}, false
	}
	org, accountTokens, err := s.activeCustomerOrg(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return session, accountclient.Organization{}, accountclient.Tokens{}, false
	}
	if !requireCustomerCapability(w, org, capabilityProvisioningCreate) {
		return session, accountclient.Organization{}, accountclient.Tokens{}, false
	}
	return session, org, accountTokens, true
}

func (s *Server) currentProvisioningSource(w http.ResponseWriter, organizationID, sourceID string) (contracts.ProvisioningSource, bool) {
	source, err := s.jobs.GetProvisioningSource(organizationID, strings.TrimSpace(sourceID))
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "The provisioning source was not found.", http.StatusNotFound)
		return contracts.ProvisioningSource{}, false
	}
	if err != nil {
		http.Error(w, "Provisioning source is temporarily unavailable.", http.StatusServiceUnavailable)
		return contracts.ProvisioningSource{}, false
	}
	expiresAt, err := time.Parse(time.RFC3339, source.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now().UTC()) {
		writeJSONStatus(w, http.StatusGone, map[string]any{"code": "PROVISIONING_SOURCE_EXPIRED", "message": "The provisioning source has expired."})
		return contracts.ProvisioningSource{}, false
	}
	return source, true
}

func (s *Server) createProvisioningJob(ctx context.Context, w http.ResponseWriter, accessToken string, job contracts.BatchJob, key string) (contracts.BatchJob, bool, bool) {
	if existing, err := s.jobs.GetBatchJobByIdempotency(job.OrganizationID, key); err == nil {
		if existing.Type != job.Type || fmt.Sprint(existing.Scope["source_id"]) != fmt.Sprint(job.Scope["source_id"]) {
			writeJSONStatus(w, http.StatusConflict, map[string]any{"code": "IDEMPOTENCY_KEY_REUSED", "message": "Idempotency-Key was already used with different provisioning data."})
			return contracts.BatchJob{}, false, false
		}
		return existing, true, true
	}
	if s.accountClient == nil || strings.TrimSpace(s.cfg.AccountManagerJobAuthorizationToken) == "" {
		http.Error(w, "Background job authorization is unavailable.", http.StatusServiceUnavailable)
		return contracts.BatchJob{}, false, false
	}
	job.ID = "job-" + fmt.Sprintf("%x", sha256.Sum256([]byte(job.OrganizationID+"\x00"+key+"\x00"+job.Type)))[:24]
	productID, _ := job.Scope["product_id"].(string)
	grant, err := s.accountClient.CreateJobAuthorization(ctx, accessToken, job.OrganizationID, job.ID, batchScopeHash(job.Scope), capabilityProvisioningCreate, []string{productID}, time.Now().UTC().Add(6*24*time.Hour+23*time.Hour))
	if err != nil {
		http.Error(w, "Background job authorization could not be created.", http.StatusServiceUnavailable)
		return contracts.BatchJob{}, false, false
	}
	job.AuthorizationID = grant.ID
	job.AuthorizationStatus = "active"
	created, err := s.jobs.CreateBatchJob(job)
	if err != nil {
		_ = s.accountClient.RevokeJobAuthorization(context.Background(), s.cfg.AccountManagerJobAuthorizationToken, grant.ID)
		http.Error(w, "Provisioning job could not be created.", http.StatusServiceUnavailable)
		return contracts.BatchJob{}, false, false
	}
	return created, false, true
}

func stringSliceToAny(values []string) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}
