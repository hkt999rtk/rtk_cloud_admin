package app

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"rtk_cloud_admin/internal/accountclient"
	"strings"
	"sync"
	"testing"
	"time"
)

// Two independently authenticated disposable browser origins. This models only
// UI protocol states, never actual billing, ownership writes or email delivery.
func TestOwnerHandoffBrowserFixture(t *testing.T) {
	if os.Getenv("OWNER_HANDOFF_UI_FIXTURE") != "1" {
		t.Skip("opt-in local browser fixture")
	}
	t.Chdir("../..")
	var mu sync.Mutex
	v := handoffFixture("preparing")
	v.HasSettledSnapshot = false
	v.BalanceSnapshot = nil
	v.SourceConfirmed = nil
	v.TargetConfirmed = nil
	unavailable := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		actor := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r.URL.Path == "/v1/me" {
			writeJSON(w, map[string]any{"user": map[string]string{"id": actor, "email": actor + "@example.test"}, "brand_cloud_memberships": []any{}})
			return
		}
		if unavailable {
			http.Error(w, "fixture dependency unavailable", 503)
			return
		}
		if actor != "source" && actor != "target" {
			http.Error(w, "forbidden", 403)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/accept") && actor != "target" {
			http.Error(w, "recipient required", 403)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/preview") && v.Phase != "awaiting_balance_confirmation" {
			http.Error(w, "not ready", 409)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/confirm") {
			var snapshot accountclient.HandoffSnapshot
			_ = json.NewDecoder(r.Body).Decode(&snapshot)
			if v.BalanceSnapshot == nil || snapshot != *v.BalanceSnapshot || v.Phase != "awaiting_balance_confirmation" {
				http.Error(w, "stale", 409)
				return
			}
			yes := true
			if actor == "source" {
				v.SourceConfirmed = &yes
			} else {
				v.TargetConfirmed = &yes
			}
			if *v.SourceConfirmed && *v.TargetConfirmed {
				v.Phase = "finalizing"
				v.OperationPhase = "finalizing"
				v.Operation.Phase = "finalizing"
			}
		}
		if strings.HasSuffix(r.URL.Path, "/cancel") {
			if actor != "source" || v.OperationPhase == "finalizing" || v.OperationPhase == "succeeded" {
				http.Error(w, "cannot cancel", 409)
				return
			}
			v.Phase = "blocked"
			v.OperationPhase = "canceling"
			v.Operation.Phase = "canceling"
			v.Blockers = []accountclient.CloudBlocker{{Code: "lifecycle_conflict", Retryable: true}}
		}
		writeJSON(w, map[string]any{"owner_transfer": v})
	}))
	defer upstream.Close()
	st := mustOpenStore(t)
	server := NewWithOptions(st, Options{AccountClient: accountclient.New(upstream.URL)})
	for i, actor := range []string{"source", "target"} {
		session, err := st.CreateSession("customer", actor, actor+"@example.test", actor, "", "", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", 18193+i))
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/__fixture__/state" && r.Method == "POST" {
				var in struct {
					Action string `json:"action"`
					Amount int64  `json:"amount"`
				}
				if json.NewDecoder(r.Body).Decode(&in) != nil {
					http.Error(w, "invalid", 400)
					return
				}
				mu.Lock()
				defer mu.Unlock()
				switch in.Action {
				case "settle":
					if in.Amount < 0 {
						v.Phase = "blocked"
						v.Blockers = []accountclient.CloudBlocker{{Code: "balance_negative", BalanceMinor: &in.Amount}}
					} else {
						version := int64(2)
						if v.BalanceSnapshot != nil {
							version = v.BalanceSnapshot.BillingSnapshotVersion + 1
						}
						v = handoffFixture("awaiting_balance_confirmation")
						v.BalanceSnapshot.BillingSnapshotVersion = version
						v.BalanceSnapshot.BalanceMinor = in.Amount
					}
				case "finish":
					if v.Phase != "finalizing" {
						http.Error(w, "not committed", 409)
						return
					}
					v.Phase = "succeeded"
					v.OperationPhase = "succeeded"
					v.Operation.State = "succeeded"
					v.Operation.Phase = "succeeded"
				case "release":
					if v.OperationPhase != "canceling" {
						http.Error(w, "not canceling", 409)
						return
					}
					v.Phase = "canceled"
					v.Status = "canceled"
					v.OperationPhase = "canceled"
					v.Operation.State = "canceled"
					v.Operation.Phase = "canceled"
					v.Blockers = []accountclient.CloudBlocker{}
				case "unavailable":
					unavailable = true
				case "available":
					unavailable = false
				default:
					http.Error(w, "invalid action", 400)
					return
				}
				w.WriteHeader(204)
				return
			}
			r.Header.Set("Cookie", "rtk_admin_session="+session.ID)
			server.ServeHTTP(w, r)
		})
		go func() { _ = http.Serve(listener, handler) }()
	}
	fmt.Println("Disposable handoff fixture: source localhost:18193, target localhost:18194")
	<-t.Context().Done()
}
