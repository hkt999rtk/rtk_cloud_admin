package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPutObjectSignsAndUploadsPathStyleObject(t *testing.T) {
	t.Parallel()

	var gotPath, gotBody, gotContentType, gotAuth, gotPayloadHash string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		gotAuth = r.Header.Get("Authorization")
		gotPayloadHash = r.Header.Get("X-Amz-Content-Sha256")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := putObject(server.URL, "release-bucket", "releases/admin/v1.tar.gz", "us-sea", "access", "secret", []byte("bundle"))
	if err != nil {
		t.Fatalf("putObject returned error: %v", err)
	}
	if gotPath != "/release-bucket/releases/admin/v1.tar.gz" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotBody != "bundle" {
		t.Fatalf("body = %q", gotBody)
	}
	if gotContentType != "application/gzip" {
		t.Fatalf("content type = %q", gotContentType)
	}
	if !strings.Contains(gotAuth, "AWS4-HMAC-SHA256 Credential=access/") {
		t.Fatalf("authorization header = %q", gotAuth)
	}
	wantHashBytes := sha256.Sum256([]byte("bundle"))
	if gotPayloadHash != hex.EncodeToString(wantHashBytes[:]) {
		t.Fatalf("payload hash = %q", gotPayloadHash)
	}
}

func TestPutObjectReportsServerError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	}))
	defer server.Close()

	err := putObject(server.URL, "release-bucket", "manifest.json", "us-sea", "access", "secret", []byte("{}"))
	if err == nil || !strings.Contains(err.Error(), "403 Forbidden") {
		t.Fatalf("expected status error, got %v", err)
	}
}

func TestHelpers(t *testing.T) {
	t.Setenv("S3PUT_TEST_VALUE", "  configured  ")

	if got := getenv("S3PUT_TEST_VALUE"); got != "configured" {
		t.Fatalf("getenv trimmed value = %q", got)
	}
	if got := getenvDefault("S3PUT_MISSING", "fallback"); got != "fallback" {
		t.Fatalf("getenvDefault fallback = %q", got)
	}
	if got := contentType("manifest.json"); got != "application/json" {
		t.Fatalf("json content type = %q", got)
	}
	if got := contentType("bundle.tar.gz.sha256"); got != "text/plain" {
		t.Fatalf("checksum content type = %q", got)
	}
	if got := uriEncodePath("/bucket/key with spaces.json"); got != "/bucket/key%20with%20spaces.json" {
		t.Fatalf("encoded path = %q", got)
	}

	headers := http.Header{}
	headers.Set("X-Amz-Date", "20260527T000000Z")
	headers.Set("Host", "example.invalid")
	signed, canonical := canonicalHeaders(headers)
	if signed != "host;x-amz-date" {
		t.Fatalf("signed headers = %q", signed)
	}
	if !strings.Contains(canonical, "host:example.invalid\n") || !strings.Contains(canonical, "x-amz-date:20260527T000000Z\n") {
		t.Fatalf("canonical headers = %q", canonical)
	}

	mac := hmac.New(sha256.New, []byte("key"))
	mac.Write([]byte("data"))
	if got := hmacSHA256([]byte("key"), "data"); !hmac.Equal(got, mac.Sum(nil)) {
		t.Fatalf("hmac mismatch")
	}
	if len(sigv4SigningKey("secret", "20260527", "us-sea", "s3")) != sha256.Size {
		t.Fatalf("unexpected signing key size")
	}
}
