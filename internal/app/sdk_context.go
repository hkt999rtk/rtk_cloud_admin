package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
)

// Page context deliberately excludes catalogs: a slow catalog must not gate
// authentication or the independent device tools and chipset section.
func (s *Server) apiSDKContext(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	listPage := r.URL.Path == "/api/developer/console/clouds-context"
	docsPage := r.URL.Path == "/api/developer/console/context"
	session, ok := s.requestSession(r)
	if !ok {
		http.Error(w, "authentication required", 401)
		return
	}
	if session.Kind != "customer" && !(listPage && session.Kind == "platform_admin") {
		http.Error(w, "developer access required", 403)
		return
	}
	q := r.URL.Query()
	if listPage {
		if _, err := managedCloudQuery(q); err != nil {
			http.Error(w, "invalid cloud list query", 400)
			return
		}
	} else {
		for key, values := range q {
			if key != "cloudId" || len(values) != 1 || !managedCloudUUID.MatchString(values[0]) {
				http.Error(w, "invalid cloud ID", 400)
				return
			}
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	profile, tokens, err := s.resolveCustomerProfile(ctx, accountclient.Tokens{AccessToken: session.AccessToken, RefreshToken: session.RefreshToken})
	if err != nil {
		if errors.Is(err, errCustomerSessionInvalid) {
			s.invalidateCustomerSession(w, session.ID)
		}
		s.writeCustomerError(w, err)
		return
	}
	if tokens.AccessToken != session.AccessToken || tokens.RefreshToken != session.RefreshToken {
		if err := s.sessions.UpdateSessionTokens(session.ID, tokens.AccessToken, tokens.RefreshToken, tokenTTL(tokens)); err != nil {
			http.Error(w, "session update unavailable", 503)
			return
		}
	}
	me := s.meAuthSettings(contracts.Me{UserID: profile.User.ID, Email: profile.User.Email, Name: fallback(profile.User.Name, profile.User.Email), Kind: "customer", Authenticated: true, Memberships: []contracts.Membership{}, PlatformCapabilities: profile.EffectivePlatformCapabilities(), UpstreamAccountManager: true})
	cloudID := q.Get("cloudId")
	for _, org := range profile.Memberships() {
		me.Memberships = append(me.Memberships, membershipFromOrganization(org))
		if cloudID == "" && org.ID == session.ActiveOrgID {
			cloudID = org.ID
		}
	}
	if cloudID == "" && len(me.Memberships) > 0 {
		cloudID = me.Memberships[0].OrganizationID
	}
	if listPage {
		// Preserve the platform-view explanation without querying developer data.
		if session.Kind == "platform_admin" {
			me.Kind = session.Kind
			writeJSON(w, map[string]any{"me": me, "page": nil})
			return
		}
		page, err := s.accountClient.ManagedClouds(ctx, tokens.AccessToken, q)
		if err != nil {
			s.managedCloudError(w, session.ID, err)
			return
		}
		writeJSON(w, map[string]any{"me": me, "page": page})
		return
	}
	type selectedResult struct {
		cloud *accountclient.ManagedCloud
		err   error
	}
	type listResult struct {
		clouds []accountclient.ManagedCloud
		err    error
	}
	selected := make(chan selectedResult, 1)
	listed := make(chan listResult, 1)
	if cloudID == "" {
		selected <- selectedResult{}
	} else {
		go func() {
			out, err := s.accountClient.ManagedCloudCommand(ctx, tokens.AccessToken, http.MethodGet, cloudID, "", "", nil)
			selected <- selectedResult{out.BrandCloud, err}
		}()
	}
	listCtx, listCancel := context.WithTimeout(ctx, time.Second)
	defer listCancel()
	if docsPage {
		// Fresh account memberships already supply the Docs Cloud switcher;
		// quota/pagination from the cloud-list API are not used on this page.
		listed <- listResult{clouds: []accountclient.ManagedCloud{}}
	} else {
		go func() {
			out, err := s.accountClient.ManagedClouds(listCtx, tokens.AccessToken, url.Values{})
			listed <- listResult{out.BrandClouds, err}
		}()
	}
	var cloud *accountclient.ManagedCloud
	select {
	case out := <-selected:
		if out.err != nil {
			s.managedCloudError(w, session.ID, out.err)
			return
		}
		cloud = out.cloud
		if cloudID != "" && (cloud == nil || cloud.ID != cloudID) {
			http.Error(w, "cloud context unavailable", 502)
			return
		}
	case <-ctx.Done():
		http.Error(w, "cloud context timed out", 504)
		return
	}
	clouds := []accountclient.ManagedCloud{}
	listStatus := "not_requested"
	if !docsPage {
		listStatus = "unavailable"
		select {
		case out := <-listed:
			if out.err == nil {
				clouds = out.clouds
				listStatus = "available"
			} else if status, ok := customerUpstreamStatus(out.err); ok && (status == 401 || status == 403) {
				s.managedCloudError(w, session.ID, out.err)
				return
			}
		case <-listCtx.Done():
		}
	}
	if ctx.Err() != nil {
		http.Error(w, "cloud context timed out", 504)
		return
	}
	if cloud != nil {
		me.ActiveOrgID = cloud.ID
		me.Capabilities = cloud.Capabilities
	}
	writeJSON(w, map[string]any{"me": me, "brand_cloud": cloud, "brand_clouds": clouds, "cloud_list_status": listStatus})
}
