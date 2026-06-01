package correlation

import (
	"context"
	"net/http"
	"testing"
)

func TestFromRequestPreservesCorrelationHeaders(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.test/devices", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(HeaderRequestID, " req-123 ")
	req.Header.Set(HeaderTraceID, " trace-456 ")
	req.Header.Set(HeaderOperationID, " op-789 ")

	values := FromRequest(req)

	if values.RequestID != "req-123" {
		t.Fatalf("RequestID = %q, want req-123", values.RequestID)
	}
	if values.TraceID != "trace-456" {
		t.Fatalf("TraceID = %q, want trace-456", values.TraceID)
	}
	if values.OperationID != "op-789" {
		t.Fatalf("OperationID = %q, want op-789", values.OperationID)
	}
}

func TestFromRequestGeneratesRequestIDAndDefaultsTraceID(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.test/healthz", nil)
	if err != nil {
		t.Fatal(err)
	}

	values := FromRequest(req)

	if values.RequestID == "" {
		t.Fatalf("RequestID is empty")
	}
	if values.TraceID != values.RequestID {
		t.Fatalf("TraceID = %q, want generated RequestID %q", values.TraceID, values.RequestID)
	}
	if values.OperationID != "" {
		t.Fatalf("OperationID = %q, want empty", values.OperationID)
	}
}

func TestContextRoundTripAndApplyHeaders(t *testing.T) {
	values := Values{
		RequestID:   "req-123",
		TraceID:     "trace-456",
		OperationID: "op-789",
	}
	ctx := With(context.Background(), values)

	if got := FromContext(ctx); got != values {
		t.Fatalf("FromContext = %+v, want %+v", got, values)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://example.test/upstream", nil)
	if err != nil {
		t.Fatal(err)
	}
	ApplyHeaders(ctx, req)

	if got := req.Header.Get(HeaderRequestID); got != values.RequestID {
		t.Fatalf("%s = %q, want %q", HeaderRequestID, got, values.RequestID)
	}
	if got := req.Header.Get(HeaderTraceID); got != values.TraceID {
		t.Fatalf("%s = %q, want %q", HeaderTraceID, got, values.TraceID)
	}
	if got := req.Header.Get(HeaderOperationID); got != values.OperationID {
		t.Fatalf("%s = %q, want %q", HeaderOperationID, got, values.OperationID)
	}
}

func TestApplyHeadersSkipsEmptyValues(t *testing.T) {
	ctx := With(context.Background(), Values{RequestID: "req-123"})
	req, err := http.NewRequest(http.MethodGet, "https://example.test/upstream", nil)
	if err != nil {
		t.Fatal(err)
	}

	ApplyHeaders(ctx, req)

	if got := req.Header.Get(HeaderRequestID); got != "req-123" {
		t.Fatalf("%s = %q, want req-123", HeaderRequestID, got)
	}
	if got := req.Header.Get(HeaderTraceID); got != "" {
		t.Fatalf("%s = %q, want empty", HeaderTraceID, got)
	}
	if got := req.Header.Get(HeaderOperationID); got != "" {
		t.Fatalf("%s = %q, want empty", HeaderOperationID, got)
	}
}

func TestFromContextWithoutValuesReturnsZeroValue(t *testing.T) {
	if got := FromContext(context.Background()); got != (Values{}) {
		t.Fatalf("FromContext = %+v, want zero value", got)
	}
}
