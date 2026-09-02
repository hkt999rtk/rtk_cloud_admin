package sdkportalclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const publicCatalogSchema = "rtk-portal-sdk-public-catalog/v1"

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type Artifact struct {
	Slug             string   `json:"slug"`
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	Filename         string   `json:"filename"`
	SHA256           string   `json:"sha256"`
	SizeBytes        int64    `json:"size_bytes"`
	ValidationStatus string   `json:"validation_status"`
	Capabilities     []string `json:"capabilities"`
	Limitations      []string `json:"limitations"`
}

type Catalog struct {
	Schema         string     `json:"schema"`
	Version        string     `json:"version"`
	ReleaseTrain   string     `json:"release_train"`
	CreatedAt      string     `json:"created_at"`
	Distribution   string     `json:"distribution"`
	SigningStatus  string     `json:"signing_status"`
	TermsVersion   string     `json:"terms_version"`
	Packages       []Artifact `json:"packages"`
	CompleteBundle Artifact   `json:"complete_bundle"`
}

type Client struct {
	baseURL *url.URL
	http    *http.Client
}

func New(rawBaseURL string) (*Client, error) {
	baseURL, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil || baseURL.Host == "" || (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.User != nil || baseURL.RawQuery != "" || baseURL.Fragment != "" || (baseURL.Path != "" && baseURL.Path != "/") {
		return nil, errors.New("SDK_PORTAL_BASE_URL must be an HTTP or HTTPS origin")
	}
	baseURL.Path = ""
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 3 * time.Second}}, nil
}

func (c *Client) Latest(ctx context.Context) (Catalog, error) {
	if c == nil || c.baseURL == nil {
		return Catalog{}, errors.New("SDK Portal is not configured")
	}
	target := *c.baseURL
	target.Path = "/api/sdk/catalog"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return Catalog{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return Catalog{}, fmt.Errorf("read SDK Portal catalog: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return Catalog{}, fmt.Errorf("SDK Portal catalog returned HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	decoder.DisallowUnknownFields()
	var catalog Catalog
	if err := decoder.Decode(&catalog); err != nil {
		return Catalog{}, errors.New("SDK Portal returned an invalid catalog")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Catalog{}, errors.New("SDK Portal returned trailing catalog data")
	}
	if err := validateCatalog(catalog); err != nil {
		return Catalog{}, err
	}
	return catalog, nil
}

func (c *Client) ManualURL() string {
	if c == nil || c.baseURL == nil {
		return ""
	}
	target := *c.baseURL
	target.Path = "/manual/sdk"
	return target.String()
}

func validateCatalog(catalog Catalog) error {
	if catalog.Schema != publicCatalogSchema || catalog.Distribution != "public-evaluation" || !versionPattern.MatchString(catalog.Version) || !versionPattern.MatchString(catalog.TermsVersion) {
		return errors.New("SDK Portal returned an incompatible catalog")
	}
	if strings.TrimSpace(catalog.ReleaseTrain) == "" || (catalog.SigningStatus != "not_configured" && catalog.SigningStatus != "signed") {
		return errors.New("SDK Portal catalog is missing release metadata")
	}
	if _, err := time.Parse(time.RFC3339, catalog.CreatedAt); err != nil {
		return errors.New("SDK Portal catalog has an invalid release timestamp")
	}
	if len(catalog.Packages) != 5 || catalog.CompleteBundle.Slug != "all" {
		return errors.New("SDK Portal catalog is incomplete")
	}
	want := map[string]bool{"native": true, "android": true, "javascript": true, "ios": true, "freertos-pro2": true, "all": true}
	seen := map[string]bool{}
	for _, artifact := range append(append([]Artifact{}, catalog.Packages...), catalog.CompleteBundle) {
		if !want[artifact.Slug] || seen[artifact.Slug] || strings.TrimSpace(artifact.Title) == "" || strings.TrimSpace(artifact.Description) == "" || strings.TrimSpace(artifact.Filename) == "" || artifact.SizeBytes <= 0 || artifact.ValidationStatus != "PASS" || !sha256Pattern.MatchString(artifact.SHA256) || !validLabels(artifact.Capabilities) || !validLabels(artifact.Limitations) {
			return errors.New("SDK Portal catalog contains an invalid artifact")
		}
		seen[artifact.Slug] = true
	}
	return nil
}

func validLabels(values []string) bool {
	if len(values) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
