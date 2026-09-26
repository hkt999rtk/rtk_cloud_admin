package app

import (
	_ "embed"
	"encoding/json"
	"net/http"
)

type pricingReferenceRow struct {
	ID                 string   `json:"id"`
	Price              *float64 `json:"price"`
	ReferencePrice     float64  `json:"reference_price"`
	Benchmark          string   `json:"benchmark"`
	BenchmarkLocalized string   `json:"benchmark_localized,omitempty"`
}

type pricingReferenceCatalog struct {
	Currency        string                `json:"currency"`
	ReferenceDate   string                `json:"reference_date"`
	FXNote          string                `json:"fx_note"`
	FXNoteLocalized string                `json:"fx_note_localized,omitempty"`
	Rows            []pricingReferenceRow `json:"rows"`
}

// This research catalog has no effective Billing rate-card version. Its four
// approved OTA prices are pending activation; the other 11 have no RTK price.
//
//go:embed service-pricing-reference.json
var pricingReferenceJSON []byte

var pricingReferences = func() pricingReferenceCatalog {
	var catalog pricingReferenceCatalog
	if err := json.Unmarshal(pricingReferenceJSON, &catalog); err != nil {
		panic(err)
	}
	return catalog
}()

func (s *Server) apiBillingPricingReferences(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.billingOwnerContext(w, r, "billing_account.read", false)
	if !ok {
		return
	}
	locale := r.Header.Get("X-RTK-Locale")
	if locale != "en" && locale != "zh-TW" && locale != "zh-CN" {
		locale = preferredAPILocale(r)
	}
	w.Header().Set("Content-Language", locale)
	catalog := pricingReferences
	catalog.Rows = append([]pricingReferenceRow(nil), catalog.Rows...)
	if copy, translated := localizedAPICopy[locale]; translated {
		catalog.FXNoteLocalized = copy.System[catalog.FXNote]
		for i := range catalog.Rows {
			catalog.Rows[i].BenchmarkLocalized = copy.System[catalog.Rows[i].Benchmark]
		}
	}
	writeJSON(w, map[string]any{
		"cloud_id": ctx.org.ID,
		"catalog":  catalog,
	})
}
