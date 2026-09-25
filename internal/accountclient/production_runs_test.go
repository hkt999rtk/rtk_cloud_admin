package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestFactoryProductionRunClientPreservesScopeIntentAndStop(t *testing.T) {
	const base = "/v1/orgs/cloud-1/device-item-profiles/product-1/production-runs"
	from := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	until := from.Add(24 * time.Hour)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer customer-token" {
			t.Errorf("missing customer authorization: %q", r.Header.Get("Authorization"))
		}
		switch calls {
		case 1:
			if r.Method != http.MethodGet || r.URL.Path != base || r.URL.Query().Get("status") != "active" {
				t.Errorf("wrong list request: %s %s", r.Method, r.URL.String())
			}
			_, _ = w.Write([]byte(`{"production_runs":[{"id":"run-1","status":"active"}]}`))
		case 2:
			if r.Method != http.MethodPost || r.URL.Path != base || r.Header.Get("Idempotency-Key") != "intent-1" {
				t.Errorf("wrong create request: %s %s intent=%q", r.Method, r.URL.Path, r.Header.Get("Idempotency-Key"))
			}
			var body struct {
				FactoryID       string    `json:"factory_id"`
				BatchID         string    `json:"batch_id"`
				AllowedQuantity int       `json:"allowed_quantity"`
				ValidFrom       time.Time `json:"valid_from"`
				ValidUntil      time.Time `json:"valid_until"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.FactoryID != "line-a" || body.BatchID != "batch-a" || body.AllowedQuantity != 25 || !body.ValidFrom.Equal(from) || !body.ValidUntil.Equal(until) {
				t.Errorf("wrong scoped request body: %+v", body)
			}
			_, _ = w.Write([]byte(`{"production_run":{"id":"run-1","status":"active"},"factory_jwt":"once-only"}`))
		case 3:
			if r.Method != http.MethodPost || r.URL.Path != base+"/run-1/stop" {
				t.Errorf("wrong stop request: %s %s", r.Method, r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"production_run":{"id":"run-1","status":"stopped"}}`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer upstream.Close()
	client := New(upstream.URL)
	query := url.Values{"status": {"active"}}
	runs, err := client.ProductionRuns(context.Background(), "customer-token", "cloud-1", "product-1", query)
	if err != nil || len(runs) != 1 || runs[0].ID != "run-1" {
		t.Fatalf("list: runs=%+v err=%v", runs, err)
	}
	issued, err := client.CreateFactoryProductionRun(context.Background(), "customer-token", "cloud-1", "product-1", "intent-1", "line-a", "batch-a", 25, from, until)
	if err != nil || issued.ProductionRun.ID != "run-1" || issued.FactoryJWT != "once-only" {
		t.Fatalf("create: issued=%+v err=%v", issued, err)
	}
	stopped, err := client.StopFactoryProductionRun(context.Background(), "customer-token", "cloud-1", "product-1", "run-1")
	if err != nil || stopped.ID != "run-1" || stopped.Status != "stopped" {
		t.Fatalf("stop: run=%+v err=%v", stopped, err)
	}
	if calls != 3 {
		t.Fatalf("upstream calls = %d, want 3", calls)
	}
}
