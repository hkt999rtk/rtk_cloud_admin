package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rtk_cloud_admin/internal/config"
)

func sdkCatalogBody() map[string]any {
	packages := make([]map[string]any, 0, 5)
	for _, slug := range []string{"native", "android", "javascript", "ios", "freertos-pro2"} {
		packages = append(packages, map[string]any{"slug": slug, "title": slug, "description": slug + " SDK", "filename": slug + ".tgz", "sha256": strings.Repeat("a", 64), "size_bytes": 1024, "validation_status": "PASS", "capabilities": []string{"WebRTC signaling"}, "limitations": []string{"No media runtime"}})
	}
	return map[string]any{"schema": "rtk-portal-sdk-public-catalog/v1", "version": "0.1.0-rc1", "release_train": "rtk-cloud-client-0.1.0-rc1", "created_at": "2026-09-03T00:00:00Z", "distribution": "public-evaluation", "signing_status": "not_configured", "terms_version": "evaluation-2026-09", "packages": packages, "complete_bundle": map[string]any{"slug": "all", "title": "Complete SDK Bundle", "description": "All packages", "filename": "all.tgz", "sha256": strings.Repeat("b", 64), "size_bytes": 4096, "validation_status": "PASS", "capabilities": []string{"All packages"}, "limitations": []string{"No media runtime"}}}
}

func TestDeveloperSDKCatalogBFFRequiresSessionAndProjectsPortalCatalog(t *testing.T) {
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sdk/catalog" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(sdkCatalogBody())
	}))
	defer portal.Close()
	srv := newSeededTestServer(t, config.Config{SDKPortalBaseURL: portal.URL, Environment: "local"})
	request := httptest.NewRequest(http.MethodGet, "/api/developer/sdk-releases/latest", nil)
	got := httptest.NewRecorder()
	srv.ServeHTTP(got, request)
	if got.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", got.Code)
	}
	session, err := srv.sessions.CreateSession("customer", "owner-1", "owner@example.com", "owner-token", "refresh", "org-acme", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	response := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/sdk-releases/latest", nil, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%q", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["source_status"] != "available" || body["portal_url"] != portal.URL+"/manual/sdk" || body["local_preview"] != true {
		t.Fatalf("body = %#v", body)
	}
	for _, forbidden := range []string{"object_key", "presigned", "credential"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("BFF leaked %q: %s", forbidden, response.Body.String())
		}
	}
}

func TestDeveloperSDKCatalogBFFFailsClosed(t *testing.T) {
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "private object sdk/releases/secret", http.StatusServiceUnavailable)
	}))
	defer portal.Close()
	for _, cfg := range []config.Config{{}, {SDKPortalBaseURL: "https://portal.example/path"}, {SDKPortalBaseURL: portal.URL}} {
		srv := newSeededTestServer(t, cfg)
		session, err := srv.sessions.CreateSession("customer", "owner-1", "owner@example.com", "owner-token", "refresh", "org-acme", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		response := authenticatedRequest(srv, session.ID, http.MethodGet, "/api/developer/sdk-releases/latest", nil, nil)
		if response.Code != http.StatusServiceUnavailable && response.Code != http.StatusBadGateway {
			t.Fatalf("status = %d body=%q", response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "sdk/releases/secret") {
			t.Fatalf("BFF leaked upstream detail: %s", response.Body.String())
		}
	}
}
