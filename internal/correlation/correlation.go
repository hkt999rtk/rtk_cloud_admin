package correlation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const (
	HeaderRequestID   = "X-Request-Id"
	HeaderTraceID     = "X-Trace-Id"
	HeaderOperationID = "X-Operation-Id"
)

type Values struct {
	RequestID   string
	TraceID     string
	OperationID string
}

type contextKey struct{}

func FromRequest(r *http.Request) Values {
	requestID := firstNonEmpty(r.Header.Get(HeaderRequestID), newID())
	traceID := firstNonEmpty(r.Header.Get(HeaderTraceID), requestID)
	return Values{
		RequestID:   requestID,
		TraceID:     traceID,
		OperationID: strings.TrimSpace(r.Header.Get(HeaderOperationID)),
	}
}

func With(ctx context.Context, values Values) context.Context {
	return context.WithValue(ctx, contextKey{}, values)
}

func FromContext(ctx context.Context) Values {
	values, _ := ctx.Value(contextKey{}).(Values)
	return values
}

func ApplyHeaders(ctx context.Context, req *http.Request) {
	values := FromContext(ctx)
	if values.RequestID != "" {
		req.Header.Set(HeaderRequestID, values.RequestID)
	}
	if values.TraceID != "" {
		req.Header.Set(HeaderTraceID, values.TraceID)
	}
	if values.OperationID != "" {
		req.Header.Set(HeaderOperationID, values.OperationID)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func newID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "req-unknown"
	}
	return "req-" + hex.EncodeToString(buf[:])
}
