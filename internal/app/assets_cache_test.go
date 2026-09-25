package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDeveloperDocsCatalogHasOneDayHTTPCache(t *testing.T) {
	dir := t.TempDir()
	for _, locale := range []string{"en", "zh-TW", "zh-CN"} {
		asset := filepath.Join(dir, "web", "dist", "assets", "developer-docs", "index."+locale+".json")
		if err := os.MkdirAll(filepath.Dir(asset), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(asset, []byte(`{"pages":[]}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Chdir(dir)

	for _, locale := range []string{"en", "zh-TW", "zh-CN"} {
		url := "/assets/developer-docs/index." + locale + ".json?v=revision"
		request := httptest.NewRequest(http.MethodGet, url, nil)
		response := httptest.NewRecorder()
		(&Server{}).assets(response, request)
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, max-age=86400, must-revalidate" {
			t.Fatalf("%s status/cache = %d/%q", locale, response.Code, response.Header().Get("Cache-Control"))
		}
		request = httptest.NewRequest(http.MethodGet, url, nil)
		request.Header.Set("If-Modified-Since", response.Header().Get("Last-Modified"))
		validated := httptest.NewRecorder()
		(&Server{}).assets(validated, request)
		if validated.Code != http.StatusNotModified {
			t.Fatalf("%s conditional status = %d, want 304", locale, validated.Code)
		}
	}
}
