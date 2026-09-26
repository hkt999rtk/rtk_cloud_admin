package accountclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestProductServiceCatalogAndApplyClientContract(t *testing.T) {
	const (
		cloud   = "cloud/one"
		product = "product/one"
		jobID   = "job/one"
		device  = "device/one"
	)
	applyPath := "/v1/orgs/" + url.PathEscape(cloud) + "/device-item-profiles/" + url.PathEscape(product) + "/service-apply"
	jobPath := applyPath + "-jobs/" + url.PathEscape(jobID)
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.EscapedPath())
		if got := r.Header.Get("Authorization"); got != "Bearer operator-token" {
			t.Errorf("authorization = %q", got)
		}
		if got := r.Header.Get("Accept"); got != "application/json" {
			t.Errorf("accept = %q", got)
		}
		if r.Method == http.MethodPost {
			if got := r.Header.Get("Content-Type"); got != "application/json" {
				t.Errorf("content type = %q", got)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode %s body: %v", r.URL.Path, err)
			}
			switch r.URL.EscapedPath() {
			case applyPath + "-jobs":
				if body["job_id"] != jobID || body["preview_token"] != "preview-1" || len(body) != 2 {
					t.Errorf("job creation body = %#v", body)
				}
			default:
				if len(body) != 0 {
					t.Errorf("action body = %#v", body)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.EscapedPath() {
		case http.MethodGet + " /v1/platform/service-options":
			if r.URL.Query().Get("brand_cloud_id") != cloud {
				t.Errorf("catalog cloud scope = %q", r.URL.Query().Get("brand_cloud_id"))
			}
			_, _ = w.Write([]byte(`{"catalog_revision":9,"product_writes_enabled":true,"options":[{"code":"mqtt","display_name":"MQTT","selectable":true},{"code":"device_logging","display_name":"Device logging","requires":["mqtt"],"log_retention_days":[7,30,90],"selectable":false,"unavailable_reason":"lease_expired"}]}`))
		case http.MethodGet + " " + applyPath + "-preview":
			_, _ = w.Write([]byte(`{"preview_token":"preview-1","target_revision":3,"target_digest":"digest-3","total_devices":3,"added_count":2,"removed_count":1,"added_options":["device_logging"],"removed_options":["ota"],"blockers":[]}`))
		case http.MethodPost + " " + applyPath + "-jobs", http.MethodGet + " " + jobPath:
			_, _ = w.Write([]byte(`{"job":{"id":"job/one","target_revision":3,"target_digest":"digest-3","total_devices":3,"status":"running","created_at":"2026-09-26T00:00:00Z"}}`))
		case http.MethodGet + " " + jobPath + "/items":
			if r.URL.Query().Get("limit") != "3" || r.URL.Query().Get("offset") != "1" {
				t.Errorf("items paging = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"items":[{"device_id":"device/one","operation_id":"op-1","status":"applied","baseline_revision":2,"baseline_digest":"old","baseline_state":"active","applied_revision":3},{"device_id":"device/two","operation_id":"op-2","status":"pending","baseline_revision":2,"baseline_digest":"old","baseline_state":"suspended"}],"total":3}`))
		case http.MethodPost + " " + jobPath + "/items/" + url.PathEscape(device) + "/dispatch",
			http.MethodPost + " " + jobPath + "/cancel",
			http.MethodPost + " " + jobPath + "/complete":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := New(server.URL)
	ctx := t.Context()
	catalog, err := client.ServiceCatalog(ctx, "operator-token", cloud)
	if err != nil || catalog.CatalogRevision != 9 || !catalog.ProductWritesEnabled || len(catalog.Options) != 2 || catalog.Options[1].UnavailableReason != "lease_expired" || len(catalog.Options[1].LogRetentionDays) != 3 {
		t.Fatalf("catalog = %+v, %v", catalog, err)
	}
	preview, err := client.ServiceApplyPreview(ctx, "operator-token", cloud, product)
	if err != nil || preview.TargetRevision != 3 || preview.TotalDevices != 3 || len(preview.AddedOptions) != 1 || len(preview.RemovedOptions) != 1 {
		t.Fatalf("preview = %+v, %v", preview, err)
	}
	created, err := client.CreateServiceApplyJob(ctx, "operator-token", cloud, product, jobID, preview.PreviewToken)
	if err != nil || created.ID != jobID || created.CreatedAt.IsZero() {
		t.Fatalf("created job = %+v, %v", created, err)
	}
	read, err := client.ServiceApplyJob(ctx, "operator-token", cloud, product, jobID)
	if err != nil || read.TargetDigest != created.TargetDigest || !read.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("read job = %+v, %v", read, err)
	}
	page, err := client.ServiceApplyItems(ctx, "operator-token", cloud, product, jobID, 3, 1)
	if err != nil || page.Total != 3 || len(page.Items) != 2 || page.Items[0].AppliedRevision != 3 || page.Items[1].BaselineState != "suspended" {
		t.Fatalf("items = %+v, %v", page, err)
	}
	for name, action := range map[string]func() error{
		"dispatch": func() error {
			return client.DispatchServiceApplyItem(ctx, "operator-token", cloud, product, jobID, device)
		},
		"cancel":   func() error { return client.CancelServiceApplyJob(ctx, "operator-token", cloud, product, jobID) },
		"complete": func() error { return client.CompleteServiceApplyJob(ctx, "operator-token", cloud, product, jobID) },
	} {
		if err := action(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if len(requests) != 8 {
		t.Fatalf("request count = %d, paths = %v", len(requests), requests)
	}
}

func TestProductServiceClientRejectsIncompleteAndFailedUpstreamResponses(t *testing.T) {
	var status int
	var response string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	defer server.Close()
	client := New(server.URL)
	ctx := t.Context()
	const cloud, product, jobID = "cloud-1", "product-1", "job-1"
	tests := []struct {
		name     string
		status   int
		response string
		call     func() error
		wantHTTP int
		wantText string
	}{
		{"catalog revision", 200, `{"catalog_revision":0,"options":[]}`, func() error { _, err := client.ServiceCatalog(ctx, "token", cloud); return err }, 0, "incomplete service catalog"},
		{"catalog options", 200, `{"catalog_revision":1}`, func() error { _, err := client.ServiceCatalog(ctx, "token", cloud); return err }, 0, "incomplete service catalog"},
		{"catalog outage", 503, `registry unavailable`, func() error { _, err := client.ServiceCatalog(ctx, "token", cloud); return err }, 503, "registry unavailable"},
		{"preview token", 200, `{"target_revision":1,"total_devices":0}`, func() error { _, err := client.ServiceApplyPreview(ctx, "token", cloud, product); return err }, 0, "incomplete Product service apply preview"},
		{"preview revision", 200, `{"preview_token":"preview","total_devices":0}`, func() error { _, err := client.ServiceApplyPreview(ctx, "token", cloud, product); return err }, 0, "incomplete Product service apply preview"},
		{"preview count", 200, `{"preview_token":"preview","target_revision":1,"total_devices":-1}`, func() error { _, err := client.ServiceApplyPreview(ctx, "token", cloud, product); return err }, 0, "incomplete Product service apply preview"},
		{"preview forbidden", 403, `forbidden`, func() error { _, err := client.ServiceApplyPreview(ctx, "token", cloud, product); return err }, 403, "forbidden"},
		{"create wrong job", 200, `{"job":{"id":"other","target_revision":1,"total_devices":0,"created_at":"2026-09-26T00:00:00Z"}}`, func() error {
			_, err := client.CreateServiceApplyJob(ctx, "token", cloud, product, jobID, "preview")
			return err
		}, 0, "incomplete Product service apply job"},
		{"create missing revision", 200, `{"job":{"id":"job-1","total_devices":0,"created_at":"2026-09-26T00:00:00Z"}}`, func() error {
			_, err := client.CreateServiceApplyJob(ctx, "token", cloud, product, jobID, "preview")
			return err
		}, 0, "incomplete Product service apply job"},
		{"create missing timestamp", 200, `{"job":{"id":"job-1","target_revision":1,"total_devices":0}}`, func() error {
			_, err := client.CreateServiceApplyJob(ctx, "token", cloud, product, jobID, "preview")
			return err
		}, 0, "incomplete Product service apply job"},
		{"create stale preview", 409, `preview changed`, func() error {
			_, err := client.CreateServiceApplyJob(ctx, "token", cloud, product, jobID, "preview")
			return err
		}, 409, "preview changed"},
		{"read wrong job", 200, `{"job":{"id":"other"}}`, func() error { _, err := client.ServiceApplyJob(ctx, "token", cloud, product, jobID); return err }, 0, "invalid Product service apply job"},
		{"read missing job", 404, `missing`, func() error { _, err := client.ServiceApplyJob(ctx, "token", cloud, product, jobID); return err }, 404, "missing"},
		{"items missing list", 200, `{"total":0}`, func() error {
			_, err := client.ServiceApplyItems(ctx, "token", cloud, product, jobID, 2, 0)
			return err
		}, 0, "incomplete Product service apply items"},
		{"items negative total", 200, `{"items":[],"total":-1}`, func() error {
			_, err := client.ServiceApplyItems(ctx, "token", cloud, product, jobID, 2, 0)
			return err
		}, 0, "incomplete Product service apply items"},
		{"items over limit", 200, `{"items":[{},{},{}],"total":3}`, func() error {
			_, err := client.ServiceApplyItems(ctx, "token", cloud, product, jobID, 2, 0)
			return err
		}, 0, "incomplete Product service apply items"},
		{"items beyond total", 200, `{"items":[{},{}],"total":2}`, func() error {
			_, err := client.ServiceApplyItems(ctx, "token", cloud, product, jobID, 2, 1)
			return err
		}, 0, "incomplete Product service apply items"},
		{"items negative offset", 200, `{"items":[],"total":0}`, func() error {
			_, err := client.ServiceApplyItems(ctx, "token", cloud, product, jobID, 2, -1)
			return err
		}, 0, "incomplete Product service apply items"},
		{"dispatch unauthorized", 401, `token expired`, func() error { return client.DispatchServiceApplyItem(ctx, "token", cloud, product, jobID, "device-1") }, 401, "token expired"},
		{"cancel conflict", 409, `already completed`, func() error { return client.CancelServiceApplyJob(ctx, "token", cloud, product, jobID) }, 409, "already completed"},
		{"complete unavailable", 503, `down`, func() error { return client.CompleteServiceApplyJob(ctx, "token", cloud, product, jobID) }, 503, "down"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, response = tc.status, tc.response
			err := tc.call()
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("error = %v, want %q", err, tc.wantText)
			}
			var httpErr *HTTPError
			if tc.wantHTTP != 0 && (!errors.As(err, &httpErr) || httpErr.StatusCode != tc.wantHTTP) {
				t.Fatalf("HTTP error = %v, want status %d", err, tc.wantHTTP)
			}
		})
	}

	status, response = http.StatusOK, `{"catalog_revision":1,"options":[]}`
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := client.ServiceCatalog(cancelled, "token", cloud); !errors.Is(err, context.Canceled) {
		t.Fatalf("catalog canceled context = %v", err)
	}
	status, response = http.StatusOK, `{`
	if _, err := client.ServiceApplyPreview(ctx, "token", cloud, product); err == nil {
		t.Fatal("expected malformed preview JSON to fail")
	}
}
