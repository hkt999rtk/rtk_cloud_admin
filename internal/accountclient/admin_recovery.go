package accountclient

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
)

var recoveryPath = regexp.MustCompile(`^(/[0-9a-f-]{36}(/(approve|execute|cancel))?)?$`)

func (c *Client) AdminRecovery(ctx context.Context, token, method, path, key string, body json.RawMessage) (json.RawMessage, error) {
	if !recoveryPath.MatchString(path) || (method != "POST" && method != "GET") {
		return nil, fmt.Errorf("invalid recovery route")
	}
	var in any
	if len(body) > 0 {
		in = body
	}
	_, raw, err := c.pkiRequest(ctx, method, "/v1/platform/admin-recovery"+path, token, key, in)
	if err != nil {
		return nil, err
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("invalid recovery response")
	}
	return json.RawMessage(raw), nil
}
