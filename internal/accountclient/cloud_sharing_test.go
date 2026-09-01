package accountclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCloudSharingRejectsChangedGrantResponse(t *testing.T) {
	const cloud = "11111111-1111-4111-8111-111111111111"
	const product = "22222222-2222-4222-8222-222222222222"
	for _, tc := range []struct {
		name   string
		change func(*BrandCloudMemberInvitation)
	}{
		{"cloud", func(i *BrandCloudMemberInvitation) { i.BrandCloudID = "other" }},
		{"role", func(i *BrandCloudMemberInvitation) { i.Role = "admin" }},
		{"wider scope", func(i *BrandCloudMemberInvitation) { i.AccessScope = &CloudAccessScope{Kind: "all_products"} }},
		{"missing scope", func(i *BrandCloudMemberInvitation) { i.AccessScope = nil }},
		{"different Product", func(i *BrandCloudMemberInvitation) {
			i.AccessScope = &CloudAccessScope{Kind: "selected_products", ProductIDs: []string{cloud}}
		}},
		{"different invitee", func(i *BrandCloudMemberInvitation) { i.TargetEmail = "wrong@example.test" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := CloudSharingWrite{Email: "viewer@example.test", Role: "viewer", AccessScope: &CloudAccessScope{Kind: "selected_products", ProductIDs: []string{product}}}
			inv := BrandCloudMemberInvitation{ID: product, BrandCloudID: cloud, TargetEmail: in.Email, Role: in.Role, AccessScope: in.AccessScope}
			tc.change(&inv)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"invitation": inv})
			}))
			defer upstream.Close()
			_, err := New(upstream.URL).CloudSharing(context.Background(), "global", "POST", "/v1/developer/brand-clouds/"+cloud+"/members/invitations", cloud, "", "key", &in)
			if err == nil {
				t.Fatal("mismatched grant accepted")
			}
		})
	}
}

func TestCloudSharingRejectsCrossCloudMemberReadback(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"members":[{"organization_id":"wrong","user_id":"member","role":"member"}]}`))
	}))
	defer upstream.Close()
	_, err := New(upstream.URL).CloudSharing(context.Background(), "global", "GET", "/v1/developer/brand-clouds/cloud/members", "cloud", "", "", nil)
	if err == nil {
		t.Fatal("cross-cloud member readback accepted")
	}
}
