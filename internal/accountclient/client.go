package accountclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type Organization struct {
	ID                    string         `json:"id"`
	Name                  string         `json:"name"`
	Role                  string         `json:"role"`
	OrganizationKind      string         `json:"organization_kind,omitempty"`
	Status                string         `json:"status,omitempty"`
	Tier                  string         `json:"tier,omitempty"`
	EvaluationDeviceQuota int            `json:"evaluation_device_quota,omitempty"`
	Metadata              map[string]any `json:"metadata,omitempty"`
}

type BrandCloud = Organization

type BrandCloudRequest struct {
	Name     string         `json:"name,omitempty"`
	Status   string         `json:"status,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type BrandCloudMemberRequest struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

type Member struct {
	OrganizationID string `json:"organization_id"`
	UserID         string `json:"user_id"`
	Email          string `json:"email,omitempty"`
	Role           string `json:"role"`
}

type Device struct {
	ID              string         `json:"id"`
	OrganizationID  string         `json:"organization_id"`
	Organization    string         `json:"organization"`
	Name            string         `json:"name"`
	Category        string         `json:"category"`
	Model           string         `json:"model"`
	SerialNumber    string         `json:"serial_number"`
	VideoCloudDevID string         `json:"video_cloud_devid"`
	Status          string         `json:"status"`
	Readiness       string         `json:"readiness"`
	LastSeenAt      string         `json:"last_seen_at"`
	UpdatedAt       string         `json:"updated_at"`
	Metadata        map[string]any `json:"metadata"`
}

type Operation struct {
	ID                  string `json:"id"`
	DeviceID            string `json:"device_id,omitempty"`
	DeviceName          string `json:"device_name,omitempty"`
	OrganizationID      string `json:"organization_id,omitempty"`
	Organization        string `json:"organization,omitempty"`
	Type                string `json:"type,omitempty"`
	State               string `json:"state"`
	UpstreamOperationID string `json:"upstream_operation_id,omitempty"`
	UpstreamState       string `json:"upstream_state,omitempty"`
	Message             string `json:"message"`
	UpdatedAt           string `json:"updated_at"`
}

type Tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    string `json:"expires_at"`
}

type LoginResult struct {
	User   User   `json:"user"`
	Tokens Tokens `json:"tokens"`
}

type RefreshResult struct {
	Tokens Tokens `json:"tokens"`
}

type MeResult struct {
	User          User           `json:"user"`
	Organizations []Organization `json:"organizations"`
}

type SSOStartRequest struct {
	Email     string `json:"email"`
	ReturnURL string `json:"return_url,omitempty"`
}

type SSOStartResult struct {
	RedirectURL    string `json:"redirect_url"`
	State          string `json:"state,omitempty"`
	ProviderID     string `json:"provider_id,omitempty"`
	OrganizationID string `json:"organization_id,omitempty"`
	Organization   string `json:"organization,omitempty"`
}

type SSOCallbackRequest struct {
	Code        string `json:"code"`
	State       string `json:"state"`
	RedirectURI string `json:"redirect_uri,omitempty"`
}

type SSOCallbackResult struct {
	User          User           `json:"user"`
	Kind          string         `json:"kind"`
	Organizations []Organization `json:"organizations"`
	ActiveOrgID   string         `json:"active_org_id,omitempty"`
	Tokens        Tokens         `json:"tokens"`
}

type SSOProviderStatus struct {
	OrganizationID  string   `json:"organization_id"`
	Organization    string   `json:"organization,omitempty"`
	ProviderID      string   `json:"provider_id,omitempty"`
	Issuer          string   `json:"issuer,omitempty"`
	ClientID        string   `json:"client_id,omitempty"`
	VerifiedDomains []string `json:"verified_domains,omitempty"`
	Enabled         bool     `json:"enabled"`
	Configured      bool     `json:"configured"`
	Status          string   `json:"status,omitempty"`
	Error           string   `json:"error,omitempty"`
	LastValidatedAt string   `json:"last_validated_at,omitempty"`
}

type SSOProviderConfigRequest struct {
	Issuer          string   `json:"issuer"`
	ClientID        string   `json:"client_id"`
	ClientSecret    string   `json:"client_secret,omitempty"`
	VerifiedDomains []string `json:"verified_domains"`
	Enabled         bool     `json:"enabled"`
}

type SignupRequest struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	DisplayName      string `json:"display_name,omitempty"`
	OrganizationName string `json:"organization_name"`
	CaptchaToken     string `json:"captcha_token,omitempty"`
}

type SignupResult struct {
	User         User         `json:"user"`
	Organization Organization `json:"organization"`
}

type AuthTokenRequest struct {
	Token string `json:"token"`
}

type VerifyEmailResult struct {
	User   User   `json:"user"`
	Tokens Tokens `json:"tokens,omitempty"`
}

type EmailRequest struct {
	Email string `json:"email"`
}

type QuotaRaiseRequest struct {
	RequestedQuota int            `json:"requested_quota"`
	UseCase        string         `json:"use_case"`
	ContactInfo    map[string]any `json:"contact_info"`
}

type QuotaRaiseRequestRecord struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	RequestedBy    string         `json:"requested_by"`
	RequestedQuota int            `json:"requested_quota"`
	UseCase        string         `json:"use_case"`
	ContactInfo    map[string]any `json:"contact_info"`
	Status         string         `json:"status"`
	DecidedBy      string         `json:"decided_by,omitempty"`
	DecisionReason string         `json:"decision_reason,omitempty"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
	DecidedAt      string         `json:"decided_at,omitempty"`
}

type QuotaRaiseRequestResult struct {
	QuotaRaiseRequest QuotaRaiseRequestRecord `json:"quota_raise_request"`
	Organization      Organization            `json:"organization"`
}

type HTTPError struct {
	Method     string
	Path       string
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("upstream %s %s returned %d: %s", e.Method, e.Path, e.StatusCode, e.Body)
	}
	return fmt.Sprintf("upstream %s %s returned %d", e.Method, e.Path, e.StatusCode)
}

func New(baseURL string) *Client {
	return NewWithHTTPClient(baseURL, &http.Client{Timeout: 6 * time.Second})
}

func NewWithHTTPClient(baseURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 6 * time.Second}
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: httpClient,
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

func (c *Client) Login(ctx context.Context, email, password string) (LoginResult, error) {
	var out LoginResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/login", "", map[string]string{
		"email":    email,
		"password": password,
	}, &out)
	return out, err
}

func (c *Client) Signup(ctx context.Context, req SignupRequest) (SignupResult, error) {
	var out SignupResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/signup", "", req, &out)
	return out, err
}

func (c *Client) VerifyEmail(ctx context.Context, token string) (VerifyEmailResult, error) {
	var out VerifyEmailResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/verify-email", "", AuthTokenRequest{Token: token}, &out)
	return out, err
}

func (c *Client) ResendVerification(ctx context.Context, email string) error {
	return c.doJSON(ctx, http.MethodPost, "/v1/auth/resend-verification", "", EmailRequest{Email: email}, nil)
}

func (c *Client) Refresh(ctx context.Context, refreshToken string) (RefreshResult, error) {
	var out RefreshResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/refresh", "", map[string]string{
		"refresh_token": refreshToken,
	}, &out)
	return out, err
}

func (c *Client) Me(ctx context.Context, accessToken string) (MeResult, error) {
	var out MeResult
	err := c.doJSON(ctx, http.MethodGet, "/v1/me", accessToken, nil, &out)
	return out, err
}

func (c *Client) StartSSO(ctx context.Context, req SSOStartRequest) (SSOStartResult, error) {
	var out SSOStartResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/sso/start", "", req, &out)
	return out, err
}

func (c *Client) CompleteSSO(ctx context.Context, req SSOCallbackRequest) (SSOCallbackResult, error) {
	var out SSOCallbackResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/sso/callback", "", req, &out)
	return out, err
}

func (c *Client) SSOProviderStatuses(ctx context.Context, accessToken string) ([]SSOProviderStatus, error) {
	var body struct {
		Providers []SSOProviderStatus `json:"providers"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/admin/sso/providers/status", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Providers, nil
}

func (c *Client) SSOProviderStatus(ctx context.Context, accessToken, orgID string) (SSOProviderStatus, error) {
	var body struct {
		Provider SSOProviderStatus `json:"provider"`
	}
	path := "/v1/admin/orgs/" + url.PathEscape(orgID) + "/sso-provider"
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return SSOProviderStatus{}, err
	}
	return body.Provider, nil
}

func (c *Client) UpsertSSOProvider(ctx context.Context, accessToken, orgID string, req SSOProviderConfigRequest) (SSOProviderStatus, error) {
	var body struct {
		Provider SSOProviderStatus `json:"provider"`
	}
	path := "/v1/admin/orgs/" + url.PathEscape(orgID) + "/sso-provider"
	if err := c.doJSON(ctx, http.MethodPut, path, accessToken, req, &body); err != nil {
		return SSOProviderStatus{}, err
	}
	return body.Provider, nil
}

func (c *Client) Organizations(ctx context.Context, accessToken string) ([]Organization, error) {
	var body struct {
		Organizations []Organization `json:"organizations"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/orgs", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Organizations, nil
}

func (c *Client) AdminOrganizations(ctx context.Context, accessToken string) ([]Organization, error) {
	var body struct {
		Organizations []Organization `json:"organizations"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/admin/orgs", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Organizations, nil
}

func (c *Client) CreateBrandCloud(ctx context.Context, accessToken string, req BrandCloudRequest) (BrandCloud, error) {
	var body struct {
		BrandCloud BrandCloud `json:"brand_cloud"`
	}
	err := c.doJSON(ctx, http.MethodPost, "/v1/admin/brand-clouds", accessToken, req, &body)
	return body.BrandCloud, err
}

func (c *Client) BrandClouds(ctx context.Context, accessToken string) ([]BrandCloud, error) {
	var body struct {
		BrandClouds []BrandCloud `json:"brand_clouds"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/admin/brand-clouds", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.BrandClouds, nil
}

func (c *Client) BrandCloud(ctx context.Context, accessToken, brandCloudID string) (BrandCloud, error) {
	var body struct {
		BrandCloud BrandCloud `json:"brand_cloud"`
	}
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID)
	err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body)
	return body.BrandCloud, err
}

func (c *Client) UpdateBrandCloud(ctx context.Context, accessToken, brandCloudID string, req BrandCloudRequest) (BrandCloud, error) {
	var body struct {
		BrandCloud BrandCloud `json:"brand_cloud"`
	}
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID)
	err := c.doJSON(ctx, http.MethodPatch, path, accessToken, req, &body)
	return body.BrandCloud, err
}

func (c *Client) AssignBrandCloudMember(ctx context.Context, accessToken, brandCloudID string, req BrandCloudMemberRequest) (Member, error) {
	var body struct {
		Member Member `json:"member"`
	}
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID) + "/members"
	err := c.doJSON(ctx, http.MethodPost, path, accessToken, req, &body)
	return body.Member, err
}

func (c *Client) Devices(ctx context.Context, accessToken, orgID string) ([]Device, error) {
	var body struct {
		Devices []Device `json:"devices"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/orgs/"+url.PathEscape(orgID)+"/devices", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Devices, nil
}

func (c *Client) AdminDevices(ctx context.Context, accessToken string) ([]Device, error) {
	var body struct {
		Devices []Device `json:"devices"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/admin/devices", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Devices, nil
}

func (c *Client) AdminOperations(ctx context.Context, accessToken string) ([]Operation, error) {
	var body struct {
		Operations []Operation `json:"operations"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/admin/operations", accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Operations, nil
}

func (c *Client) CreateQuotaRaiseRequest(ctx context.Context, accessToken, orgID string, req QuotaRaiseRequest) (QuotaRaiseRequestResult, error) {
	var out QuotaRaiseRequestResult
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/quota-raise-requests"
	err := c.doJSON(ctx, http.MethodPost, path, accessToken, req, &out)
	return out, err
}

func (c *Client) Provision(ctx context.Context, accessToken, orgID, deviceID string) (Operation, error) {
	return c.lifecycle(ctx, accessToken, orgID, deviceID, "provision")
}

func (c *Client) Deactivate(ctx context.Context, accessToken, orgID, deviceID string) (Operation, error) {
	return c.lifecycle(ctx, accessToken, orgID, deviceID, "deactivate")
}

func (c *Client) lifecycle(ctx context.Context, accessToken, orgID, deviceID, action string) (Operation, error) {
	var body struct {
		Operation Operation `json:"operation"`
		ID        string    `json:"id"`
		State     string    `json:"state"`
		Message   string    `json:"message"`
		UpdatedAt string    `json:"updated_at"`
	}
	path := fmt.Sprintf("/v1/orgs/%s/devices/%s/%s", url.PathEscape(orgID), url.PathEscape(deviceID), action)
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, map[string]string{}, &body); err != nil {
		return Operation{}, err
	}
	if body.Operation.ID != "" {
		return body.Operation, nil
	}
	return Operation{ID: body.ID, State: body.State, Message: body.Message, UpdatedAt: body.UpdatedAt}, nil
}

func (c *Client) Health(ctx context.Context) error {
	if !c.Enabled() {
		return fmt.Errorf("account manager base URL is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) doJSON(ctx context.Context, method, path, token string, in any, out any) error {
	if !c.Enabled() {
		return fmt.Errorf("account manager base URL is not configured")
	}
	var body *bytes.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return &HTTPError{
			Method:     method,
			Path:       path,
			StatusCode: resp.StatusCode,
			Body:       strings.TrimSpace(string(body)),
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
