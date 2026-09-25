package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPILocalizationKeepsEnglishAndUserCopy(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.AddCookie(&http.Cookie{Name: "rtk-console-locale", Value: "zh-TW"})
	locale := preferredAPILocale(req)
	if locale != "zh-TW" {
		t.Fatalf("locale = %q", locale)
	}
	w := httptest.NewRecorder()
	w.Header().Set("Content-Language", locale)
	message := "The device query service is not configured."
	telemetryReason := "Video Cloud telemetry source is not configured."
	registryDetail := "Device exists in the registry projection."
	userDescription := "The device query service is not configured."
	if err := writeLocalizedJSON(w, map[string]any{
		"source_message":     message,
		"unavailable_reason": telemetryReason,
		"source_facts":       []any{map[string]any{"detail": registryDetail}},
		"item":               map[string]any{"description": userDescription},
	}); err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["source_message"] != message || body["source_message_localized"] == nil {
		t.Fatalf("system message was not kept and localized: %#v", body)
	}
	if body["unavailable_reason"] != telemetryReason || body["unavailable_reason_localized"] != "尚未設定 Video Cloud 遙測來源。" {
		t.Fatalf("telemetry reason was not kept and localized: %#v", body)
	}
	fact := body["source_facts"].([]any)[0].(map[string]any)
	if fact["detail"] != registryDetail || fact["detail_localized"] != "裝置已記錄於帳戶資料中。" {
		t.Fatalf("registry fact was not kept and localized: %#v", fact)
	}
	item := body["item"].(map[string]any)
	if item["description"] != userDescription {
		t.Fatalf("user copy changed: %#v", item)
	}
	if _, exists := item["description_localized"]; exists {
		t.Fatalf("user copy was translated: %#v", item)
	}
	service := map[string]any{"description": "Live media sent through the cloud relay."}
	addLocalizedFields(service, localizedAPICopy[locale].System, localizedAPICopy[locale].Service)
	if service["description_localized"] == nil || service["description"] != "Live media sent through the cloud relay." {
		t.Fatalf("service description was not kept and localized: %#v", service)
	}
}

func TestAPILocalizationAcceptsLanguageHeader(t *testing.T) {
	for _, tc := range []struct{ language, want string }{
		{"zh-Hant-TW,zh;q=0.9", "zh-TW"},
		{"zh-CN,zh;q=0.9", "zh-CN"},
		{"en-US,en;q=0.9", "en"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
		req.Header.Set("Accept-Language", tc.language)
		if got := preferredAPILocale(req); got != tc.want {
			t.Errorf("%q: got %q, want %q", tc.language, got, tc.want)
		}
	}
}
