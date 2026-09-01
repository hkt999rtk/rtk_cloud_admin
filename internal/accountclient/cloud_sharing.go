package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
)

type CloudAccessScope struct {
	Kind       string   `json:"kind"`
	ProductIDs []string `json:"product_ids,omitempty"`
}

type CloudSharingWrite struct {
	Email       string            `json:"email,omitempty"`
	Role        string            `json:"role,omitempty"`
	AccessScope *CloudAccessScope `json:"access_scope,omitempty"`
	Token       string            `json:"token,omitempty"`
}

type CloudSharingResult struct {
	Members     []Member                     `json:"members,omitempty"`
	Pagination  Pagination                   `json:"pagination"`
	Invitations []BrandCloudMemberInvitation `json:"invitations,omitempty"`
	Member      *Member                      `json:"member,omitempty"`
	Invitation  *BrandCloudMemberInvitation  `json:"invitation,omitempty"`
}

// Path is constructed only by the fixed, UUID-validated sharing BFF routes.
func (c *Client) CloudSharing(ctx context.Context, token, method, path, cloudID, targetID, key string, in *CloudSharingWrite) (CloudSharingResult, error) {
	var out CloudSharingResult
	var body any
	if in != nil {
		body = in
	}
	var result any = &out
	if method == http.MethodDelete {
		result = nil
	}
	if err := c.doJSONWithIdempotency(ctx, method, path, token, key, body, result); err != nil {
		return out, err
	}
	if method == http.MethodDelete {
		return out, nil
	}
	validScope := func(role string, scope *CloudAccessScope) bool {
		if role != "viewer" {
			return role == "owner" || role == "admin" || role == "member"
		}
		if scope == nil {
			return false
		}
		if scope.Kind == "all_products" {
			return len(scope.ProductIDs) == 0
		}
		if scope.Kind != "selected_products" || len(scope.ProductIDs) == 0 {
			return false
		}
		for _, id := range scope.ProductIDs {
			if !managedOperationID.MatchString(id) {
				return false
			}
		}
		return true
	}
	validMember := func(m Member) bool {
		return m.UserID != "" && (cloudID == "" || m.OrganizationID == cloudID) && validScope(m.Role, m.AccessScope)
	}
	validInvite := func(i BrandCloudMemberInvitation) bool {
		return i.ID != "" && i.Role != "owner" && (cloudID == "" || i.BrandCloudID == cloudID) && validScope(i.Role, i.AccessScope)
	}
	switch {
	case strings.Contains(path, "/invitations") && method == http.MethodGet:
		if out.Invitations == nil {
			return out, fmt.Errorf("missing invitations")
		}
		for _, i := range out.Invitations {
			if !validInvite(i) {
				return out, fmt.Errorf("invalid invitation scope")
			}
		}
	case strings.HasSuffix(strings.Split(path, "?")[0], "/members") && method == http.MethodGet:
		if out.Members == nil {
			return out, fmt.Errorf("missing members")
		}
		for _, m := range out.Members {
			if !validMember(m) {
				return out, fmt.Errorf("invalid member scope")
			}
		}
	case strings.Contains(path, "invitations"):
		if out.Invitation == nil || !validInvite(*out.Invitation) || (targetID != "" && out.Invitation.ID != targetID) {
			return out, fmt.Errorf("invalid invitation scope")
		}
		if cloudID == "" && (out.Member == nil || !validMember(*out.Member) || out.Member.OrganizationID != out.Invitation.BrandCloudID || out.Member.UserID != out.Invitation.TargetUserID || out.Member.Role != out.Invitation.Role || !reflect.DeepEqual(out.Member.AccessScope, out.Invitation.AccessScope)) {
			return out, fmt.Errorf("invalid accepted membership")
		}
	default:
		if out.Member == nil || !validMember(*out.Member) || out.Member.UserID != targetID {
			return out, fmt.Errorf("invalid member scope")
		}
	}
	if in != nil {
		role, scope := "", (*CloudAccessScope)(nil)
		if out.Invitation != nil {
			role, scope = out.Invitation.Role, out.Invitation.AccessScope
		} else if out.Member != nil {
			role, scope = out.Member.Role, out.Member.AccessScope
		}
		if in.Role != "" && role != in.Role {
			return out, fmt.Errorf("sharing role response differs from request")
		}
		if in.AccessScope != nil && !reflect.DeepEqual(in.AccessScope, scope) {
			return out, fmt.Errorf("sharing scope response differs from request")
		}
		if in.Email != "" && (out.Invitation == nil || !strings.EqualFold(strings.TrimSpace(in.Email), out.Invitation.TargetEmail)) {
			return out, fmt.Errorf("sharing target response differs from request")
		}
	}
	return out, nil
}
