package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

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
