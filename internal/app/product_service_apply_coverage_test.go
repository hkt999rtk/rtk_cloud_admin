package app

import (
	"context"
	"encoding/json"
	"fmt"
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

// These requests go through the same browser routes as the Product page. In
// particular, a valid session alone must never bypass Product-scoped access.
type productApplyRouteFixture struct {
	server       *Server
	store        *store.Store
	session      store.Session
	statuses     map[string]int
	access       bool
	cloudRead    bool
	cloudManage  bool
	productOwner bool
	profileCloud string
	cancelCalls  int
	authCalls    int
	jobCalls     int
}

func newProductApplyRouteFixture(t *testing.T) *productApplyRouteFixture {
	t.Helper()
	f := &productApplyRouteFixture{statuses: map[string]int{}, access: true, cloudRead: true, cloudManage: true, productOwner: true, profileCloud: cloudA}
	created := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		kind := ""
		switch {
		case r.URL.Path == "/v1/me":
			kind = "me"
		case r.URL.Path == "/v1/developer/brand-clouds/"+cloudA:
			kind = "cloud"
		case r.URL.Path == "/v1/orgs/"+cloudA+"/device-item-profiles/"+productA:
			kind = "product"
		case strings.HasSuffix(r.URL.Path, "/access/check"):
			kind = "access"
		case strings.HasSuffix(r.URL.Path, "/service-apply-preview"):
			kind = "preview"
		case strings.HasSuffix(r.URL.Path, "/service-apply-jobs"):
			kind = "apply-job"
		case strings.HasSuffix(r.URL.Path, "/job-authorizations"):
			kind = "authorization"
		case strings.HasSuffix(r.URL.Path, "/items"):
			kind = "items"
		case strings.HasSuffix(r.URL.Path, "/cancel"):
			kind = "cancel"
		case strings.HasSuffix(r.URL.Path, "/revoke"):
			kind = "revoke"
		default:
			t.Errorf("unexpected Account Manager request %s %s", r.Method, r.URL)
			http.NotFound(w, r)
			return
		}
		if code := f.statuses[kind]; code != 0 {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"error":"fixture failure"}`))
			return
		}
		switch kind {
		case "me":
			_, _ = w.Write([]byte(`{"user":{"id":"owner-1"},"organizations":[{"id":"` + cloudA + `","role":"owner","capabilities":["product.read","product.manage"]}]}`))
		case "cloud":
			caps := []string{}
			if f.cloudRead {
				caps = append(caps, "product.read")
			}
			if f.cloudManage {
				caps = append(caps, "product.manage")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": map[string]any{"id": cloudA, "my_role": "owner", "capabilities": caps}})
		case "product":
			role := "product_viewer"
			if f.productOwner {
				role = "product_owner"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": productA, "brand_cloud_id": f.profileCloud, "current_user_role": role, "status": "active"}})
		case "access":
			if permission := r.URL.Query().Get("permission"); r.URL.Query().Get("scope_id") != productA || (permission != "registry_device.manage" && permission != "registry_device.read") {
				t.Errorf("wrong Product access scope: %s", r.URL)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"allowed": f.access})
		case "preview":
			_ = json.NewEncoder(w).Encode(map[string]any{"preview_token": "preview-1", "target_revision": 3, "target_digest": "digest-3", "total_devices": 2, "added_options": []string{"ota"}, "removed_options": []string{"device_logging"}, "blockers": []any{}})
		case "apply-job":
			f.jobCalls++
			var input struct {
				JobID string `json:"job_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": input.JobID, "target_revision": 3, "target_digest": "digest-3", "total_devices": 2, "status": "active", "created_at": created}})
		case "authorization":
			f.authCalls++
			_, _ = w.Write([]byte(`{"id":"authorization-1"}`))
		case "items":
			_, _ = w.Write([]byte(`{"total":2,"items":[{"device_id":"device-1","operation_id":"operation-1","status":"applied","applied_revision":3},{"device_id":"device-2","operation_id":"operation-2","status":"pending"}]}`))
		case "cancel":
			f.cancelCalls++
			_, _ = w.Write([]byte(`{"job":{"status":"cancelled"}}`))
		case "revoke":
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(upstream.Close)
	st := mustOpenStore(t)
	f.store = st
	session, err := st.CreateSession("account", "owner-1", "owner@example.test", "user-token", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	f.session = session
	f.server = NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL), Config: config.Config{AccountManagerJobAuthorizationToken: "service-token"}})
	return f
}

func (f *productApplyRouteFixture) request(method, suffix, body, key string) *httptest.ResponseRecorder {
	path := fmt.Sprintf("/api/developer/brand-clouds/%s/products/%s/%s", cloudA, productA, suffix)
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: f.session.ID})
	r.Header.Set("Content-Type", "application/json")
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	f.server.ServeHTTP(w, r)
	return w
}

func TestProductApplyBrowserRoutesRequireScopeAndPreserveIdempotency(t *testing.T) {
	f := newProductApplyRouteFixture(t)
	check := func(method, path, body, key string, want int, contains string) {
		t.Helper()
		w := f.request(method, path, body, key)
		if w.Code != want || (contains != "" && !strings.Contains(w.Body.String(), contains)) {
			t.Fatalf("%s %s: status=%d body=%s, want %d containing %q", method, path, w.Code, w.Body.String(), want, contains)
		}
	}
	check("GET", "service-apply-preview", "", "", http.StatusOK, `"added_options":["ota"]`)
	check("GET", "service-apply-jobs", "", "", http.StatusOK, `"jobs":[]`)
	check("POST", "service-apply-jobs", `{"preview_token":"preview-1"}`, "", http.StatusPreconditionRequired, "IDEMPOTENCY_KEY_REQUIRED")
	check("POST", "service-apply-jobs", `{"preview_token":`, "key-1", http.StatusBadRequest, "")
	check("POST", "service-apply-jobs", `{"preview_token":""}`, "key-1", http.StatusBadRequest, "")
	check("POST", "service-apply-jobs", `{"preview_token":"preview-1"}`, "key-1", http.StatusAccepted, `"target_revision":3`)
	check("POST", "service-apply-jobs", `{"preview_token":"preview-1"}`, "key-1", http.StatusAccepted, `"idempotent_replay":true`)
	check("POST", "service-apply-jobs", `{"preview_token":"preview-2"}`, "key-1", http.StatusConflict, "IDEMPOTENCY_KEY_REUSED")
	if f.jobCalls != 1 || f.authCalls != 1 {
		t.Fatalf("same-key replay made duplicate upstream writes: jobs=%d authorizations=%d", f.jobCalls, f.authCalls)
	}
	jobID := productApplyJobID(cloudA, productA, "key-1")
	check("GET", "service-apply-jobs", "", "", http.StatusOK, jobID)
	check("GET", "service-apply-jobs/"+jobID, "", "", http.StatusOK, `"job"`)
	check("GET", "service-apply-jobs/"+jobID+"/items?limit=0", "", "", http.StatusOK, `"limit":100`)
	check("GET", "service-apply-jobs/"+jobID+"/items?offset=-1", "", "", http.StatusBadRequest, "invalid offset")
	check("GET", "service-apply-jobs/"+jobID+"/result", "", "", http.StatusBadRequest, "CSV format required")
	check("GET", "service-apply-jobs/"+jobID+"/result?format=csv", "", "", http.StatusOK, "device_id,status,attempt")
	check("GET", "service-apply-jobs/missing", "", "", http.StatusNotFound, "")
	check("POST", "service-apply-jobs/"+jobID+"/unsupported", "", "bad-action", http.StatusNotFound, "")
	check("POST", "service-apply-jobs/"+jobID+"/pause", "", "", http.StatusPreconditionRequired, "IDEMPOTENCY_KEY_REQUIRED")
	check("POST", "service-apply-jobs/"+jobID+"/cancel", "", "cancel-1", http.StatusAccepted, `"state":"cancelled"`)
	check("POST", "service-apply-jobs/"+jobID+"/cancel", "", "cancel-1", http.StatusAccepted, `"idempotent_replay":true`)
	if f.cancelCalls != 2 { // Upstream cancellation is idempotent too.
		t.Fatalf("unexpected upstream cancel count: %d", f.cancelCalls)
	}
	check("GET", "service-apply-jobs/"+jobID+"/items", "", "", http.StatusOK, `"state":"completed"`)
	check("GET", "service-apply-jobs/"+jobID+"/result?format=csv", "", "", http.StatusOK, "device-2,queued")
}

func TestProductApplyBrowserRoutesRejectInvalidOrRevokedScope(t *testing.T) {
	f := newProductApplyRouteFixture(t)
	path := "service-apply-preview"
	request := func(method, p, body string) *httptest.ResponseRecorder { return f.request(method, p, body, "key-1") }
	w := httptest.NewRecorder()
	f.server.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/developer/brand-clouds/invalid/products/"+productA+"/"+path, nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("missing session: %d", w.Code)
	}
	w = request(http.MethodGet, "service-apply-jobs/not-a-job", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing job: %d", w.Code)
	}
	f.cloudRead = false
	if w = request(http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Fatalf("cloud read: %d", w.Code)
	}
	f.cloudRead = true
	f.profileCloud = cloudB
	if w = request(http.MethodGet, path, ""); w.Code != http.StatusBadGateway {
		t.Fatalf("cross-cloud Product: %d", w.Code)
	}
	f.profileCloud = cloudA
	f.cloudManage, f.productOwner = false, false
	if w = request(http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Fatalf("Product edit: %d", w.Code)
	}
	f.cloudManage, f.productOwner = true, true
	f.access = false
	if w = request(http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Fatalf("Product access: %d", w.Code)
	}
	f.access = true
	for _, kind := range []string{"cloud", "product", "access", "preview"} {
		f.statuses[kind] = http.StatusServiceUnavailable
		w = request(http.MethodGet, path, "")
		if w.Code < 400 {
			t.Fatalf("%s outage allowed preview: %d %s", kind, w.Code, w.Body.String())
		}
		delete(f.statuses, kind)
	}
	w = request(http.MethodPost, "service-apply-jobs", `{"preview_token":"preview-1"}`)
	if w.Code != http.StatusAccepted {
		t.Fatalf("precondition: %d %s", w.Code, w.Body.String())
	}
	f.statuses["cancel"] = http.StatusServiceUnavailable
	jobID := productApplyJobID(cloudA, productA, "key-1")
	w = request(http.MethodPost, "service-apply-jobs/"+jobID+"/cancel", "")
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"upstream_cancel_pending":true`) {
		t.Fatalf("cancel outage: %d %s", w.Code, w.Body.String())
	}
}

func TestProductApplyJobAccessChecksProductScopeForReadAndManage(t *testing.T) {
	f := newProductApplyRouteFixture(t)
	job := contracts.BatchJob{Scope: map[string]any{"product_id": productA}}
	request := httptest.NewRequest(http.MethodGet, "/api/jobs/job-1", nil)
	for _, manage := range []bool{false, true} {
		w := httptest.NewRecorder()
		if !f.server.authorizeCustomerProductApplyJob(w, request, f.session, cloudA, "user-token", job, manage) || w.Code != http.StatusOK {
			t.Fatalf("authorized manage=%t: %d %s", manage, w.Code, w.Body.String())
		}
	}
	f.access = false
	w := httptest.NewRecorder()
	if f.server.authorizeCustomerProductApplyJob(w, request, f.session, cloudA, "user-token", job, false) || w.Code != http.StatusNotFound {
		t.Fatalf("revoked Product access: %d", w.Code)
	}
	f.access = true
	f.statuses["access"] = http.StatusServiceUnavailable
	w = httptest.NewRecorder()
	if f.server.authorizeCustomerProductApplyJob(w, request, f.session, cloudA, "user-token", job, true) || w.Code != http.StatusServiceUnavailable {
		t.Fatalf("access source outage: %d", w.Code)
	}
	delete(f.statuses, "access")
	job.Scope["product_id"] = "untrusted"
	w = httptest.NewRecorder()
	if f.server.authorizeCustomerProductApplyJob(w, request, f.session, cloudA, "user-token", job, true) || w.Code != http.StatusNotFound {
		t.Fatalf("invalid Product scope: %d", w.Code)
	}
	f.server.accountClient = nil
	w = httptest.NewRecorder()
	if f.server.authorizeCustomerProductApplyJob(w, request, f.session, cloudA, "user-token", job, true) || w.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing Account Manager: %d", w.Code)
	}
}

func TestProductApplyAdmissionFailsClosedAndCancelsDefinitiveDenial(t *testing.T) {
	for _, tc := range []struct {
		name       string
		configure  func(*productApplyRouteFixture)
		wantStatus int
		wantCancel int
	}{
		{"authorization-unavailable", func(f *productApplyRouteFixture) { f.server.cfg.AccountManagerJobAuthorizationToken = "" }, http.StatusServiceUnavailable, 0},
		{"stale-preview", func(f *productApplyRouteFixture) { f.statuses["apply-job"] = http.StatusConflict }, http.StatusConflict, 0},
		{"definitive-authorization-denial", func(f *productApplyRouteFixture) { f.statuses["authorization"] = http.StatusForbidden }, http.StatusForbidden, 1},
		{"transient-authorization-failure", func(f *productApplyRouteFixture) { f.statuses["authorization"] = http.StatusServiceUnavailable }, http.StatusServiceUnavailable, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newProductApplyRouteFixture(t)
			tc.configure(f)
			w := f.request(http.MethodPost, "service-apply-jobs", `{"preview_token":"preview-1"}`, "fixed-key")
			if w.Code != tc.wantStatus || f.cancelCalls != tc.wantCancel {
				t.Fatalf("status=%d cancel=%d body=%s; want %d/%d", w.Code, f.cancelCalls, w.Body.String(), tc.wantStatus, tc.wantCancel)
			}
		})
	}
	f := newProductApplyRouteFixture(t)
	_, err := f.server.jobs.CreateBatchJob(contracts.BatchJob{ID: "unrelated-job", Type: "device_provision", OrganizationID: cloudA, Scope: map[string]any{"product_id": productA}, IdempotencyKey: "reused-key"})
	if err != nil {
		t.Fatal(err)
	}
	w := f.request(http.MethodPost, "service-apply-jobs", `{"preview_token":"preview-1"}`, "reused-key")
	if w.Code != http.StatusConflict || f.jobCalls != 0 || f.authCalls != 0 {
		t.Fatalf("reused key invoked upstream: %d %s", w.Code, w.Body.String())
	}
}

func TestProductApplyWorkerFailureAndRecoveryBoundaries(t *testing.T) {
	type workerCase struct {
		name       string
		product    string
		revision   any
		jobStatus  string
		jobDigest  string
		itemStatus string
		applied    int
		upstream   string
		wantState  string
		wantDone   int
	}
	cases := []workerCase{
		{name: "invalid-product", product: "", revision: int64(3), wantState: "failed"},
		{name: "invalid-target", product: productA, revision: "bad", wantState: "failed"},
		{name: "upstream-unavailable", product: productA, revision: int64(3), upstream: "job", wantState: "queued"},
		{name: "target-digest-changed", product: productA, revision: int64(3), jobDigest: "different", wantState: "failed"},
		{name: "upstream-cancelled", product: productA, revision: int64(3), jobStatus: "cancelled", wantState: "cancelled"},
		{name: "device-set-changed", product: productA, revision: int64(3), upstream: "items", wantState: "queued"},
		{name: "dispatch-response-lost", product: productA, revision: int64(3), itemStatus: "pending", upstream: "dispatch", wantState: "queued"},
		{name: "wrong-applied-revision", product: productA, revision: int64(3), itemStatus: "applied", applied: 2, wantState: "failed"},
		{name: "unknown-item-state", product: productA, revision: int64(3), itemStatus: "mystery", wantState: "failed"},
		{name: "completion-response-lost", product: productA, revision: int64(3), itemStatus: "applied", applied: 3, upstream: "complete", wantState: "queued", wantDone: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			jobID := "job-worker"
			cancelCalls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				kind := "job"
				if strings.HasSuffix(r.URL.Path, "/items") {
					kind = "items"
				}
				if strings.HasSuffix(r.URL.Path, "/dispatch") {
					kind = "dispatch"
				}
				if strings.HasSuffix(r.URL.Path, "/complete") {
					kind = "complete"
				}
				if strings.HasSuffix(r.URL.Path, "/cancel") {
					kind = "cancel"
					cancelCalls++
				}
				if kind == tc.upstream {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				switch kind {
				case "job":
					digest := "digest-3"
					if tc.jobDigest != "" {
						digest = tc.jobDigest
					}
					status := "active"
					if tc.jobStatus != "" {
						status = tc.jobStatus
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": jobID, "target_revision": 3, "target_digest": digest, "total_devices": 1, "status": status}})
				case "items":
					if tc.upstream == "items" {
						return
					}
					status := tc.itemStatus
					if status == "" {
						status = "pending"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"total": 1, "items": []map[string]any{{"device_id": "device-1", "operation_id": "operation-1", "status": status, "applied_revision": tc.applied}}})
				case "dispatch", "complete", "cancel":
					_, _ = w.Write([]byte(`{}`))
				}
			}))
			t.Cleanup(upstream.Close)
			st := mustOpenStore(t)
			srv := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
			job, err := st.CreateBatchJob(contracts.BatchJob{ID: jobID, OrganizationID: cloudA, Type: "product_services_apply", Scope: map[string]any{"product_id": tc.product, "target_revision": tc.revision, "target_digest": "digest-3"}, Total: 1})
			if err != nil {
				t.Fatal(err)
			}
			srv.runDurableProductServiceApplyJob(context.Background(), job, "delegated-token", "worker-1", time.Minute)
			got, err := st.GetBatchJob(cloudA, jobID)
			if err != nil {
				t.Fatal(err)
			}
			if got.State != tc.wantState || got.Completed != tc.wantDone || cancelCalls != 0 {
				t.Fatalf("job=%+v cancel_calls=%d, want state=%s completed=%d", got, cancelCalls, tc.wantState, tc.wantDone)
			}
		})
	}
}

func TestProductApplyCancelRetriesUpstreamBeforeRevokingGrant(t *testing.T) {
	exchangeFailed, cancelFailed := true, true
	exchanges, cancels, revokes := 0, 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/exchange"):
			exchanges++
			if exchangeFailed {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if r.Header.Get("Authorization") != "Bearer service-token" {
				t.Errorf("exchange did not use service credential")
			}
			_, _ = w.Write([]byte(`{"access_token":"delegated-token","token_type":"Bearer"}`))
		case strings.HasSuffix(r.URL.Path, "/cancel"):
			cancels++
			if r.Header.Get("Authorization") != "Bearer delegated-token" {
				t.Errorf("cancel did not use delegated job credential")
			}
			if cancelFailed {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/revoke"):
			revokes++
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected upstream request: %s", r.URL)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL), Config: config.Config{AccountManagerJobAuthorizationToken: "service-token"}})
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-cancel-retry", OrganizationID: cloudA, Type: "product_services_apply", Scope: map[string]any{"product_id": productA, "target_revision": 3}, State: "cancelled", AuthorizationID: "authorization-1", AuthorizationStatus: "active"})
	if err != nil {
		t.Fatal(err)
	}
	assert := func(wantAuth string, wantExchange, wantCancel, wantRevoke int) {
		t.Helper()
		got, err := st.GetBatchJob(cloudA, job.ID)
		if err != nil || got.AuthorizationStatus != wantAuth || exchanges != wantExchange || cancels != wantCancel || revokes != wantRevoke {
			t.Fatalf("job=%+v err=%v calls=%d/%d/%d, want auth=%s calls=%d/%d/%d", got, err, exchanges, cancels, revokes, wantAuth, wantExchange, wantCancel, wantRevoke)
		}
	}
	s.retryPendingProductApplyCancels(context.Background())
	assert("active", 1, 0, 0)
	exchangeFailed = false
	s.retryPendingProductApplyCancels(context.Background())
	assert("active", 2, 1, 0)
	cancelFailed = false
	s.retryPendingProductApplyCancels(context.Background())
	assert("revoked", 3, 2, 1)
	s.retryPendingProductApplyCancels(context.Background())
	assert("revoked", 3, 2, 1)
}

func TestProductApplyBrowserRejectsForgedWritesAndWrongJobScope(t *testing.T) {
	f := newProductApplyRouteFixture(t)
	path := fmt.Sprintf("/api/developer/brand-clouds/%s/products/%s/service-apply-jobs", cloudA, productA)
	request := func(p string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, p, strings.NewReader(`{"preview_token":"preview-1"}`))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: f.session.ID})
		r.Header.Set("Idempotency-Key", "key-1")
		r.Header.Set("Content-Type", "application/json")
		return r
	}
	for _, tc := range []struct {
		name   string
		path   string
		mutate func(*http.Request)
		want   int
	}{
		{"invalid-cloud", strings.Replace(path, cloudA, "bad", 1), nil, http.StatusBadRequest},
		{"invalid-product", strings.Replace(path, productA, "bad", 1), nil, http.StatusBadRequest},
		{"cross-site", path, func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }, http.StatusForbidden},
		{"forged-origin", path, func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") }, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := request(tc.path)
			if tc.mutate != nil {
				tc.mutate(r)
			}
			w := httptest.NewRecorder()
			f.server.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
	_, err := f.server.jobs.CreateBatchJob(contracts.BatchJob{ID: "job-other-product", Type: "product_services_apply", OrganizationID: cloudA, Scope: map[string]any{"product_id": sharedProductID}})
	if err != nil {
		t.Fatal(err)
	}
	w := f.request(http.MethodGet, "service-apply-jobs/job-other-product", "", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("cross-Product job exposed: %d %s", w.Code, w.Body.String())
	}
	_, err = f.server.jobs.CreateBatchJob(contracts.BatchJob{ID: "job-other-type", Type: "device_provision", OrganizationID: cloudA, Scope: map[string]any{"product_id": productA}})
	if err != nil {
		t.Fatal(err)
	}
	w = f.request(http.MethodGet, "service-apply-jobs/job-other-type", "", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("non-Product job exposed: %d %s", w.Code, w.Body.String())
	}
}

func TestProductApplySchedulerExchangesGrantAndRevokesAfterAppliedReceipt(t *testing.T) {
	var exchanges, completions, revokes, dispatches int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/exchange"):
			exchanges++
			if r.Header.Get("Authorization") != "Bearer service-token" {
				t.Errorf("exchange credential: %s", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"access_token":"delegated-token","token_type":"Bearer"}`))
		case strings.HasSuffix(r.URL.Path, "/items"):
			if r.Header.Get("Authorization") != "Bearer delegated-token" {
				t.Errorf("item credential: %s", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"total":1,"items":[{"device_id":"device-1","operation_id":"stable-operation","status":"applied","applied_revision":3}]}`))
		case strings.HasSuffix(r.URL.Path, "/dispatch"):
			dispatches++
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/complete"):
			completions++
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/revoke"):
			revokes++
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/service-apply-jobs/job-scheduler"):
			_, _ = w.Write([]byte(`{"job":{"id":"job-scheduler","target_revision":3,"target_digest":"digest-3","total_devices":1,"status":"active"}}`))
		default:
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL), Config: config.Config{AccountManagerJobAuthorizationToken: "service-token"}})
	job, err := st.CreateBatchJob(contracts.BatchJob{ID: "job-scheduler", OrganizationID: cloudA, Type: "product_services_apply", Scope: map[string]any{"product_id": productA, "target_revision": 3, "target_digest": "digest-3"}, State: "queued", Total: 1, AuthorizationID: "authorization-1", AuthorizationStatus: "active"})
	if err != nil {
		t.Fatal(err)
	}
	s.runNextDurableBatchJob(context.Background(), "worker-scheduler")
	got, err := st.GetBatchJob(cloudA, job.ID)
	if err != nil || got.State != "completed" || got.Completed != 1 || got.AuthorizationStatus != "revoked" || exchanges != 1 || completions != 1 || revokes != 1 || dispatches != 0 {
		t.Fatalf("job=%+v err=%v exchange=%d complete=%d revoke=%d dispatch=%d", got, err, exchanges, completions, revokes, dispatches)
	}
}

func TestProductApplyExistingJobsAPIUsesProductAccessAndSameJobOnRetry(t *testing.T) {
	f := newProductApplyRouteFixture(t)
	session, err := f.store.CreateSession("customer", "owner-1", "owner@example.test", "user-token", "", cloudA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, key string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, nil)
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		f.server.ServeHTTP(w, r)
		return w
	}
	job, err := f.store.CreateBatchJob(contracts.BatchJob{ID: "job-customer-product", OrganizationID: cloudA, Type: "product_services_apply", Scope: map[string]any{"product_id": productA, "target_revision": 3}, State: "partial_failed", Total: 1, Failed: 1, AuthorizationID: "authorization-1", AuthorizationStatus: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.UpsertBatchJobItem(contracts.BatchJobItem{JobID: job.ID, ItemKey: "device-1", State: "failed", Retryable: true, UpstreamOperationID: "stable-operation"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ path, contains string }{
		{"/api/jobs/" + job.ID, `"type":"product_services_apply"`},
		{"/api/jobs/" + job.ID + "/result", "stable-operation"},
		{"/api/jobs/" + job.ID + "/result?format=csv", "stable-operation"},
	} {
		w := request(http.MethodGet, tc.path, "")
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), tc.contains) {
			t.Fatalf("%s: %d %s", tc.path, w.Code, w.Body.String())
		}
	}
	w := request(http.MethodPost, "/api/jobs/"+job.ID+"/retry", "retry-1")
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), job.ID) {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	w = request(http.MethodPost, "/api/jobs/"+job.ID+"/retry", "retry-1")
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"idempotent_replay":true`) {
		t.Fatalf("same-key retry replay: %d %s", w.Code, w.Body.String())
	}
	w = request(http.MethodPost, "/api/jobs/"+job.ID+"/retry", "retry-2")
	if w.Code != http.StatusConflict {
		t.Fatalf("retry of queued work: %d %s", w.Code, w.Body.String())
	}
	f.access = false
	w = request(http.MethodGet, "/api/jobs/"+job.ID, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("revoked Product read: %d %s", w.Code, w.Body.String())
	}
}
