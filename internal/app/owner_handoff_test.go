package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"rtk_cloud_admin/internal/accountclient"
	"strings"
	"testing"
	"time"
)

func handoffFixture(phase string) accountclient.OwnerHandoff {
	no := false
	v := accountclient.OwnerHandoff{ID: productA, CloudID: cloudA, SourceUserID: "source", RequestedByUserID: "source", TargetUserID: "target", Status: "accepted", Phase: phase, OperationPhase: "preparing", Blockers: []accountclient.CloudBlocker{}, HasSettledSnapshot: true, OwnershipVersion: 1, BalanceSnapshot: &accountclient.HandoffSnapshot{OwnershipVersion: 1, BillingSnapshotVersion: 2, BalanceMinor: 0, Currency: "TWD"}, SourceConfirmed: &no, TargetConfirmed: &no, Operation: &accountclient.ManagedCloudOperation{ID: productA, CloudID: cloudA, Type: "owner_transfer", State: "running", Phase: phase}}
	return v
}

func TestGlobalInvitationPagesHavePublicShells(t *testing.T) {
	s := NewWithOptions(mustOpenStore(t), Options{})
	for _, path := range []string{"/brand-cloud-owner-transfer/accept", "/brand-cloud-member-invitation/accept", "/product-collaborator-invitation/accept"} {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("GET", path+"?token=fixture-only", nil))
		if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
}

func TestOwnerHandoffBFFDoesNotRequireMembershipOrActiveCloud(t *testing.T) {
	for _, actor := range []string{"source", "target", "outsider"} {
		t.Run(actor, func(t *testing.T) {
			var count int
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count++
				if r.Header.Get("Authorization") != "Bearer global" || r.Header.Get("X-Billing-Owner-User-ID") != "" {
					t.Error("unsafe identity propagation")
				}
				if strings.HasSuffix(r.URL.Path, "/confirm") {
					if r.Header.Get("Idempotency-Key") != "same-intent" {
						t.Error("missing idempotency")
					}
					var in accountclient.HandoffSnapshot
					if json.NewDecoder(r.Body).Decode(&in) != nil || in.BalanceMinor != 0 || in.BillingSnapshotVersion != 2 {
						t.Error("zero snapshot lost")
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"owner_transfer": handoffFixture("awaiting_balance_confirmation")})
			}))
			defer upstream.Close()
			st := mustOpenStore(t)
			session, _ := st.CreateSession("platform_admin", actor, actor+"@example.test", "global", "", cloudB, time.Hour)
			s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
			base := "/api/developer/brand-clouds/" + cloudA + "/owner-transfer/" + productA
			for _, tc := range []struct {
				method, path, body string
				status             int
			}{{"GET", base, "", 200}, {"GET", base + "/preview", "", 200}, {"POST", base + "/confirm", `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":0,"currency":"TWD"}`, 202}} {
				r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
				r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Idempotency-Key", "same-intent")
				r.Header.Set("X-Billing-Owner-User-ID", "forged")
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				want := tc.status
				if actor == "outsider" {
					want = 502
				}
				if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("%s: %d %s", tc.path, w.Code, w.Body.String())
				}
			}
			if count != 3 {
				t.Fatal("unexpected membership/profile preflight", count)
			}
			stored, _ := st.GetSession(session.ID)
			if stored.Kind != "platform_admin" || stored.ActiveOrgID != cloudB {
				t.Fatal("mutated global session")
			}
		})
	}
}

func TestOwnerHandoffRejectsInvalidSnapshotBeforeDelivery(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("invalid confirmation reached upstream")
		w.WriteHeader(500)
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	session, _ := st.CreateSession("customer", "source", "source@example.test", "global", "", "", time.Hour)
	s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	for _, body := range []string{`{"ownership_version":1,"billing_snapshot_version":2,"currency":"TWD"}`, `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":-1,"currency":"TWD"}`, `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":null,"currency":"TWD"}`, `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":0,"balance_minor":1,"currency":"TWD"}`, `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":0,"currency":"USD"}`, `{"ownership_version":1,"billing_snapshot_version":2,"balance_minor":0,"currency":"TWD","actor":"target"}`} {
		r := httptest.NewRequest("POST", "/api/developer/brand-clouds/"+cloudA+"/owner-transfer/"+productA+"/confirm", strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "key")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("invalid body %s: %d", body, w.Code)
		}
	}
}

func TestOwnerHandoffLifecycleWritesPreserveGlobalActorAndIntent(t *testing.T) {
	base := "/api/developer/brand-clouds/" + cloudA + "/owner-transfer"
	for _, tc := range []struct {
		name, actor, path, body, phase string
		status                         int
	}{
		{"request", "source", base, `{"target_email":" target@example.test "}`, "awaiting_acceptance", 202},
		{"accept", "target", "/api/developer/brand-cloud-owner-transfers/accept", `{"token":"fixture-invitation"}`, "preparing", 202},
		{"cancel", "source", base + "/" + productA + "/cancel", `{}`, "blocked", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.URL.Path != "/v1"+strings.TrimPrefix(tc.path, "/api") || r.Header.Get("Authorization") != "Bearer global-"+tc.actor || r.Header.Get("Idempotency-Key") != "random-stable-intent" {
					t.Error("changed write target, actor or intent")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				switch tc.name {
				case "request":
					if len(body) != 1 || body["target_email"] != "target@example.test" {
						t.Error("incorrect invitee")
					}
				case "accept":
					if len(body) != 1 || body["token"] != "fixture-invitation" {
						t.Error("incorrect invitation")
					}
				case "cancel":
					if len(body) != 0 {
						t.Error("unexpected cancellation input")
					}
				}
				v := accountclient.OwnerHandoff{ID: productA, CloudID: cloudA, SourceUserID: "source", RequestedByUserID: "source", TargetUserID: "target", Status: "accepted", Phase: tc.phase, Blockers: []accountclient.CloudBlocker{}}
				if tc.name == "request" {
					v.Status = "pending"
				}
				if tc.name == "cancel" {
					v.OperationPhase = "canceling"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"owner_transfer": v})
			}))
			defer upstream.Close()
			st := mustOpenStore(t)
			session, err := st.CreateSession("account", tc.actor, tc.actor+"@example.test", "global-"+tc.actor, "", "", time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			s := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
			for attempt := 0; attempt < 2; attempt++ {
				r := httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
				r.AddCookie(&http.Cookie{Name: "rtk_admin_session", Value: session.ID})
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Idempotency-Key", "random-stable-intent")
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("%d %s", w.Code, w.Body.String())
				}
				if tc.name == "cancel" && !strings.Contains(w.Body.String(), `"operation_phase":"canceling"`) {
					t.Fatal("optimistic cancellation")
				}
			}
			if calls != 2 {
				t.Fatalf("unexpected preflight or duplicate delivery: %d", calls)
			}
		})
	}
}
