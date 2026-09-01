package app

import (
	"encoding/json"
	"net/http"
	"reflect"
	"rtk_cloud_admin/internal/accountclient"
	"strings"
)

// Called under managedCloudFixture.mu. No mail, external account or database.
func serveCloudSharingFixture(f *managedCloudFixture, w http.ResponseWriter, r *http.Request, cloud string) bool {
	base := "/v1/developer/brand-clouds/" + cloud + "/members"
	if !strings.HasPrefix(r.URL.Path, base) {
		return false
	}
	send := func(status int, body any) { w.WriteHeader(status); _ = json.NewEncoder(w).Encode(body) }
	if cloud != cloudA {
		send(403, map[string]string{"error": "owner only"})
		return true
	}
	if r.URL.Path == base && r.Method == "GET" {
		members := []accountclient.Member{{OrganizationID: cloudA, UserID: "owner-1", Email: "demo@example.test", Role: "owner"}}
		for _, member := range f.sharingMembers {
			members = append(members, member)
		}
		send(200, map[string]any{"members": members, "pagination": accountclient.Pagination{Limit: 25, Total: len(members)}})
		return true
	}
	if r.URL.Path == base+"/invitations" {
		if r.Method == "GET" {
			rows := []accountclient.BrandCloudMemberInvitation{}
			for _, i := range f.sharingInvites {
				rows = append(rows, i)
			}
			send(200, map[string]any{"invitations": rows})
			return true
		}
		var in accountclient.CloudSharingWrite
		_ = json.NewDecoder(r.Body).Decode(&in)
		for _, existing := range f.sharingInvites {
			if existing.Status == "pending" {
				if existing.Role != in.Role || !reflect.DeepEqual(existing.AccessScope, in.AccessScope) || existing.TargetEmail != in.Email {
					send(409, map[string]string{"error": "scope conflict"})
					return true
				}
				send(202, map[string]any{"invitation": existing})
				return true
			}
		}
		i := accountclient.BrandCloudMemberInvitation{ID: "55555555-5555-4555-8555-555555555555", BrandCloudID: cloud, TargetUserID: "66666666-6666-4666-8666-666666666666", TargetEmail: in.Email, Role: in.Role, AccessScope: in.AccessScope, Status: "pending", ExpiresAt: "2026-08-31T23:59:00Z"}
		f.sharingInvites[i.ID] = i
		send(202, map[string]any{"invitation": i})
		return true
	}
	if strings.HasPrefix(r.URL.Path, base+"/invitations/") {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, base+"/invitations/"), "/")
		if len(parts) != 2 {
			send(404, map[string]string{})
			return true
		}
		i, ok := f.sharingInvites[parts[0]]
		if !ok {
			send(404, map[string]string{})
			return true
		}
		if parts[1] == "cancel" {
			i.Status = "canceled"
			f.sharingInvites[i.ID] = i
		}
		send(200, map[string]any{"invitation": i})
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, base+"/"), "/")
	m, ok := f.sharingMembers[parts[0]]
	if !ok {
		send(404, map[string]string{})
		return true
	}
	if r.Method == "DELETE" {
		delete(f.sharingMembers, m.UserID)
		w.WriteHeader(204)
		return true
	}
	if len(parts) > 1 {
		if parts[1] == "disable" {
			m.DisabledAt = "2026-08-31T10:00:00Z"
		} else {
			m.DisabledAt = ""
		}
	} else {
		var in accountclient.CloudSharingWrite
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in.Role != "" {
			m.Role = in.Role
		}
		if in.AccessScope != nil {
			m.AccessScope = in.AccessScope
		}
	}
	f.sharingMembers[m.UserID] = m
	send(200, map[string]any{"member": m})
	return true
}
