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
	userDescription := "The device query service is not configured."
	if err := writeLocalizedJSON(w, map[string]any{
		"source_message": message,
		"item":           map[string]any{"description": userDescription},
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
