package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

func main() {
	var endpoint, bucket, key, file, region string
	flag.StringVar(&endpoint, "endpoint", getenv("LINODE_OBJ_ENDPOINT"), "S3-compatible endpoint URL")
	flag.StringVar(&bucket, "bucket", getenv("LINODE_OBJ_BUCKET"), "S3 bucket")
	flag.StringVar(&key, "key", "", "object key")
	flag.StringVar(&file, "file", "", "file to upload")
	flag.StringVar(&region, "region", getenvDefault("AWS_DEFAULT_REGION", "us-sea"), "AWS signing region")
	flag.Parse()

	accessKey := getenv("AWS_ACCESS_KEY_ID")
	secretKey := getenv("AWS_SECRET_ACCESS_KEY")
	if endpoint == "" || bucket == "" || key == "" || file == "" || accessKey == "" || secretKey == "" {
		fail("endpoint, bucket, key, file, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY are required")
	}

	body, err := os.ReadFile(file)
	if err != nil {
		fail("read %s: %v", file, err)
	}
	if err := putObject(endpoint, bucket, key, region, accessKey, secretKey, body); err != nil {
		fail("%v", err)
	}
	fmt.Printf("uploaded s3://%s/%s\n", bucket, key)
}

func putObject(endpoint, bucket, key, region, accessKey, secretKey string, body []byte) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("parse endpoint: %w", err)
	}
	u.Path = path.Join("/", bucket, key)
	u.RawQuery = ""

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	shortDate := now.Format("20060102")
	payloadHashBytes := sha256.Sum256(body)
	payloadHash := hex.EncodeToString(payloadHashBytes[:])

	req, err := http.NewRequest(http.MethodPut, u.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Host", u.Host)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Content-Type", contentType(key))
	req.Host = u.Host

	signedHeaders, canonicalHeaders := canonicalHeaders(req.Header)
	canonicalRequest := strings.Join([]string{
		http.MethodPut,
		uriEncodePath(u.Path),
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	canonicalHashBytes := sha256.Sum256([]byte(canonicalRequest))
	scope := strings.Join([]string{shortDate, region, "s3", "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hex.EncodeToString(canonicalHashBytes[:]),
	}, "\n")
	signingKey := sigv4SigningKey(secretKey, shortDate, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey,
		scope,
		signedHeaders,
		signature,
	))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("put object failed: status=%s body=%s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	return nil
}

func canonicalHeaders(headers http.Header) (string, string) {
	names := make([]string, 0, len(headers))
	lowerToCanonical := make(map[string]string, len(headers))
	for name := range headers {
		lower := strings.ToLower(name)
		names = append(names, lower)
		lowerToCanonical[lower] = name
	}
	sort.Strings(names)
	var b strings.Builder
	for _, name := range names {
		values := headers.Values(lowerToCanonical[name])
		for i := range values {
			values[i] = strings.Join(strings.Fields(values[i]), " ")
		}
		b.WriteString(name)
		b.WriteByte(':')
		b.WriteString(strings.Join(values, ","))
		b.WriteByte('\n')
	}
	return strings.Join(names, ";"), b.String()
}

func uriEncodePath(p string) string {
	if p == "" {
		return "/"
	}
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	encoded := strings.Join(parts, "/")
	if strings.HasPrefix(p, "/") && !strings.HasPrefix(encoded, "/") {
		encoded = "/" + encoded
	}
	return encoded
}

func sigv4SigningKey(secret, date, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), date)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func contentType(key string) string {
	switch {
	case strings.HasSuffix(key, ".json"):
		return "application/json"
	case strings.HasSuffix(key, ".sha256"):
		return "text/plain"
	default:
		return "application/gzip"
	}
}

func getenv(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

func getenvDefault(name, fallback string) string {
	if value := getenv(name); value != "" {
		return value
	}
	return fallback
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}
