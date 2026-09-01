package app

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/billingclient"
)

// Opt-in UI protocol fixture only: no real financial records/provider operations.
func TestCloudBillingBrowserFixture(t *testing.T) {
	if os.Getenv("CLOUD_BILLING_UI_FIXTURE") != "1" {
		t.Skip("opt-in disposable fixture")
	}
	t.Chdir("../..")
	var revoked atomic.Bool
	caps := []string{"billing_account.read", "billing_summary.read", "billing_usage.read", "invoice.read", "invoice_document.read", "billing_activity.read", "billing_profile.read", "billing_profile.manage", "billing_statement.export", "billing_ledger.read", "payment_method.read", "payment_method.manage", "payment_intent.read", "payment_intent.create", "auto_topup.read", "auto_topup.manage"}
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := billingOwner
		if r.Header.Get("Authorization") == "Bearer viewer" {
			actor = productA
		}
		if r.URL.Path == "/v1/me" {
			writeJSON(w, map[string]any{"user": map[string]string{"id": actor, "email": "fixture@example.test"}, "brand_cloud_memberships": []any{}})
			return
		}
		cloud := strings.TrimPrefix(r.URL.Path, "/v1/developer/brand-clouds/")
		if cloud != cloudA && cloud != cloudB {
			http.NotFound(w, r)
			return
		}
		role := "owner"
		owner := billingOwner
		permissions := caps
		if actor != billingOwner {
			role = "viewer"
			permissions = []string{}
		}
		if cloud == cloudA && revoked.Load() {
			owner = productA
			role = "member"
			permissions = []string{}
		}
		name := "Cloud A"
		if cloud == cloudB {
			name = "Cloud B"
		}
		writeJSON(w, map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloud, Name: name, OwnerUserID: owner, MyRole: role, OwnershipVersion: 7, Capabilities: permissions}})
	}))
	defer am.Close()
	billing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) < 5 {
			http.NotFound(w, r)
			return
		}
		cloud := parts[3]
		suffix := strings.Join(parts[4:], "/")
		if cloud != cloudA && cloud != cloudB || r.Header.Get("X-Billing-Actor-ID") != billingOwner || r.Header.Get("X-Billing-Ownership-Version") != "7" || cloud == cloudA && revoked.Load() {
			writeJSONStatus(w, 403, map[string]string{"code": "BILLING_OWNER_REQUIRED"})
			return
		}
		amount := int64(100)
		name := "Payer A"
		if cloud == cloudB {
			amount = 200
			name = "Payer B"
		}
		account := map[string]any{"id": cloud, "organization_id": cloud, "currency": "TWD", "available_balance_minor": amount, "state": "active", "version": 1}
		switch suffix {
		case "billing/account":
			writeJSON(w, map[string]any{"account": account, "auto_topup": nil, "payment_providers": []any{}})
		case "billing/summary":
			writeJSON(w, map[string]any{"account": account, "forecast": map[string]string{"state": "insufficient_data"}})
		case "billing/usage":
			writeJSON(w, map[string]any{"currency": "TWD", "total_minor": 0, "lines": []any{}})
		case "billing/profile":
			writeJSON(w, map[string]any{"billing_profile": map[string]any{"legal_name": name, "version": 1, "locale": "en-US", "timezone": "Asia/Taipei", "delivery_preference": "portal"}})
		case "billing/invoices":
			writeJSON(w, map[string]any{"invoices": []any{}, "pagination": map[string]int{"total": 0}})
		case "billing/activity":
			writeJSON(w, map[string]any{"activities": []any{}, "pagination": map[string]int{"total": 0}})
		case "billing/ledger":
			writeJSON(w, map[string]any{"ledger_entries": []any{}})
		case "payment-methods":
			writeJSON(w, map[string]any{"payment_methods": []any{}})
		case "payment-intents":
			writeJSON(w, map[string]any{"payment_intents": []any{}})
		case "auto-topup":
			w.Header().Set("ETag", `"0"`)
			writeJSON(w, map[string]any{"auto_topup": nil})
		default:
			http.NotFound(w, r)
		}
	}))
	defer billing.Close()
	st := mustOpenStore(t)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(am.URL), BillingClient: billingclient.New(billing.URL, strings.Repeat("b", 32))})
	for i, role := range []string{"owner", "viewer"} {
		actor := billingOwner
		if role == "viewer" {
			actor = productA
		}
		session, err := st.CreateSession("account", actor, "fixture@example.test", role, "", cloudB, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", 18195+i))
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" && r.URL.Path == "/__fixture__/revoke" {
				revoked.Store(true)
				w.WriteHeader(204)
				return
			}
			// Isolate the disposable server session from other localhost fixtures.
			r.Header.Set("Cookie", "rtk_admin_session="+session.ID)
			s.ServeHTTP(w, r)
		})
		server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
		defer server.Close()
		go server.Serve(listener)
	}
	fmt.Println("Disposable Billing UI fixture: owner 18195, viewer 18196")
	<-t.Context().Done()
}
