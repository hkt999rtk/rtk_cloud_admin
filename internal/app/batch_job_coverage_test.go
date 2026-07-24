package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"rtk_cloud_admin/internal/videoclient"
)

func TestRunBatchJobOperationMatrix(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path
		switch {
		case strings.Contains(path, "/fleet/devices"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices": []map[string]any{
					{"id": "dev-ok", "name": "Camera A", "category": "camera", "model": "RTK-A", "status": "online", "device_item_profile_id": "sku-1", "metadata": map[string]any{"region": "jp-east"}},
					{"id": "dev-fail", "name": "Camera B", "category": "camera", "model": "RTK-B", "status": "offline", "device_item_profile_id": "sku-1", "metadata": map[string]any{}},
				},
				"pagination": map[string]any{"limit": 250, "offset": 0, "total": 2},
			})
		case strings.Contains(path, "/device-item-profiles/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": "sku-1", "display_name": "Camera"}})
		case r.Method == http.MethodGet && strings.Contains(path, "/devices/"):
			id := path[strings.LastIndex(path, "/")+1:]
			if id == "dev-missing" {
				http.Error(w, `{"message":"missing"}`, http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"device": map[string]any{
				"id": id, "name": "Camera " + id, "category": "camera", "model": "RTK", "status": "online", "metadata": map[string]any{"region": "jp-east"},
			}})
		case strings.Contains(path, "dev-fail"):
			http.Error(w, `{"message":"action failed"}`, http.StatusBadGateway)
		case r.Method == http.MethodPost && (strings.HasSuffix(path, "/provision") || strings.HasSuffix(path, "/deactivate")):
			_ = json.NewEncoder(w).Encode(map[string]any{"operation": map[string]any{"id": "operation-ok", "state": "accepted"}})
		case r.Method == http.MethodPatch && strings.Contains(path, "/devices/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"device": map[string]any{"id": "dev-ok", "name": "Camera A", "metadata": map[string]any{"updated": true}}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{})
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	create := func(jobType string, scope map[string]any, total int) contracts.BatchJob {
		t.Helper()
		job, err := st.CreateBatchJob(contracts.BatchJob{
			Type:           jobType,
			Name:           jobType,
			OrganizationID: "org-acme",
			CreatedBy:      "coverage@example.com",
			Scope:          scope,
			State:          "queued",
			Total:          total,
		})
		if err != nil {
			t.Fatal(err)
		}
		return job
	}
	run := func(job contracts.BatchJob) contracts.BatchJob {
		t.Helper()
		srv.runBatchJob(job, "access-token")
		got, err := st.GetBatchJob(job.OrganizationID, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	invalidValidation := run(create("provisioning_validation", map[string]any{
		"sku_id":     "sku-1",
		"device_ids": []any{"dev-ok", "", "dev-missing"},
		"validation": map[string]any{"valid": true},
	}, 2))
	if invalidValidation.State != "failed" || invalidValidation.Failed != 1 {
		t.Fatalf("invalid validation = %+v", invalidValidation)
	}
	validValidation := run(create("provisioning_validation", map[string]any{
		"sku_id":     "sku-1",
		"device_ids": []any{"dev-ok"},
		"validation": map[string]any{"valid": true},
	}, 1))
	if validValidation.State != "completed" {
		t.Fatalf("valid validation = %+v", validValidation)
	}

	report := run(create("report_export", map[string]any{
		"query": map[string]any{"status": "online", "ignored": 7},
	}, 1))
	if report.State != "completed" || len(report.Result) == 0 {
		t.Fatalf("report export = %+v", report)
	}

	actionCases := []struct {
		name  string
		scope map[string]any
	}{
		{"device_deactivation", map[string]any{}},
		{"device_provision", map[string]any{}},
		{"device_settings", map[string]any{"query": map[string]any{"settings": map[string]any{"mode": "night"}}}},
		{"group_update", map[string]any{"query": map[string]any{"group_id": "group-1", "action": "add"}}},
		{"group_update", map[string]any{"query": map[string]any{"group_id": "group-1", "action": "remove"}}},
		{"tag_update", map[string]any{"query": map[string]any{"tag": "qualification", "action": "add"}}},
		{"tag_update", map[string]any{"query": map[string]any{"tag": "qualification", "action": "remove"}}},
	}
	for index, tc := range actionCases {
		scope := mergeBatchJobScope(tc.scope, map[string]any{
			"snapshot_ids":        []any{"dev-ok", "dev-fail", "", 7},
			"excluded_device_ids": []any{"dev-excluded", 9},
		})
		got := run(create(tc.name, scope, 2))
		if got.State != "partial_failed" || got.Completed != 1 || got.Failed != 1 {
			t.Fatalf("action %d %s = %+v", index, tc.name, got)
		}
	}

	snapshot := run(create("device_deactivation", map[string]any{
		"query":               map[string]any{"status": "online", "ignored": 9},
		"excluded_device_ids": []any{"dev-fail"},
	}, 2))
	if snapshot.State != "completed" || snapshot.Completed != 1 {
		t.Fatalf("snapshot action = %+v", snapshot)
	}

	unsupported := run(create("unknown-operation", map[string]any{}, 3))
	if unsupported.State != "failed" || unsupported.Failed != 3 {
		t.Fatalf("unsupported job = %+v", unsupported)
	}

	for _, state := range []string{"paused", "cancelled"} {
		job := create("device_deactivation", map[string]any{"snapshot_ids": []any{"dev-ok"}}, 1)
		if _, err := st.UpdateBatchJobState(job.OrganizationID, job.ID, state); err != nil {
			t.Fatal(err)
		}
		got := run(job)
		if got.State != state || got.Completed != 0 {
			t.Fatalf("%s job changed unexpectedly: %+v", state, got)
		}
	}
}

func TestRunBatchJobDisabledAndMalformedScopes(t *testing.T) {
	t.Parallel()

	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{})
	create := func(jobType string, scope map[string]any, total int) contracts.BatchJob {
		t.Helper()
		job, err := st.CreateBatchJob(contracts.BatchJob{
			Type: jobType, OrganizationID: "org-acme", Scope: scope, State: "queued", Total: total,
		})
		if err != nil {
			t.Fatal(err)
		}
		return job
	}
	disabled := create("device_deactivation", map[string]any{}, 2)
	srv.runBatchJob(disabled, "")
	got, err := st.GetBatchJob(disabled.OrganizationID, disabled.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Failed != 2 {
		t.Fatalf("disabled upstream job = %+v", got)
	}

	if _, err := srv.snapshotBatchScope(t.Context(), "", contracts.BatchJob{Scope: map[string]any{}}); err == nil {
		t.Fatal("snapshotBatchScope accepted a missing query")
	}
}

func TestBatchProvisioningHTTPWorkflow(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organizations": []map[string]any{{
				"id": "org-acme", "name": "Acme", "role": "owner",
				"capabilities": []string{
					capabilityProvisioningRead,
					capabilityProvisioningCreate,
					capabilityFleetRead,
					capabilityFleetBatchManage,
					capabilityReportsRead,
					capabilityReportsCreate,
				},
			}}})
		case strings.Contains(r.URL.Path, "/device-item-profiles/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": "sku-1"}})
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/devices/"):
			id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
			_ = json.NewEncoder(w).Encode(map[string]any{"device": map[string]any{
				"id": id, "name": "Camera", "category": "camera", "model": "RTK", "status": "online", "metadata": map[string]any{},
			}})
		case strings.Contains(r.URL.Path, "/fleet/devices"):
			_ = json.NewEncoder(w).Encode(map[string]any{"devices": []any{}, "pagination": map[string]any{"total": 0}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/provision"):
			_ = json.NewEncoder(w).Encode(map[string]any{"operation": map[string]any{"id": "operation-provision"}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{})
		}
	}))
	defer upstream.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "user-1", "owner@example.com", "access-token", "refresh-token", "org-acme", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})

	request := func(method, path string, body io.Reader, idempotencyKey string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, body)
		req.AddCookie(cookie)
		if idempotencyKey != "" {
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		srv.ServeHTTP(rec, req)
		return rec
	}
	waitJob := func(key string) contracts.BatchJob {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			job, lookupErr := st.GetBatchJobByIdempotency("org-acme", key)
			if lookupErr == nil && job.State != "queued" && job.State != "running" {
				return job
			}
			if time.Now().After(deadline) {
				t.Fatalf("job %s did not finish: %v", key, lookupErr)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	if rec := request(http.MethodPost, "/api/provisioning/validate", strings.NewReader(`{"sku_id":"sku-1","device_ids":["dev-1","dev-1",""]}`), "validate-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("validate status = %d, body=%s", rec.Code, rec.Body.String())
	}
	validation := waitJob("validate-1")
	if validation.State != "failed" {
		t.Fatalf("duplicate validation = %+v", validation)
	}
	if rec := request(http.MethodPost, "/api/provisioning/validate", strings.NewReader(`{"sku_id":"sku-1","device_ids":["dev-1","dev-1",""]}`), "validate-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("validate replay status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/provisioning/validate", strings.NewReader(`{"sku_id":"sku-2","device_ids":["dev-1"]}`), "validate-1"); rec.Code != http.StatusConflict {
		t.Fatalf("validate conflict status = %d, body=%s", rec.Code, rec.Body.String())
	}
	for _, tc := range []struct {
		body string
		key  string
		want int
	}{
		{`{`, "bad-json", http.StatusBadRequest},
		{`{"sku_id":"sku-1"}`, "no-devices", http.StatusBadRequest},
		{`{"sku_id":"sku-1","device_ids":[" "]}`, "blank-devices", http.StatusBadRequest},
		{`{"sku_id":"sku-1","source_id":"missing"}`, "missing-source", http.StatusBadRequest},
		{`{"sku_id":"sku-1","device_ids":["dev-1"]}`, "", http.StatusPreconditionRequired},
	} {
		rec := request(http.MethodPost, "/api/provisioning/validate", strings.NewReader(tc.body), tc.key)
		if rec.Code != tc.want {
			t.Fatalf("validate %s status = %d, want %d; body=%s", tc.key, rec.Code, tc.want, rec.Body.String())
		}
	}

	sourceBody := func(contents string) (*bytes.Buffer, string) {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		if err := writer.WriteField("sku_id", "sku-1"); err != nil {
			t.Fatal(err)
		}
		if err := writer.WriteField("production_run", "run-1"); err != nil {
			t.Fatal(err)
		}
		part, err := writer.CreateFormFile("file", "devices.csv")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, contents); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return &body, writer.FormDataContentType()
	}
	upload := func(contents, key string) *httptest.ResponseRecorder {
		t.Helper()
		body, contentType := sourceBody(contents)
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/provisioning/sources", body)
		req.AddCookie(cookie)
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("Content-Type", contentType)
		srv.ServeHTTP(rec, req)
		return rec
	}
	if rec := upload("device_id\ndev-1\ndev-2\n", "source-1"); rec.Code != http.StatusCreated {
		t.Fatalf("source upload status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := upload("device_id\ndev-1\ndev-2\n", "source-1"); rec.Code != http.StatusCreated {
		t.Fatalf("source replay status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := upload("device_id\ndev-3\n", "source-1"); rec.Code != http.StatusConflict {
		t.Fatalf("source conflict status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := upload("device_id\n\n", "source-empty"); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty source status = %d, body=%s", rec.Code, rec.Body.String())
	}

	completedValidation, err := st.CreateBatchJob(contracts.BatchJob{
		Type: "provisioning_validation", Name: "ready", OrganizationID: "org-acme", CreatedBy: "owner@example.com",
		Scope: map[string]any{"validation": map[string]any{"valid": true}, "device_ids": []any{"dev-1"}, "sku_id": "sku-1"},
		State: "completed", Total: 1, Completed: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	provisionBody := fmt.Sprintf(`{"validation_job_id":%q}`, completedValidation.ID)
	if rec := request(http.MethodPost, "/api/provisioning/jobs", strings.NewReader(provisionBody), "provision-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("provision status = %d, body=%s", rec.Code, rec.Body.String())
	}
	provision := waitJob("provision-1")
	if provision.State != "completed" {
		t.Fatalf("provision job = %+v", provision)
	}
	if rec := request(http.MethodPost, "/api/provisioning/jobs", strings.NewReader(provisionBody), "provision-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("provision replay status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/provisioning/jobs", strings.NewReader(`{"validation_job_id":"missing"}`), "provision-missing"); rec.Code != http.StatusNotFound {
		t.Fatalf("missing validation status = %d, body=%s", rec.Code, rec.Body.String())
	}

	if rec := request(http.MethodGet, "/api/jobs/"+provision.ID, nil, ""); rec.Code != http.StatusOK {
		t.Fatalf("job status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/jobs/"+provision.ID+"/result?format=csv", nil, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "device_id") {
		t.Fatalf("job CSV status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/jobs/missing", nil, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("missing job status = %d", rec.Code)
	}

	queued, err := st.CreateBatchJob(contracts.BatchJob{
		Type: "device_deactivation", OrganizationID: "org-acme", CreatedBy: "owner@example.com",
		Scope: map[string]any{"snapshot_ids": []any{"dev-1"}}, State: "queued", Total: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, "/api/jobs/"+queued.ID+"/pause", nil, "pause-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("pause status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/jobs/"+queued.ID+"/resume", nil, "resume-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("resume status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/jobs/"+queued.ID+"/invalid", nil, "invalid-action"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid action status = %d, body=%s", rec.Code, rec.Body.String())
	}

	failed, err := st.CreateBatchJob(contracts.BatchJob{
		Type: "device_deactivation", Name: "failed batch", OrganizationID: "org-acme", CreatedBy: "owner@example.com",
		Scope: map[string]any{"failed_device_ids": []any{"dev-1"}, "attempt": float64(1)},
		State: "partial_failed", Total: 1, Failed: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, "/api/jobs/"+failed.ID+"/retry", nil, "retry-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("retry status = %d, body=%s", rec.Code, rec.Body.String())
	}
	retry := waitJob("retry-1")
	if retry.State != "completed" || fmt.Sprint(retry.Scope["retry_of"]) != failed.ID {
		t.Fatalf("retry job = %+v", retry)
	}
	if rec := request(http.MethodPost, "/api/jobs/"+failed.ID+"/retry", nil, "retry-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("retry replay status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/jobs/missing/retry", nil, "retry-missing"); rec.Code != http.StatusNotFound {
		t.Fatalf("missing retry status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/jobs/"+provision.ID+"/retry", nil, "retry-complete"); rec.Code != http.StatusConflict {
		t.Fatalf("completed retry status = %d, body=%s", rec.Code, rec.Body.String())
	}

	reportRequest := `{"name":"Fleet qualification","dimensions":["sku","region"],"timezone":"UTC","format":"csv","scope":{"status":"online"}}`
	if rec := request(http.MethodPost, "/api/reports", strings.NewReader(reportRequest), "report-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("report create status = %d, body=%s", rec.Code, rec.Body.String())
	}
	report := waitJob("report-1")
	if report.State != "completed" {
		t.Fatalf("report job = %+v", report)
	}
	if rec := request(http.MethodPost, "/api/reports", strings.NewReader(reportRequest), "report-1"); rec.Code != http.StatusAccepted {
		t.Fatalf("report replay status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/reports", strings.NewReader(`{"name":"Other report"}`), "report-1"); rec.Code != http.StatusConflict {
		t.Fatalf("report conflict status = %d, body=%s", rec.Code, rec.Body.String())
	}
	for _, tc := range []struct {
		body string
		key  string
		want int
	}{
		{`{`, "report-bad", http.StatusBadRequest},
		{`{"name":"Bad format","format":"pdf"}`, "report-format", http.StatusBadRequest},
		{`{"name":"No key"}`, "", http.StatusPreconditionRequired},
	} {
		rec := request(http.MethodPost, "/api/reports", strings.NewReader(tc.body), tc.key)
		if rec.Code != tc.want {
			t.Fatalf("report %s status = %d, want %d; body=%s", tc.key, rec.Code, tc.want, rec.Body.String())
		}
	}
	if rec := request(http.MethodGet, "/api/reports?limit=10&offset=0&state=completed", nil, ""); rec.Code != http.StatusOK {
		t.Fatalf("report list status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/reports/"+report.ID, nil, ""); rec.Code != http.StatusOK {
		t.Fatalf("report detail status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/reports/"+report.ID+"?format=csv", nil, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "項目") {
		t.Fatalf("report CSV status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/reports/missing", nil, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("missing report status = %d", rec.Code)
	}
	if rec := request(http.MethodGet, "/api/jobs?limit=5&offset=0&type=report_export&created_by=owner@example.com", nil, ""); rec.Code != http.StatusOK {
		t.Fatalf("jobs list status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestOTAUpdatePlanProxyAndFirmwareRetry(t *testing.T) {
	t.Parallel()

	video := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer video-admin-token" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Brand-Cloud-ID") != "org-acme" {
			t.Fatalf("X-Brand-Cloud-ID = %q", r.Header.Get("X-Brand-Cloud-ID"))
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "reject") {
			http.Error(w, `{"code":"rejected"}`, http.StatusConflict)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "campaign-1", "state": "accepted", "path": r.URL.Path})
	}))
	defer video.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "owner@example.com", "", "", "org-acme", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	srv := NewWithOptions(st, Options{
		Config:      config.Config{VideoCloudAdminToken: "video-admin-token"},
		VideoClient: videoclient.New(video.URL),
	})
	request := func(method, path, body, key string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(cookie)
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		srv.ServeHTTP(rec, req)
		return rec
	}

	if rec := request(http.MethodGet, "/api/update-plans", "", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing SKU list status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/update-plans?sku_id=sku-1", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("plan list status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodGet, "/api/update-plans/campaign-1", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("plan detail status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/update-plans/campaign-1/start", `{}`, "plan-start"); rec.Code != http.StatusOK {
		t.Fatalf("plan start status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/update-plans/reject/cancel", `{}`, "plan-reject"); rec.Code != http.StatusConflict {
		t.Fatalf("plan reject status = %d, body=%s", rec.Code, rec.Body.String())
	}

	query := map[string]any{"status": "online"}
	excluded := []any{"dev-1"}
	scope := map[string]any{
		"query":               query,
		"excluded_device_ids": excluded,
		"expires_at":          time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		"target_count":        0,
	}
	scope["scope_hash"] = batchScopeHash(map[string]any{"query": query, "excluded_device_ids": excluded})
	payload, err := json.Marshal(map[string]any{"sku_id": "sku-1", "name": "Qualification", "scope": scope})
	if err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, "/api/update-plans", string(payload), "plan-create"); rec.Code != http.StatusOK {
		t.Fatalf("plan create status = %d, body=%s", rec.Code, rec.Body.String())
	}
	for _, tc := range []struct {
		body string
		key  string
		want int
	}{
		{`{`, "plan-json", http.StatusBadRequest},
		{`{"name":"missing sku"}`, "plan-sku", http.StatusBadRequest},
		{`{"sku_id":"sku-1"}`, "plan-scope", http.StatusBadRequest},
		{string(payload), "", http.StatusPreconditionRequired},
	} {
		rec := request(http.MethodPost, "/api/update-plans", tc.body, tc.key)
		if rec.Code != tc.want {
			t.Fatalf("plan %s status = %d, want %d; body=%s", tc.key, rec.Code, tc.want, rec.Body.String())
		}
	}

	srv.accountClient = accountclient.New(video.URL)
	retry, err := st.CreateBatchJob(contracts.BatchJob{
		Type: "firmware_retry", OrganizationID: "org-acme", Scope: map[string]any{"update_plan_id": "campaign-1"}, State: "queued", Total: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv.runBatchJob(retry, "")
	retry, err = st.GetBatchJob("org-acme", retry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retry.State != "completed" {
		t.Fatalf("firmware retry = %+v", retry)
	}
	missing, err := st.CreateBatchJob(contracts.BatchJob{
		Type: "firmware_retry", OrganizationID: "org-acme", Scope: map[string]any{}, State: "queued", Total: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv.runBatchJob(missing, "")
	missing, err = st.GetBatchJob("org-acme", missing.ID)
	if err != nil {
		t.Fatal(err)
	}
	if missing.State != "failed" {
		t.Fatalf("missing firmware retry = %+v", missing)
	}
}

func TestCoverageRiskHelperBranches(t *testing.T) {
	t.Parallel()

	float := func(value float64) *float64 { return &value }
	for _, tc := range []struct {
		row  contracts.PlatformDashboardServiceMetric
		want string
	}{
		{contracts.PlatformDashboardServiceMetric{SourceStatus: platformDashboardSourceUnconfigured}, platformDashboardSourceUnconfigured},
		{contracts.PlatformDashboardServiceMetric{SourceStatus: platformDashboardSourceEmpty}, platformDashboardSourceUnmonitored},
		{contracts.PlatformDashboardServiceMetric{SourceStatus: platformDashboardSourceConfigured, TargetsTotal: 2, TargetsDown: 1}, "degraded"},
		{contracts.PlatformDashboardServiceMetric{SourceStatus: platformDashboardSourceConfigured, TargetsTotal: 1, ErrorRate5xx: float(0.5)}, "warning"},
		{contracts.PlatformDashboardServiceMetric{SourceStatus: platformDashboardSourceConfigured, TargetsTotal: 1}, "ok"},
	} {
		if got := platformDashboardServiceMetricStatus(tc.row); got != tc.want {
			t.Fatalf("service status = %q, want %q for %+v", got, tc.want, tc.row)
		}
	}
	for _, tc := range []struct {
		row  contracts.PlatformDashboardWorkloadHealth
		want string
	}{
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceUnavailable}, platformDashboardSourceUnavailable},
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceConfigured, CrashLoopPods: 1}, "crashloop"},
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceConfigured, DesiredReplicas: 2, AvailableReplicas: 1}, "degraded"},
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceConfigured, PendingPods: 1}, "pending"},
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceConfigured}, platformDashboardSourceUnmonitored},
		{contracts.PlatformDashboardWorkloadHealth{SourceStatus: platformDashboardSourceConfigured, DesiredReplicas: 1, AvailableReplicas: 1, ReadyPods: 1}, "ok"},
	} {
		if got := platformDashboardWorkloadStatus(tc.row); got != tc.want {
			t.Fatalf("workload status = %q, want %q for %+v", got, tc.want, tc.row)
		}
	}
	for _, tc := range []struct {
		row  contracts.PlatformDashboardClusterNode
		want string
	}{
		{contracts.PlatformDashboardClusterNode{SourceStatus: platformDashboardSourceUnconfigured}, platformDashboardSourceUnconfigured},
		{contracts.PlatformDashboardClusterNode{SourceStatus: platformDashboardSourceConfigured}, "degraded"},
		{contracts.PlatformDashboardClusterNode{SourceStatus: platformDashboardSourceConfigured, Ready: true, CPUPercent: float(90)}, "critical"},
		{contracts.PlatformDashboardClusterNode{SourceStatus: platformDashboardSourceConfigured, Ready: true, MemoryPercent: float(80)}, "warning"},
		{contracts.PlatformDashboardClusterNode{SourceStatus: platformDashboardSourceConfigured, Ready: true, CPUPercent: float(10)}, "ok"},
	} {
		if got := platformDashboardClusterNodeStatus(tc.row); got != tc.want {
			t.Fatalf("cluster status = %q, want %q for %+v", got, tc.want, tc.row)
		}
	}

	for _, value := range []any{float64(123.5), "123.5"} {
		if _, ok := prometheusTimestamp(value); !ok {
			t.Fatalf("prometheusTimestamp(%v) failed", value)
		}
	}
	for _, value := range []any{"invalid", true} {
		if _, ok := prometheusTimestamp(value); ok {
			t.Fatalf("prometheusTimestamp(%v) unexpectedly succeeded", value)
		}
	}
	vector := prometheusVectorItem{
		Value: []any{float64(0), "1.5"},
		Values: [][]any{
			{float64(123), "2.5"},
			{"124.5", float64(3)},
			{"bad", "4"},
			{float64(125), true},
			{float64(126)},
		},
	}
	if value, ok := vector.floatValue(); !ok || value != 1.5 {
		t.Fatalf("floatValue = %v/%v", value, ok)
	}
	if points := vector.floatPoints(); len(points) != 2 {
		t.Fatalf("floatPoints = %+v, want 2 valid points", points)
	}

	for input, want := range map[string]string{
		"account_manager": "Registry",
		"video":           "Streaming",
		"operations":      "Lifecycle",
		"custom_layer":    "Custom Layer",
	} {
		if got := customerSafeFactLayer(input); got != want {
			t.Fatalf("customerSafeFactLayer(%q) = %q, want %q", input, got, want)
		}
	}
	for _, capabilities := range [][]string{{"platform.audit.read"}, {"platform_admin"}, {"acl.read"}, {"quota_request.read"}} {
		if !hasAnyPlatformCapability(capabilities) {
			t.Fatalf("hasAnyPlatformCapability(%v) = false", capabilities)
		}
	}
	if hasAnyPlatformCapability([]string{"fleet.read"}) {
		t.Fatal("fleet capability was classified as platform capability")
	}
	if actions := groupAllowedActions([]string{"device_group.manage"}); len(actions) != 2 || actions[1] != "manage" {
		t.Fatalf("groupAllowedActions = %v", actions)
	}
	if got := customerSafeFactState(string(contracts.OperationDeadLettered)); got != "failed" {
		t.Fatalf("customerSafeFactState(dead_lettered) = %q", got)
	}
	if got := customerSafeFactState(" ready "); got != "ready" {
		t.Fatalf("customerSafeFactState(ready) = %q", got)
	}
	if got := mapOperationState(string(contracts.OperationSucceeded)); got != contracts.OperationSucceeded {
		t.Fatalf("mapOperationState(succeeded) = %q", got)
	}
	if got := mapOperationState("unknown"); got != contracts.OperationPublished {
		t.Fatalf("mapOperationState(unknown) = %q", got)
	}

	noVideo := &Server{videoClient: videoclient.New("")}
	if status, _ := noVideo.customerFirmwareSourceStatus(nil); status != "not_configured" {
		t.Fatalf("unconfigured firmware status = %q", status)
	}
	withVideo := &Server{videoClient: videoclient.New("http://video.invalid"), cfg: config.Config{VideoCloudAdminToken: "token"}}
	if status, _ := withVideo.customerFirmwareSourceStatus(nil); status != "no_data" {
		t.Fatalf("empty firmware status = %q", status)
	}
	if status, _ := withVideo.customerFirmwareSourceStatus([]contracts.Device{{ID: "dev-1"}}); status != "no_data" {
		t.Fatalf("populated firmware status = %q", status)
	}
	if status, _ := withVideo.customerStreamSourceStatus(); status != "no_data" {
		t.Fatalf("configured stream status = %q", status)
	}

	for _, tc := range []struct {
		raw  string
		want *int
	}{
		{`{"value":7}`, func() *int { value := 7; return &value }()},
		{`{"value":"8"}`, func() *int { value := 8; return &value }()},
		{`{"value":7.5}`, nil},
		{`{"value":"bad"}`, nil},
		{`{"value":true}`, nil},
		{`{`, nil},
	} {
		got := telemetryIntPayload(json.RawMessage(tc.raw), "value")
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Fatalf("telemetryIntPayload(%s) = %v, want %v", tc.raw, got, tc.want)
		}
	}
	zeroRows := []contracts.FirmwareDistributionVersion{{Count: 0}, {Count: 0}}
	assignFirmwareDistributionPercents(zeroRows)
	if zeroRows[0].Pct != 0 || zeroRows[1].Pct != 0 {
		t.Fatalf("zero distribution = %+v", zeroRows)
	}
	rows := []contracts.FirmwareDistributionVersion{{Count: 1}, {Count: 2}}
	assignFirmwareDistributionPercents(rows)
	if rows[0].Pct+rows[1].Pct != 100 {
		t.Fatalf("distribution percentages = %+v", rows)
	}
}

func TestImmutableOTAScopeServerRevalidation(t *testing.T) {
	t.Parallel()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("force_error") == "true" {
			http.Error(w, `{"message":"failed"}`, http.StatusBadGateway)
			return
		}
		if id := r.URL.Query().Get("q"); id != "" {
			if id == "outside" {
				_ = json.NewEncoder(w).Encode(map[string]any{"devices": []any{}, "pagination": map[string]any{"total": 0}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"devices":    []map[string]any{{"id": id, "status": "online"}},
				"pagination": map[string]any{"total": 1},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"devices":    []map[string]any{{"id": "dev-1", "status": "online"}, {"id": "dev-2", "status": "online"}},
			"pagination": map[string]any{"total": 2},
		})
	}))
	defer account.Close()

	srv := &Server{accountClient: accountclient.New(account.URL)}
	query := map[string]any{"status": "online"}
	excluded := []any{"dev-1"}
	scope := map[string]any{
		"query":               query,
		"excluded_device_ids": excluded,
		"expires_at":          time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		"target_count":        1,
	}
	scope["scope_hash"] = batchScopeHash(map[string]any{"query": query, "excluded_device_ids": excluded})
	if err := srv.validateImmutableOTAScope(t.Context(), "token", "org-acme", scope); err != nil {
		t.Fatalf("valid immutable scope: %v", err)
	}
	if err := srv.validateExcludedOTADevices(t.Context(), "token", "org-acme", query, []string{"outside"}); err == nil {
		t.Fatal("outside excluded device was accepted")
	}
	stale := mergeBatchJobScope(scope, map[string]any{"target_count": 2})
	if err := srv.validateImmutableOTAScope(t.Context(), "token", "org-acme", stale); err == nil {
		t.Fatal("stale target count was accepted")
	}
	tooMany := make([]any, 1001)
	for index := range tooMany {
		tooMany[index] = fmt.Sprintf("dev-%d", index)
	}
	large := mergeBatchJobScope(scope, map[string]any{"excluded_device_ids": tooMany})
	large["scope_hash"] = batchScopeHash(map[string]any{"query": query, "excluded_device_ids": tooMany})
	if err := srv.validateImmutableOTAScope(t.Context(), "token", "org-acme", large); err == nil {
		t.Fatal("oversized exclusion list was accepted")
	}
}

func TestCustomerCatalogACLAndGroupProxyMatrix(t *testing.T) {
	t.Parallel()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("fail") == "1" {
			http.Error(w, `{"message":"upstream failed"}`, http.StatusBadGateway)
			return
		}
		switch {
		case r.URL.Path == "/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organizations": []map[string]any{{
				"id": "org-acme", "name": "Acme", "role": "owner", "capabilities": fleetManagerCapabilities(),
			}}})
		case r.URL.Path == "/v1/orgs/org-acme/fleet/summary":
			_ = json.NewEncoder(w).Encode(map[string]any{"total": 2, "by_status": map[string]int{"online": 2}, "by_sku": map[string]int{"sku-1": 2}})
		case r.URL.Path == "/v1/orgs/org-acme/tags":
			_ = json.NewEncoder(w).Encode(map[string]any{"tags": []map[string]any{{"tag": "qualification", "device_count": 2}}})
		case r.URL.Path == "/v1/orgs/org-acme/roles":
			_ = json.NewEncoder(w).Encode(map[string]any{"roles": []map[string]any{{"name": "fleet_manager", "scope_type": "organization"}}})
		case r.URL.Path == "/v1/orgs/org-acme/permissions":
			_ = json.NewEncoder(w).Encode(map[string]any{"permissions": []map[string]any{{"name": "registry_device.read"}}})
		case r.URL.Path == "/v1/orgs/org-acme/role-assignments" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"role_assignments": []map[string]any{{"id": "assignment-1", "role_name": "fleet_manager"}}})
		case r.URL.Path == "/v1/orgs/org-acme/role-assignments" && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]any{"role_assignment": map[string]any{"id": "assignment-2", "role_name": "fleet_manager"}})
		case strings.HasPrefix(r.URL.Path, "/v1/orgs/org-acme/role-assignments/") && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/v1/orgs/org-acme/device-groups" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"groups": []map[string]any{{"id": "group-1", "name": "Qualification"}}})
		case r.URL.Path == "/v1/orgs/org-acme/device-groups" && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]any{"group": map[string]any{"id": "group-2", "name": "New Group"}})
		case r.URL.Path == "/v1/orgs/org-acme/device-groups/group-1" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"group": map[string]any{"id": "group-1", "name": "Qualification"}})
		case r.URL.Path == "/v1/orgs/org-acme/device-groups/group-1" && r.Method == http.MethodPatch:
			_ = json.NewEncoder(w).Encode(map[string]any{"group": map[string]any{"id": "group-1", "name": "Updated"}})
		case r.URL.Path == "/v1/orgs/org-acme/device-groups/group-1" && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/v1/orgs/org-acme/device-item-profiles":
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profiles": []map[string]any{{"id": "sku-1", "display_name": "Camera", "status": "active"}}})
		case strings.Contains(r.URL.Path, "/production-runs"):
			_ = json.NewEncoder(w).Encode(map[string]any{"production_runs": []map[string]any{{"id": "run-1"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer account.Close()

	st := mustOpenStore(t)
	session, err := st.CreateSession("customer", "u1", "owner@example.com", "access-token", "refresh-token", "org-acme", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: "rtk_admin_session", Value: session.ID}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(account.URL)})
	request := func(method, path, body, key string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(cookie)
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		srv.ServeHTTP(rec, req)
		return rec
	}

	for _, path := range []string{
		"/api/fleet/summary",
		"/api/tags",
		"/api/roles",
		"/api/permissions",
		"/api/role-assignments",
		"/api/groups",
		"/api/groups/group-1",
		"/api/skus",
	} {
		if rec := request(http.MethodGet, path, "", ""); rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
	}
	for _, path := range []string{"/api/tags?fail=1", "/api/roles?fail=1", "/api/permissions?fail=1", "/api/role-assignments?fail=1"} {
		if rec := request(http.MethodGet, path, "", ""); rec.Code < 400 {
			t.Fatalf("%s error status = %d, body=%s", path, rec.Code, rec.Body.String())
		}
	}

	roleBody := `{"role_name":"fleet_manager","actor_id":"user-2","scope_type":"organization","scope_id":"org-acme"}`
	if rec := request(http.MethodPost, "/api/role-assignments", roleBody, "role-create"); rec.Code != http.StatusAccepted {
		t.Fatalf("role create status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/role-assignments", `{}`, "role-invalid"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid role status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/role-assignments", roleBody, ""); rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("role no-key status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodDelete, "/api/role-assignments/assignment-1", "", "role-delete"); rec.Code != http.StatusNoContent {
		t.Fatalf("role delete status = %d, body=%s", rec.Code, rec.Body.String())
	}

	if rec := request(http.MethodPost, "/api/groups", `{"name":"New Group"}`, "group-create"); rec.Code != http.StatusCreated {
		t.Fatalf("group create status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPost, "/api/groups", `{}`, "group-create-invalid"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid group status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPatch, "/api/groups/group-1", `{"name":"Updated"}`, "group-update"); rec.Code != http.StatusOK {
		t.Fatalf("group update status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodPatch, "/api/groups/group-1", `{}`, "group-invalid"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid group update status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if rec := request(http.MethodDelete, "/api/groups/group-1", "", "group-delete"); rec.Code != http.StatusNoContent {
		t.Fatalf("group delete status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestPublicAuthProxySuccessFailureAndValidation(t *testing.T) {
	t.Parallel()

	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if bytes.Contains(raw, []byte("fail")) {
			http.Error(w, `{"message":"upstream rejected request"}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/auth/signup" {
			w.WriteHeader(http.StatusAccepted)
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer account.Close()

	srv := NewWithOptions(mustOpenStore(t), Options{AccountClient: accountclient.New(account.URL)})
	for _, tc := range []struct {
		path        string
		successBody string
		successCode int
		failureBody string
	}{
		{"/api/auth/customer/signup", `{"email":"owner@example.com","password":"password123","organization_name":"Acme"}`, http.StatusAccepted, `{"email":"fail@example.com","password":"password123","organization_name":"Acme"}`},
		{"/api/auth/customer/verify-email", `{"token":"verify-token"}`, http.StatusOK, `{"token":"fail-token"}`},
		{"/api/auth/customer/resend-verification", `{"email":"owner@example.com"}`, http.StatusAccepted, `{"email":"fail@example.com"}`},
		{"/api/auth/sign-in", `{"email":"owner@example.com"}`, http.StatusAccepted, `{"email":"fail@example.com"}`},
		{"/api/auth/forgot-password", `{"email":"owner@example.com"}`, http.StatusAccepted, `{"email":"fail@example.com"}`},
		{"/api/auth/reset-password", `{"token":"reset-token","new_password":"password123"}`, http.StatusNoContent, `{"token":"fail-token","new_password":"password123"}`},
	} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.successBody)))
		if rec.Code != tc.successCode {
			t.Fatalf("%s success status = %d, want %d; body=%s", tc.path, rec.Code, tc.successCode, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.failureBody)))
		if rec.Code < 400 {
			t.Fatalf("%s failure status = %d, body=%s", tc.path, rec.Code, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(`{`)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s malformed status = %d, body=%s", tc.path, rec.Code, rec.Body.String())
		}
	}
}

func TestCoverageMappingAndDemoOrganizationBranches(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		base string
		path string
		want string
	}{
		{"", "", "/"},
		{"/", "health", "/health"},
		{"http://example.test/", "/health", "http://example.test/health"},
		{"http://example.test", "health", "http://example.test/health"},
		{"http://example.test", "/health", "http://example.test/health"},
	} {
		if got := singleJoiningSlash(tc.base, tc.path); got != tc.want {
			t.Fatalf("singleJoiningSlash(%q, %q) = %q, want %q", tc.base, tc.path, got, tc.want)
		}
	}
	for _, tc := range []struct {
		status string
		want   string
	}{
		{"active", "active"},
		{"enabled", "active"},
		{"suspended", "disabled"},
		{"pending_verification", "setup_required"},
		{"failed", "error"},
		{"custom", "custom"},
		{"", "setup_required"},
	} {
		if got := brandCloudStatusKey(accountclient.BrandCloud{Status: tc.status}); got != tc.want {
			t.Fatalf("brandCloudStatusKey(%q) = %q, want %q", tc.status, got, tc.want)
		}
	}

	srv := NewWithOptions(mustOpenStore(t), Options{})
	if got, err := srv.demoActiveCustomerOrgID(store.Session{ActiveOrgID: "org-acme"}); err != nil || got != "org-acme" {
		t.Fatalf("active demo org = %q, %v", got, err)
	}
	if _, err := srv.demoActiveCustomerOrgID(store.Session{ActiveOrgID: "missing"}); !errors.Is(err, errCustomerActiveOrgInvalid) {
		t.Fatalf("missing demo org error = %v", err)
	}
	if got, err := srv.demoActiveCustomerOrgID(store.Session{}); err != nil || got == "" {
		t.Fatalf("default demo org = %q, %v", got, err)
	}
}
