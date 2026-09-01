package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/billingclient"
)

const billingOwner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

func TestCloudBillingRejectsNonOwnerAndStaleVersionBeforeDelivery(t *testing.T) {
	for _, tc := range []struct {
		name, role, owner string
		version           int64
		capability        bool
		status            int
	}{
		{"owner", "owner", billingOwner, 7, true, 200},
		{"viewer_with_forged_capability", "viewer", billingOwner, 7, true, 403},
		{"admin", "admin", billingOwner, 7, true, 403},
		{"member", "member", billingOwner, 7, true, 403},
		{"previous_owner", "owner", productA, 7, true, 403},
		{"missing_capability", "owner", billingOwner, 7, false, 403},
		{"unproven_version", "owner", billingOwner, 0, true, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/developer/brand-clouds/"+cloudA || r.Header.Get("Authorization") != "Bearer global" {
					t.Error("wrong live authority lookup")
					w.WriteHeader(500)
					return
				}
				caps := []string{}
				if tc.capability {
					caps = []string{"billing_account.read"}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloudA, MyRole: tc.role, OwnerUserID: tc.owner, OwnershipVersion: tc.version, Capabilities: caps}})
			}))
			defer am.Close()
			billing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/v1/orgs/"+cloudA+"/billing/account" || r.Header.Get("X-Billing-Ownership-Version") != "7" || r.Header.Get("X-Billing-Actor-ID") != billingOwner || r.Header.Get("X-Billing-Permissions") != "billing_account.read" || r.Header.Get("X-Billing-Owner-User-ID") != "" {
					t.Error("forged or incorrect Billing scope")
				}
				writeJSON(w, map[string]any{"account": map[string]string{"organization_id": cloudA}})
			}))
			defer billing.Close()
			st := mustOpenStore(t)
			session, _ := st.CreateSession("platform_admin", billingOwner, "owner@example.test", "global", "", cloudB, time.Hour)
			s := NewWithOptions(st, Options{AccountClient: accountclient.New(am.URL), BillingClient: billingclient.New(billing.URL, strings.Repeat("b", 32))})
			r := httptest.NewRequest("GET", "/api/developer/brand-clouds/"+cloudA+"/billing/account", nil)
			r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
			for k, v := range map[string]string{"X-Billing-Actor-ID": productA, "X-Billing-Ownership-Version": "99", "X-Billing-Permissions": "*", "X-Billing-Owner-User-ID": productA} {
				r.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			want := int32(0)
			if tc.status == 200 {
				want = 1
			}
			if calls.Load() != want {
				t.Fatal("denied owner reached Billing")
			}
			stored, _ := st.GetSession(session.ID)
			if stored.ActiveOrgID != cloudB || stored.Kind != "platform_admin" {
				t.Fatal("changed shared session")
			}
		})
	}
}

func TestCloudBillingWritesBindDisplayedOwnershipVersion(t *testing.T) {
	am := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"brand_cloud": accountclient.ManagedCloud{ID: cloudA, OwnerUserID: billingOwner, MyRole: "owner", OwnershipVersion: 8, Capabilities: []string{"billing_profile.manage"}}})
	}))
	defer am.Close()
	billing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("stale write delivered"); w.WriteHeader(500) }))
	defer billing.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("account", billingOwner, "owner@example.test", "global", "", cloudB, time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(am.URL), BillingClient: billingclient.New(billing.URL, strings.Repeat("b", 32))})
	for _, version := range []string{"", "7", "08", "-1"} {
		r := httptest.NewRequest("PUT", "/api/developer/brand-clouds/"+cloudA+"/billing/profile", strings.NewReader(`{"legal_name":"New payer","version":1}`))
		r.Header.Set("X-Cloud-Ownership-Version", version)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 409 {
			t.Fatalf("version %s: %d", version, w.Code)
		}
	}
	legacy := httptest.NewRecorder()
	s.ServeHTTP(legacy, httptest.NewRequest("GET", "/api/billing/account", nil))
	if legacy.Code != 404 {
		t.Fatal("unscoped Billing still routed")
	}
}
