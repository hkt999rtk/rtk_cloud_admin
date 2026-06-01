package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/config"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestServerEmitsStructuredRequestLogAndRedactsSensitiveValues(t *testing.T) {
	var out bytes.Buffer
	logger := testJSONLogger(&out)
	srv := NewWithOptions(mustOpenStore(t), Options{Config: config.Config{}, Logger: logger})

	req := httptest.NewRequest(http.MethodGet, "/healthz?access_token=raw-token&state=ok", strings.NewReader("password=secret"))
	req.Header.Set("Authorization", "Bearer raw-token")
	req.Header.Set("Cookie", "rtk_admin_session=raw-cookie")
	req.Header.Set("X-Request-Id", "req-123")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	event := decodeLogLine(t, out.Bytes())
	if event["msg"] != "http request" {
		t.Fatalf("msg = %v, want http request", event["msg"])
	}
	if event["request_id"] != "req-123" {
		t.Fatalf("request_id = %v, want req-123", event["request_id"])
	}
	if event["path"] != "/healthz?access_token=[REDACTED]&state=ok" {
		t.Fatalf("path = %v", event["path"])
	}
	raw := out.String()
	for _, secret := range []string{"raw-token", "raw-cookie", "password=secret"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("log leaked secret %q in %s", secret, raw)
		}
	}
}

func TestServerGeneratesRequestID(t *testing.T) {
	var out bytes.Buffer
	srv := NewWithOptions(mustOpenStore(t), Options{Logger: testJSONLogger(&out)})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Header().Get("X-Request-Id") == "" {
		t.Fatalf("response missing X-Request-Id")
	}
	event := decodeLogLine(t, out.Bytes())
	if event["request_id"] == "" {
		t.Fatalf("log missing generated request_id: %v", event)
	}
}

func TestUpstreamErrorLogDoesNotLeakResponseBody(t *testing.T) {
	var out bytes.Buffer
	srv := NewWithOptions(mustOpenStore(t), Options{Logger: testJSONLogger(&out)})
	rec := httptest.NewRecorder()
	srv.writeCustomerError(rec, &accountclient.HTTPError{
		Method:     http.MethodGet,
		Path:       "/v1/me",
		StatusCode: http.StatusUnauthorized,
		Body:       `{"access_token":"raw-token","password":"secret"}`,
	})

	raw := out.String()
	if !strings.Contains(raw, `"msg":"upstream request failed"`) {
		t.Fatalf("missing upstream failure log: %s", raw)
	}
	for _, secret := range []string{"raw-token", "password", "secret"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("upstream log leaked %q in %s", secret, raw)
		}
	}
}

func testJSONLogger(out *bytes.Buffer) *zap.Logger {
	encoderCfg := zap.NewProductionEncoderConfig()
	core := zapcore.NewCore(zapcore.NewJSONEncoder(encoderCfg), zapcore.AddSync(out), zapcore.DebugLevel)
	return zap.New(core)
}

func decodeLogLine(t *testing.T, data []byte) map[string]any {
	t.Helper()
	lines := bytes.Split(bytes.TrimSpace(data), []byte("\n"))
	if len(lines) == 0 || len(lines[0]) == 0 {
		t.Fatalf("no log output")
	}
	var event map[string]any
	if err := json.Unmarshal(lines[0], &event); err != nil {
		t.Fatalf("decode log line %q: %v", lines[0], err)
	}
	return event
}
