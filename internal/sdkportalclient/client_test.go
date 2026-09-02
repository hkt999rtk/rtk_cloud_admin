package sdkportalclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func validCatalog() Catalog {
	packages := make([]Artifact, 0, 5)
	for _, slug := range []string{"native", "android", "javascript", "ios", "freertos-pro2"} {
		packages = append(packages, Artifact{Slug: slug, Title: slug, Description: slug + " SDK", Filename: slug + ".tgz", SHA256: strings.Repeat("a", 64), SizeBytes: 1024, ValidationStatus: "PASS", Capabilities: []string{"WebRTC signaling"}, Limitations: []string{"No media runtime"}})
	}
	return Catalog{Schema: publicCatalogSchema, Version: "0.1.0-rc1", ReleaseTrain: "rtk-cloud-client-0.1.0-rc1", CreatedAt: "2026-09-03T00:00:00Z", Distribution: "public-evaluation", SigningStatus: "not_configured", TermsVersion: "evaluation-2026-09", Packages: packages, CompleteBundle: Artifact{Slug: "all", Title: "Complete SDK Bundle", Description: "All packages", Filename: "all.tgz", SHA256: strings.Repeat("b", 64), SizeBytes: 4096, ValidationStatus: "PASS", Capabilities: []string{"All packages"}, Limitations: []string{"No media runtime"}}}
}

func TestLatestUsesFixedSafeCatalogEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sdk/catalog" || r.Header.Get("Accept") != "application/json" {
			t.Fatalf("unexpected request: %s Accept=%q", r.URL.Path, r.Header.Get("Accept"))
		}
		_ = json.NewEncoder(w).Encode(validCatalog())
	}))
	defer server.Close()
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := client.Latest(context.Background())
	if err != nil || len(catalog.Packages) != 5 {
		t.Fatalf("Latest = %#v, %v", catalog, err)
	}
	if got := client.ManualURL(); got != server.URL+"/manual/sdk" {
		t.Fatalf("ManualURL = %q", got)
	}
}

func TestNewRejectsNonOriginConfiguration(t *testing.T) {
	for _, value := range []string{"", "ftp://portal.example", "https://user@portal.example", "https://portal.example/path", "https://portal.example?q=1"} {
		if _, err := New(value); err == nil {
			t.Fatalf("New(%q) unexpectedly succeeded", value)
		}
	}
}

func TestLatestFailsClosedForUnsafeOrIncompleteCatalog(t *testing.T) {
	for _, mutate := range []func(*Catalog){
		func(c *Catalog) { c.Packages = c.Packages[:4] },
		func(c *Catalog) { c.Packages[0].SHA256 = "bad" },
		func(c *Catalog) { c.Packages[0].Capabilities = nil },
	} {
		catalog := validCatalog()
		mutate(&catalog)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(catalog) }))
		client, _ := New(server.URL)
		_, err := client.Latest(context.Background())
		server.Close()
		if err == nil {
			t.Fatal("unsafe catalog unexpectedly accepted")
		}
	}
}
