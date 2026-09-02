package app

import (
	"context"
	"net/http"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/store"
)

type explicitBrandCloudScopeKey struct{}

type explicitBrandCloudScope struct {
	cloudID string
	org     accountclient.Organization
	tokens  accountclient.Tokens
}

// withExplicitBrandCloudScope binds a customer request to the cloud carried by
// its URL. It validates the current membership before the feature handler runs
// and never writes the selection back to the shared account session.
func (s *Server) withExplicitBrandCloudScope(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		cloudID := strings.ToLower(strings.TrimSpace(r.PathValue("brandCloudID")))
		if !managedCloudUUID.MatchString(cloudID) {
			http.Error(w, "invalid Brand Cloud ID", http.StatusBadRequest)
			return
		}
		session, ok := s.customerSession(r)
		if !ok {
			http.Error(w, "customer authentication required", http.StatusUnauthorized)
			return
		}
		session.ActiveOrgID = cloudID
		org, tokens, err := s.activeCustomerOrg(r.Context(), session)
		if err != nil {
			s.writeCustomerErrorForSession(w, session.ID, err)
			return
		}
		if org.ID != cloudID {
			http.Error(w, "Brand Cloud membership required", http.StatusForbidden)
			return
		}
		scope := explicitBrandCloudScope{cloudID: cloudID, org: org, tokens: tokens}
		next(w, r.WithContext(context.WithValue(r.Context(), explicitBrandCloudScopeKey{}, scope)))
	}
}

func explicitBrandCloudScopeFromContext(ctx context.Context) (explicitBrandCloudScope, bool) {
	scope, ok := ctx.Value(explicitBrandCloudScopeKey{}).(explicitBrandCloudScope)
	return scope, ok && scope.cloudID != ""
}

func applyExplicitBrandCloudScope(ctx context.Context, session store.Session) store.Session {
	if scope, ok := explicitBrandCloudScopeFromContext(ctx); ok {
		session.ActiveOrgID = scope.cloudID
		if scope.tokens.AccessToken != "" {
			session.AccessToken = scope.tokens.AccessToken
		}
		if scope.tokens.RefreshToken != "" {
			session.RefreshToken = scope.tokens.RefreshToken
		}
	}
	return session
}
