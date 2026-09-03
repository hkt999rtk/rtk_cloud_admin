package app

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

func TestParseProvisioningCSV(t *testing.T) {
	ids, err := parseProvisioningCSV([]byte("device_id,name\ndev-1,One\ndev-2,Two\n"))
	if err != nil || len(ids) != 2 || ids[1] != "dev-2" {
		t.Fatalf("ids=%v err=%v", ids, err)
	}
	for _, input := range []string{"", "wrong\ndev-1\n", "device_id\n\n", "device_id\ndev-1\ndev-1\n"} {
		if _, err := parseProvisioningCSV([]byte(input)); err == nil {
			t.Fatalf("invalid CSV accepted: %q", input)
		}
	}
}

func TestScopedProvisioningCSVValidationAndExecution(t *testing.T) {
	deviceID := "77777777-7777-4777-8777-777777777777"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]string{"id": "owner-1", "email": "owner@example.test"}, "brand_cloud_memberships": []map[string]any{{"id": cloudA, "name": "Camera Lab", "role": "owner", "capabilities": []string{capabilityProvisioningCreate, capabilityProvisioningRead}}}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/device-item-profiles/"+productA:
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": accountclient.DeviceItemProfile{ID: productA, BrandCloudID: cloudA, DisplayName: "Camera"}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/devices/"+deviceID && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"device": accountclient.Device{ID: deviceID, OrganizationID: cloudA, DeviceItemProfileID: productA, Status: "registered"}})
		case r.URL.Path == "/v1/orgs/"+cloudA+"/devices/"+deviceID+"/provision" && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]any{"operation": accountclient.Operation{ID: "op-1", State: "pending"}})
		case strings.HasSuffix(r.URL.Path, "/job-authorizations") && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(accountclient.JobAuthorization{ID: "grant-1", BrandCloudID: cloudA, Status: "active"})
		case strings.HasSuffix(r.URL.Path, "/exchange") && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(accountclient.JobToken{AccessToken: "restricted", TokenType: "Bearer", ExpiresIn: 300})
		case strings.HasSuffix(r.URL.Path, "/revoke") && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "owner-1", "owner@example.test", "access", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL), Config: config.Config{AccountManagerJobAuthorizationToken: strings.Repeat("j", 32), BatchWorkerPollInterval: 5 * time.Millisecond, BatchWorkerLeaseDuration: time.Second}})
	workerCtx, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	s.StartBatchScheduler(workerCtx)
	root := "/api/developer/brand-clouds/" + cloudA
	request := func(method, path, contentType, key string, body *bytes.Buffer) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, body)
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	_ = writer.WriteField("product_id", productA)
	part, _ := writer.CreateFormFile("file", "devices.csv")
	_, _ = part.Write([]byte("device_id\n" + deviceID + "\n"))
	_ = writer.Close()
	w := request(http.MethodPost, root+"/provisioning/sources", writer.FormDataContentType(), "source-key", &upload)
	if w.Code != http.StatusCreated {
		t.Fatalf("source status=%d body=%s", w.Code, w.Body.String())
	}
	var sourceBody struct {
		Source contracts.ProvisioningSource `json:"source"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &sourceBody); err != nil || sourceBody.Source.RowCount != 1 {
		t.Fatalf("source=%+v err=%v", sourceBody.Source, err)
	}
	makeUpload := func(csvBody string) (*bytes.Buffer, string) {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		_ = form.WriteField("product_id", productA)
		filePart, _ := form.CreateFormFile("file", "devices.csv")
		_, _ = filePart.Write([]byte(csvBody))
		_ = form.Close()
		return &body, form.FormDataContentType()
	}
	replayBody, replayType := makeUpload("device_id\n" + deviceID + "\n")
	w = request(http.MethodPost, root+"/provisioning/sources", replayType, "source-key", replayBody)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"idempotent_replay":true`) {
		t.Fatalf("source replay status=%d body=%s", w.Code, w.Body.String())
	}
	conflictBody, conflictType := makeUpload("device_id\n88888888-8888-4888-8888-888888888888\n")
	w = request(http.MethodPost, root+"/provisioning/sources", conflictType, "source-key", conflictBody)
	if w.Code != http.StatusConflict {
		t.Fatalf("source conflict status=%d body=%s", w.Code, w.Body.String())
	}

	validationBody := bytes.NewBufferString(`{"source_id":"` + sourceBody.Source.ID + `"}`)
	w = request(http.MethodPost, root+"/provisioning/validate", "application/json", "validate-key", validationBody)
	if w.Code != http.StatusAccepted {
		t.Fatalf("validate status=%d body=%s", w.Code, w.Body.String())
	}
	validation := waitProvisioningJob(t, st, cloudA, "validate-key")
	if validation.State != "completed" {
		t.Fatalf("validation=%+v", validation)
	}

	executeBody := bytes.NewBufferString(`{"source_id":"` + sourceBody.Source.ID + `","validation_job_id":"` + validation.ID + `"}`)
	w = request(http.MethodPost, root+"/provisioning/jobs", "application/json", "execute-key", executeBody)
	if w.Code != http.StatusAccepted {
		t.Fatalf("execute status=%d body=%s", w.Code, w.Body.String())
	}
	execution := waitProvisioningJob(t, st, cloudA, "execute-key")
	if execution.State != "completed" || execution.Completed != 1 {
		t.Fatalf("execution=%+v", execution)
	}
	execution = waitProvisioningAuthorizationStatus(t, st, cloudA, execution.ID, "revoked")
	if execution.AuthorizationStatus != "revoked" {
		t.Fatalf("terminal job retained delegated authorization: %+v", execution)
	}
	w = request(http.MethodGet, root+"/jobs/"+execution.ID+"/items?state=completed", "", "", &bytes.Buffer{})
	if w.Code != http.StatusOK {
		t.Fatalf("items status=%d body=%s", w.Code, w.Body.String())
	}
	var itemBody struct {
		Items      []contracts.BatchJobItem `json:"items"`
		Pagination struct{ Total int }      `json:"pagination"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &itemBody); err != nil || itemBody.Pagination.Total != 1 || len(itemBody.Items) != 1 || itemBody.Items[0].UpstreamOperationID == "" {
		t.Fatalf("items=%+v err=%v", itemBody, err)
	}
	w = request(http.MethodGet, root+"/jobs/"+execution.ID+"/result?format=csv", "", "", &bytes.Buffer{})
	if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("result status=%d content-type=%q", w.Code, w.Header().Get("Content-Type"))
	}

	wrong := strings.Replace(root, cloudA, cloudB, 1)
	w = request(http.MethodPost, wrong+"/provisioning/validate", "application/json", "wrong-cloud", bytes.NewBufferString(`{"source_id":"`+sourceBody.Source.ID+`"}`))
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross-cloud status=%d body=%s", w.Code, w.Body.String())
	}

	invalidID := "88888888-8888-4888-8888-888888888888"
	invalidUpload, invalidType := makeUpload("device_id\n" + deviceID + "\n" + invalidID + "\n")
	w = request(http.MethodPost, root+"/provisioning/sources", invalidType, "invalid-source-key", invalidUpload)
	if w.Code != http.StatusCreated {
		t.Fatalf("invalid source upload status=%d body=%s", w.Code, w.Body.String())
	}
	var invalidSource struct {
		Source contracts.ProvisioningSource `json:"source"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &invalidSource); err != nil {
		t.Fatal(err)
	}
	w = request(http.MethodPost, root+"/provisioning/validate", "application/json", "invalid-validation-key", bytes.NewBufferString(`{"source_id":"`+invalidSource.Source.ID+`"}`))
	if w.Code != http.StatusAccepted {
		t.Fatalf("invalid validation start status=%d body=%s", w.Code, w.Body.String())
	}
	invalidValidation := waitProvisioningJob(t, st, cloudA, "invalid-validation-key")
	if invalidValidation.State != "partial_failed" || invalidValidation.Retryable || len(invalidValidation.AllowedActions) != 0 {
		t.Fatalf("permanent validation failure=%+v", invalidValidation)
	}
	w = request(http.MethodPost, root+"/provisioning/jobs", "application/json", "invalid-execute-key", bytes.NewBufferString(`{"source_id":"`+invalidSource.Source.ID+`","validation_job_id":"`+invalidValidation.ID+`"}`))
	if w.Code != http.StatusConflict {
		t.Fatalf("invalid validation executed status=%d body=%s", w.Code, w.Body.String())
	}
}

func waitProvisioningAuthorizationStatus(t *testing.T, st *store.Store, organizationID, jobID, status string) contracts.BatchJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, err := st.GetBatchJob(organizationID, jobID)
		if err == nil && job.AuthorizationStatus == status {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("provisioning job %s did not reach authorization status %s", jobID, status)
	return contracts.BatchJob{}
}

func waitProvisioningJob(t *testing.T, st *store.Store, organizationID, key string) contracts.BatchJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, err := st.GetBatchJobByIdempotency(organizationID, key)
		if err == nil && job.State != "queued" && job.State != "running" {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("provisioning job did not finish")
	return contracts.BatchJob{}
}
