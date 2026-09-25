package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
)

func (s *Server) apiAdminOwnerTransferLimit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return
	}
	cloudID := r.PathValue("brandCloudId")
	if !managedCloudUUID.MatchString(cloudID) || len(r.URL.Query()) != 0 {
		http.Error(w, "invalid cloud ID", http.StatusBadRequest)
		return
	}
	var quota accountclient.OwnerTransferQuota
	var err error
	if r.Method == http.MethodGet {
		quota, err = s.accountClient.OwnerTransferQuota(r.Context(), session.AccessToken, cloudID)
	} else {
		if !managedCloudSameOrigin(r) {
			http.Error(w, "same-origin request required", http.StatusForbidden)
			return
		}
		var in struct {
			Limit *int `json:"owner_transfer_limit"`
		}
		if decodeStrictManagedJSON(w, r, &in) != nil || in.Limit == nil || *in.Limit < 0 || *in.Limit > 200 {
			http.Error(w, "owner_transfer_limit must be 0..200", http.StatusBadRequest)
			return
		}
		quota, err = s.accountClient.SetOwnerTransferLimit(r.Context(), session.AccessToken, cloudID, *in.Limit)
	}
	if err != nil {
		var remote *accountclient.HTTPError
		if errors.As(err, &remote) {
			if remote.StatusCode == http.StatusUnauthorized {
				s.invalidateCustomerSession(w, session.ID)
			}
			if remote.StatusCode == 400 || remote.StatusCode == 401 || remote.StatusCode == 403 || remote.StatusCode == 404 || remote.StatusCode == 409 {
				writeJSONStatus(w, remote.StatusCode, map[string]string{"code": "owner_transfer_limit_request_failed"})
				return
			}
		}
		s.writeUpstreamReadErrorForSession(w, session.ID, err)
		return
	}
	if r.Method == http.MethodPatch {
		s.auditPlatformBrandCloudAction(r, session, "platform.brand_cloud.owner_transfer_limit.update", cloudID, "", "accepted")
	}
	writeJSON(w, quota)
}

func ownerTransferLimitError(err error) bool {
	var remote *accountclient.HTTPError
	if !errors.As(err, &remote) || remote.StatusCode != http.StatusConflict {
		return false
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	return json.Unmarshal([]byte(strings.TrimSpace(remote.Body)), &body) == nil && body.Error.Code == "owner_transfer_limit_reached"
}
