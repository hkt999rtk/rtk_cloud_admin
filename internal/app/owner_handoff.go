package app

import (
	"context"
	"net/http"
	"strings"
	"time"
)

func (s *Server) apiOwnerHandoff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "customer" && session.Kind != "platform_admin" && session.Kind != "account") {
		http.Error(w, "global account authentication required", 401)
		return
	}
	cloud, transfer := r.PathValue("brandCloudID"), r.PathValue("transferID")
	accept := r.URL.Path == "/api/developer/brand-cloud-owner-transfers/accept"
	confirm := strings.HasSuffix(r.URL.Path, "/confirm")
	key := ""
	if r.Method == http.MethodPost {
		if !managedCloudSameOrigin(r) {
			http.Error(w, "same-origin request required", 403)
			return
		}
		key = r.Header.Get("Idempotency-Key")
		if key == "" {
			http.Error(w, "Idempotency-Key required", 428)
			return
		}
		if len(r.Header.Values("Idempotency-Key")) != 1 || len(key) > 128 || strings.IndexFunc(key, func(c rune) bool { return c < 33 || c > 126 }) >= 0 {
			http.Error(w, "invalid Idempotency-Key", 400)
			return
		}
	}
	if (!accept && !managedCloudUUID.MatchString(cloud)) || (transfer != "" && !managedCloudUUID.MatchString(transfer)) || len(r.URL.Query()) != 0 {
		http.Error(w, "invalid handoff scope", 400)
		return
	}
	var body any
	if r.Method == http.MethodPost {
		switch {
		case accept:
			var in struct {
				Token string `json:"token"`
			}
			if decodeStrictManagedJSON(w, r, &in) != nil || strings.TrimSpace(in.Token) == "" {
				http.Error(w, "token required", 400)
				return
			}
			body = in
		case confirm:
			var in struct {
				OwnershipVersion       int64  `json:"ownership_version"`
				BillingSnapshotVersion int64  `json:"billing_snapshot_version"`
				BalanceMinor           *int64 `json:"balance_minor"`
				Currency               string `json:"currency"`
			}
			if decodeStrictManagedJSON(w, r, &in) != nil || in.OwnershipVersion < 1 || in.BillingSnapshotVersion < 2 || in.BalanceMinor == nil || *in.BalanceMinor < 0 || in.Currency != "TWD" {
				http.Error(w, "exact nonnegative settled snapshot required", 400)
				return
			}
			body = in
		case transfer == "":
			var in struct {
				TargetEmail string `json:"target_email"`
			}
			if decodeStrictManagedJSON(w, r, &in) != nil || strings.TrimSpace(in.TargetEmail) == "" {
				http.Error(w, "target_email required", 400)
				return
			}
			in.TargetEmail = strings.TrimSpace(in.TargetEmail)
			body = in
		default:
			var in struct{}
			if decodeStrictManagedJSON(w, r, &in) != nil {
				http.Error(w, "empty JSON object required", 400)
				return
			}
			body = in
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	path := "/v1" + strings.TrimPrefix(r.URL.Path, "/api")
	view, err := s.accountClient.OwnerHandoff(ctx, session.AccessToken, session.Subject, r.Method, path, cloud, transfer, key, body)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return
	}
	if strings.HasSuffix(path, "/preview") && view.Phase != "awaiting_balance_confirmation" {
		http.Error(w, "settlement not ready", 409)
		return
	}
	status := 200
	if r.Method == http.MethodPost && (accept || confirm || transfer == "") {
		status = 202
	}
	writeJSONStatus(w, status, map[string]any{"owner_transfer": view})
}
