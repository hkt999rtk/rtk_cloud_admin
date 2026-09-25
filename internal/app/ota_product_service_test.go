package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
)

func TestOTARequiresProductServiceSelection(t *testing.T) {
	upstream, fixture := newScopedProductsFixture(t)
	s := NewWithOptions(mustOpenStore(t), Options{AccountClient: accountclient.New(upstream.URL)})
	check := func(cloudID string) (bool, int) {
		w := httptest.NewRecorder()
		allowed := s.requireOTAProduct(w, context.Background(), "fixture-token", cloudID, productA)
		return allowed, w.Code
	}
	if allowed, status := check(cloudA); allowed || status != http.StatusConflict {
		t.Fatalf("Product without OTA allowed=%t status=%d", allowed, status)
	}
	fixture.mu.Lock()
	product := fixture.products[productA]
	product.ServiceOptions = append(product.ServiceOptions, "ota")
	fixture.products[productA] = product
	fixture.mu.Unlock()
	if allowed, status := check(cloudA); !allowed || status != http.StatusOK {
		t.Fatalf("Product with OTA allowed=%t status=%d", allowed, status)
	}
	fixture.mu.Lock()
	product = fixture.products[productA]
	product.Status = "disabled"
	fixture.products[productA] = product
	fixture.mu.Unlock()
	if allowed, status := check(cloudA); allowed || status != http.StatusConflict {
		t.Fatalf("disabled Product allowed=%t status=%d", allowed, status)
	}
	if allowed, status := check(cloudB); allowed || status != http.StatusNotFound {
		t.Fatalf("cross-cloud Product allowed=%t status=%d", allowed, status)
	}
}

func TestOTAProductLookupFailuresPreserveStatuses(t *testing.T) {
	for _, tc := range []struct {
		name, body  string
		upstream    int
		want        int
		wantMissing bool
	}{
		{"forbidden", "access denied", http.StatusForbidden, http.StatusForbidden, false},
		{"missing Product", "private detail", http.StatusNotFound, http.StatusNotFound, true},
		{"server failure", "private detail", http.StatusInternalServerError, http.StatusBadGateway, false},
		{"unavailable", "unavailable", http.StatusServiceUnavailable, http.StatusBadGateway, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, tc.body, tc.upstream)
			}))
			defer upstream.Close()
			s := NewWithOptions(mustOpenStore(t), Options{AccountClient: accountclient.New(upstream.URL)})
			w := httptest.NewRecorder()
			if s.requireOTAProduct(w, context.Background(), "fixture-token", cloudA, productA) || w.Code != tc.want || strings.Contains(w.Body.String(), "PRODUCT_NOT_FOUND") != tc.wantMissing || strings.Contains(w.Body.String(), tc.body) {
				t.Fatalf("lookup failure status=%d body=%q; want %d missing=%t without upstream details", w.Code, w.Body.String(), tc.want, tc.wantMissing)
			}
		})
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	s := NewWithOptions(mustOpenStore(t), Options{AccountClient: accountclient.New(upstream.URL)})
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	w := httptest.NewRecorder()
	if s.requireOTAProduct(w, ctx, "fixture-token", cloudA, productA) || w.Code != http.StatusGatewayTimeout || strings.Contains(w.Body.String(), "PRODUCT_NOT_FOUND") {
		t.Fatalf("timeout status=%d body=%q", w.Code, w.Body.String())
	}
}
