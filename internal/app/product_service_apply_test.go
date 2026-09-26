package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

func TestProductApplyAdmissionRecoversLostAuthorizationResponse(t *testing.T) {
	createdAt := time.Date(2026, 9, 26, 12, 0, 0, 123456000, time.UTC)
	jobID := productApplyJobID("cloud-1", "product-1", "request-1")
	var firstExpiry string
	var authorizationCalls, cancels int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/service-apply-jobs"):
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{
				"id": jobID, "target_revision": 2, "target_digest": "digest-2", "total_devices": 1,
				"status": "active", "created_at": createdAt,
			}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/job-authorizations"):
			var input struct {
				ExpiresAt string `json:"expires_at"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			authorizationCalls++
			if authorizationCalls == 1 {
				firstExpiry = input.ExpiresAt
				w.WriteHeader(http.StatusServiceUnavailable) // Persisted upstream; response was lost.
				return
			}
			if input.ExpiresAt != firstExpiry {
				w.WriteHeader(http.StatusConflict)
				return
			}
			_, _ = w.Write([]byte(`{"id":"authorization-1"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/cancel"):
			cancels++
			_, _ = w.Write([]byte(`{"job":{"status":"canceled"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{Config: config.Config{AccountManagerJobAuthorizationToken: "service-token"}, AccountClient: accountclient.New(upstream.URL)})
	session := store.Session{ID: "session-1", Email: "creator@example.test"}
	request := httptest.NewRequest(http.MethodPost, "/service-apply-jobs", nil)
	first := httptest.NewRecorder()
	srv.createProductApplyJob(first, request, session, "cloud-1", "product-1", "user-token", "preview-1", "request-1")
	if first.Code == http.StatusAccepted || cancels != 0 {
		t.Fatalf("ambiguous authorization response canceled upstream job: status=%d cancels=%d", first.Code, cancels)
	}
	second := httptest.NewRecorder()
	srv.createProductApplyJob(second, request, session, "cloud-1", "product-1", "user-token", "preview-1", "request-1")
	if second.Code != http.StatusAccepted || authorizationCalls != 2 || cancels != 0 {
		t.Fatalf("same-key recovery failed: status=%d auth_calls=%d cancels=%d body=%s", second.Code, authorizationCalls, cancels, second.Body.String())
	}
	if firstExpiry != createdAt.Add(6*24*time.Hour+23*time.Hour).Format(time.RFC3339Nano) {
		t.Fatalf("authorization expiry is not based on immutable admission: %s", firstExpiry)
	}
	if _, err := st.GetBatchJobByIdempotency("cloud-1", "request-1"); err != nil {
		t.Fatal(err)
	}
}

func TestProductServiceApplyWaitsForAppliedRevision(t *testing.T) {
	accepted, applied, dispatches, completions := false, false, 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items"):
			status, revision := "pending", 0
			if accepted {
				status = "accepted"
			}
			if applied {
				status, revision = "applied", 2
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"total": 1, "items": []map[string]any{{"device_id": "device-1", "operation_id": "operation-1", "status": status, "applied_revision": revision}}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/dispatch"):
			dispatches++
			accepted = true
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"item":{"status":"accepted"}}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete"):
			completions++
			_, _ = w.Write([]byte(`{"job":{"status":"completed"}}`))
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": "job-a", "target_revision": 2, "target_digest": "digest-2", "total_devices": 1, "status": "active"}})
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-a", OrganizationID: "cloud-1", Type: "product_services_apply", Scope: map[string]any{"product_id": "product-1", "target_revision": int64(2), "target_digest": "digest-2"}, Total: 1})
	if err != nil {
		t.Fatal(err)
	}
	srv.runDurableProductServiceApplyJob(context.Background(), job, "delegated-token", "worker-1", time.Minute)
	first, err := st.GetBatchJob(job.OrganizationID, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Completed != 0 || first.State != "queued" || dispatches != 1 || completions != 0 {
		t.Fatalf("202 counted as applied: job=%+v dispatches=%d completions=%d", first, dispatches, completions)
	}
	applied = true
	srv.runDurableProductServiceApplyJob(context.Background(), first, "delegated-token", "worker-1", time.Minute)
	final, err := st.GetBatchJob(job.OrganizationID, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.State != "completed" || final.Completed != 1 || dispatches != 1 || completions != 1 {
		t.Fatalf("matching applied revision not completed: %+v", final)
	}
}

func TestProductServiceApplyRestartRecoversInterruptedProgress(t *testing.T) {
	const total = 2
	dispatches, completions := 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items"):
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			_ = json.NewEncoder(w).Encode(map[string]any{"total": total, "items": []map[string]any{{
				"device_id": fmt.Sprintf("device-%d", offset), "operation_id": fmt.Sprintf("operation-%d", offset),
				"status": "applied", "applied_revision": 2,
			}}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/dispatch"):
			dispatches++
			w.WriteHeader(http.StatusAccepted)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete"):
			completions++
			_, _ = w.Write([]byte(`{"job":{"status":"completed"}}`))
		default:
			_, _ = w.Write([]byte(`{"job":{"id":"job-restart","target_revision":2,"target_digest":"digest-2","total_devices":2,"status":"active"}}`))
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-restart", OrganizationID: "cloud-1", Type: "product_services_apply",
		Scope: map[string]any{"product_id": "product-1", "target_revision": int64(2), "target_digest": "digest-2"}, Total: total})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the old worker crashing after advancing the cursor but before
	// persisting counters. A second completed row simulates an interrupted item
	// write before its cursor moved; replay must count each device once.
	for position := 0; position < total; position++ {
		if err := st.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: fmt.Sprintf("device-%d", position),
			Position: position, State: "completed", Attempt: 1, UpstreamOperationID: fmt.Sprintf("operation-%d", position)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.UpdateBatchJobCheckpoint(job.OrganizationID, job.ID, map[string]any{"next_position": 1}); err != nil {
		t.Fatal(err)
	}
	job, err = st.GetBatchJob(job.OrganizationID, job.ID)
	if err != nil || job.Completed != 0 {
		t.Fatalf("invalid restart fixture: %+v, %v", job, err)
	}
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	srv.runDurableProductServiceApplyJob(context.Background(), job, "delegated-token", "worker-1", time.Minute)
	job, err = st.GetBatchJob(job.OrganizationID, job.ID)
	if err != nil || job.State != "completed" || job.Completed != total || job.Failed != 0 ||
		job.Checkpoint["next_position"] != float64(total) || dispatches != 0 || completions != 1 {
		t.Fatalf("interrupted apply was not recovered once: job=%+v dispatches=%d completions=%d err=%v", job, dispatches, completions, err)
	}
}

func TestProductServiceApplyPaginatesBeyond250AndDownloadsAllResults(t *testing.T) {
	const total = 301
	completed, retries := 0, 0
	retryAvailable, retryDispatched := false, false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items"):
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			status, revision, retryable := "applied", 5, false
			if offset == total-1 && !retryDispatched {
				status, revision, retryable = "failed", 0, true
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"total": total, "items": []map[string]any{{"device_id": fmt.Sprintf("device-%03d", offset), "operation_id": fmt.Sprintf("operation-%03d", offset), "status": status, "applied_revision": revision, "retryable": retryable, "error_code": "TEMPORARY_UNAVAILABLE"}}})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/dispatch"):
			if !strings.Contains(r.URL.Path, "/device-300/") {
				t.Errorf("unexpected retry target: %s", r.URL.Path)
			}
			retries++
			if retryAvailable {
				retryDispatched = true
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"item":{"status":"accepted"}}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete"):
			completed++
			_, _ = w.Write([]byte(`{"job":{"status":"completed"}}`))
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": "job-many", "target_revision": 5, "target_digest": "digest-5", "total_devices": total, "status": "active"}})
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-many", OrganizationID: "cloud-1", Type: "product_services_apply", Scope: map[string]any{"product_id": "product-1", "target_revision": int64(5), "target_digest": "digest-5"}, Total: total})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		srv.runDurableProductServiceApplyJob(context.Background(), job, "delegated-token", "worker-1", time.Minute)
		job, err = st.GetBatchJob(job.OrganizationID, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if job.State == "partial_failed" {
			break
		}
	}
	if job.State != "partial_failed" || job.Completed != total-1 || job.Failed != 1 || !job.Retryable || retries != 1 || completed != 0 {
		t.Fatalf("late transient failure not retained for retry: %+v, retries=%d", job, retries)
	}
	retryAvailable = true
	job, _, _, err = st.ActBatchJob(job.OrganizationID, job.ID, "retry", "retry-after-page-250")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		srv.runDurableProductServiceApplyJob(context.Background(), job, "delegated-token", "worker-1", time.Minute)
		job, err = st.GetBatchJob(job.OrganizationID, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if job.State == "completed" {
			break
		}
	}
	if job.ID != "job-many" || job.State != "completed" || job.Completed != total || retries != 2 || completed != 1 {
		t.Fatalf("retry changed identity or skipped late item: %+v retries=%d completions=%d", job, retries, completed)
	}
	page, err := st.ListBatchJobItems(job.OrganizationID, job.ID, "", nil, 250, 250)
	if err != nil || page.Total != total || len(page.Items) != 51 {
		t.Fatalf("second result page: %+v, %v", page, err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/result?format=csv", nil)
	srv.writeProductApplyResult(recorder, req, job, "")
	if lines := strings.Count(recorder.Body.String(), "\n"); lines != total+1 {
		t.Fatalf("CSV has %d lines, want %d", lines, total+1)
	}
}

func TestProductServiceApplyRetryKeepsJobAndOperationIdentity(t *testing.T) {
	st := mustOpenStore(t)
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-retry", OrganizationID: "cloud-1", Type: "product_services_apply", Scope: map[string]any{"product_id": "product-1"}, State: "partial_failed", Total: 1, Failed: 1})
	if err != nil {
		t.Fatal(err)
	}
	item := contracts.BatchJobItem{JobID: job.ID, ItemKey: "device-1", Position: 0, State: "failed", Retryable: true, UpstreamOperationID: "operation-stable"}
	if err := st.UpsertBatchJobItem(item); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"retry-1", "retry-2"} {
		job, _, _, err = st.ActBatchJob(job.OrganizationID, job.ID, "retry", key)
		if err != nil || job.ID != "job-retry" || job.State != "queued" {
			t.Fatalf("retry did not reuse job: %+v, %v", job, err)
		}
		stored, err := st.ListBatchJobItems(job.OrganizationID, job.ID, "", nil, 1, 0)
		if err != nil || stored.Items[0].UpstreamOperationID != "operation-stable" {
			t.Fatalf("operation changed: %+v, %v", stored, err)
		}
		job, err = st.UpdateBatchJobWorkerProgress(job.OrganizationID, job.ID, "partial_failed", 0, 1, 0)
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestProductServiceApplyCancelStopsDispatchAndShowsAcceptedCompletion(t *testing.T) {
	st := mustOpenStore(t)
	accepted, applied, dispatches := false, false, 0
	var cancelErr error
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items"):
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			items := []map[string]any{}
			for i := offset; i < min(offset+limit, 2); i++ {
				status, revision := "pending", 0
				if i == 0 && accepted {
					status = "accepted"
				}
				if i == 0 && applied {
					status, revision = "applied", 3
				}
				items = append(items, map[string]any{"device_id": fmt.Sprintf("device-%d", i), "operation_id": fmt.Sprintf("operation-%d", i), "status": status, "applied_revision": revision})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"total": 2, "items": items})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/dispatch"):
			dispatches++
			accepted = true
			_, _, _, cancelErr = st.ActBatchJob("cloud-1", "job-cancel", "cancel", "cancel-in-flight")
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"item":{"status":"accepted"}}`))
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": "job-cancel", "target_revision": 3, "target_digest": "digest-3", "total_devices": 2, "status": "active"}})
		}
	}))
	defer upstream.Close()
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	_, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-cancel", OrganizationID: "cloud-1", Type: "product_services_apply", Scope: map[string]any{"product_id": "product-1", "target_revision": int64(3), "target_digest": "digest-3"}, Total: 2, AuthorizationID: "authorization-1"})
	if err != nil {
		t.Fatal(err)
	}
	job, err := st.AcquireBatchJob("worker-1", time.Now().UTC(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	srv.runDurableProductServiceApplyJob(context.Background(), job, "user-token", "worker-1", time.Minute)
	if cancelErr != nil {
		t.Fatal(cancelErr)
	}
	job, err = st.CompleteBatchJobBoundary(job.OrganizationID, job.ID, "worker-1")
	if err != nil || job.State != "cancelled" || dispatches != 1 {
		t.Fatalf("cancel boundary: %+v, dispatches=%d, err=%v", job, dispatches, err)
	}
	applied = true // Video Cloud may finish an already accepted operation after cancel.
	srv.runDurableProductServiceApplyJob(context.Background(), job, "user-token", "worker-1", time.Minute)
	if dispatches != 1 {
		t.Fatalf("dispatched after cancellation: %d", dispatches)
	}
	response := httptest.NewRecorder()
	srv.writeProductApplyItems(response, httptest.NewRequest(http.MethodGet, "/items?limit=2&offset=0", nil), job, "user-token")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"state":"completed"`) || !strings.Contains(response.Body.String(), `"state":"queued"`) {
		t.Fatalf("accepted completion not visible after cancel: %d %s", response.Code, response.Body.String())
	}
}

func TestProductServiceApplyPauseStopsDispatchUntilResume(t *testing.T) {
	dispatches := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items") {
			_, _ = w.Write([]byte(`{"total":1,"items":[{"device_id":"device-1","operation_id":"operation-1","status":"pending"}]}`))
			return
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/dispatch") {
			dispatches++
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"item":{"status":"accepted"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"job":{"id":"job-pause","target_revision":4,"target_digest":"digest-4","total_devices":1,"status":"active"}}`))
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	_, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-pause", OrganizationID: "cloud-1", Type: "product_services_apply", Scope: map[string]any{"product_id": "product-1", "target_revision": int64(4), "target_digest": "digest-4"}, Total: 1, AuthorizationID: "authorization-1"})
	if err != nil {
		t.Fatal(err)
	}
	job, err := st.AcquireBatchJob("worker-1", time.Now().UTC(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = st.ActBatchJob(job.OrganizationID, job.ID, "pause", "pause-before-dispatch"); err != nil {
		t.Fatal(err)
	}
	srv.runDurableProductServiceApplyJob(context.Background(), job, "user-token", "worker-1", time.Minute)
	job, err = st.CompleteBatchJobBoundary(job.OrganizationID, job.ID, "worker-1")
	if err != nil || job.State != "paused" || dispatches != 0 {
		t.Fatalf("pause dispatched: %+v dispatches=%d err=%v", job, dispatches, err)
	}
	if _, _, _, err = st.ActBatchJob(job.OrganizationID, job.ID, "resume", "resume-after-pause"); err != nil {
		t.Fatal(err)
	}
	job, err = st.AcquireBatchJob("worker-1", time.Now().UTC(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	srv.runDurableProductServiceApplyJob(context.Background(), job, "user-token", "worker-1", time.Minute)
	if dispatches != 1 {
		t.Fatalf("resume did not dispatch: %d", dispatches)
	}
}
