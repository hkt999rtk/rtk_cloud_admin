package billingclient

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

type ownerContextKey struct{}
type ownerContext struct {
	cloud, user string
	version     int64
}

var ownerUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// WithOwnership binds live Account Manager evidence to one request. Never copy
// an incoming browser header into this context or mutate the shared Client.
func WithOwnership(ctx context.Context, cloud, user string, version int64) (context.Context, error) {
	if !ownerUUID.MatchString(cloud) || !ownerUUID.MatchString(user) || version < 1 {
		return nil, fmt.Errorf("invalid billing ownership evidence")
	}
	return context.WithValue(ctx, ownerContextKey{}, ownerContext{cloud, user, version}), nil
}

func ownershipHeaders(req *http.Request, actor string) error {
	scope, ok := req.Context().Value(ownerContextKey{}).(ownerContext)
	if !ok || actor != scope.user || !strings.HasPrefix(req.URL.Path, "/v1/orgs/"+scope.cloud+"/") {
		return fmt.Errorf("missing or mismatched billing ownership scope")
	}
	req.Header.Set("X-Billing-Ownership-Version", strconv.FormatInt(scope.version, 10))
	return nil
}
