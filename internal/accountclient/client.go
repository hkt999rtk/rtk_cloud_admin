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

	"rtk_cloud_admin/internal/correlation"
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
	Capabilities          []string       `json:"capabilities,omitempty"`
	Permissions           []string       `json:"permissions,omitempty"`
	Metadata              map[string]any `json:"metadata,omitempty"`
}

type BrandCloud = Organization

type BrandCloudRequest struct {
	Name     string         `json:"name,omitempty"`
	Status   string         `json:"status,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type BrandCloudMemberRequest struct {
	BrandCloudUserID string `json:"brand_cloud_user_id"`
	Role             string `json:"role"`
}

type BrandCloudUserRequest struct {
	Email          string `json:"email"`
	Password       string `json:"password"`
	DisplayName    string `json:"display_name,omitempty"`
	Role           string `json:"role"`
	RotatePassword bool   `json:"rotate_password,omitempty"`
}

type BrandCloudUser struct {
	ID                        string `json:"id"`
	BrandCloudID              string `json:"brand_cloud_id"`
	Email                     string `json:"email"`
	DisplayName               string `json:"display_name,omitempty"`
	EmailVerified             bool   `json:"email_verified"`
	EmailVerifiedAt           string `json:"email_verified_at,omitempty"`
	SignupPendingVerification bool   `json:"signup_pending_verification"`
	CreatedAt                 string `json:"created_at"`
	UpdatedAt                 string `json:"updated_at"`
	DisabledAt                string `json:"disabled_at,omitempty"`
}

type Member struct {
	OrganizationID   string `json:"organization_id"`
	UserID           string `json:"user_id"`
	BrandCloudUserID string `json:"brand_cloud_user_id,omitempty"`
	Email            string `json:"email,omitempty"`
	Role             string `json:"role"`
}

type BrandCloudUserResult struct {
	Action           string         `json:"action"`
	BrandCloudUser   BrandCloudUser `json:"brand_cloud_user"`
	BrandCloudMember Member         `json:"brand_cloud_member"`
}

type Device struct {
	ID                  string         `json:"id"`
	OrganizationID      string         `json:"organization_id"`
	DeviceItemProfileID string         `json:"device_item_profile_id,omitempty"`
	Organization        string         `json:"organization"`
	Name                string         `json:"name"`
	Category            string         `json:"category"`
	Model               string         `json:"model"`
	SerialNumber        string         `json:"serial_number"`
	VideoCloudDevID     string         `json:"video_cloud_devid"`
	Status              string         `json:"status"`
	Readiness           string         `json:"readiness"`
	LastSeenAt          string         `json:"last_seen_at"`
	UpdatedAt           string         `json:"updated_at"`
	Metadata            map[string]any `json:"metadata"`
}

type Pagination struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
	Total  int `json:"total"`
}

type FleetDevicesPage struct {
	Devices    []Device       `json:"devices"`
	Pagination Pagination     `json:"pagination"`
	Query      map[string]any `json:"query,omitempty"`
}

type FleetSummary struct {
	Total          int                       `json:"total"`
	ByStatus       map[string]int            `json:"by_status"`
	BySKU          map[string]int            `json:"by_sku"`
	ByModel        map[string]int            `json:"by_model"`
	ByFirmware     map[string]int            `json:"by_firmware"`
	ByRegion       map[string]int            `json:"by_region"`
	ServiceEnabled map[string]int            `json:"service_enabled"`
	BySKURegion    map[string]map[string]int `json:"by_sku_region"`
	BySKUFirmware  map[string]map[string]int `json:"by_sku_firmware"`
	UpdatedAt      string                    `json:"updated_at"`
}

type DeviceItemProfile struct {
	ID                 string         `json:"id"`
	BrandCloudID       string         `json:"brand_cloud_id"`
	ProfileKey         string         `json:"profile_key"`
	DisplayName        string         `json:"display_name"`
	Status             string         `json:"status"`
	Category           string         `json:"category"`
	Manufacturer       string         `json:"manufacturer,omitempty"`
	Model              string         `json:"model,omitempty"`
	MetadataDefaults   map[string]any `json:"metadata_defaults"`
	MetadataSchema     map[string]any `json:"metadata_schema"`
	ServiceOptions     []string       `json:"service_options"`
	ClaimPolicy        map[string]any `json:"claim_policy"`
	ProvisioningPolicy map[string]any `json:"provisioning_policy"`
	CreatedAt          string         `json:"created_at"`
	UpdatedAt          string         `json:"updated_at"`
}

type DeviceItemProfileRequest struct {
	ProfileKey         string         `json:"profile_key,omitempty"`
	DisplayName        string         `json:"display_name,omitempty"`
	Status             string         `json:"status,omitempty"`
	Category           string         `json:"category,omitempty"`
	Manufacturer       string         `json:"manufacturer,omitempty"`
	Model              string         `json:"model,omitempty"`
	MetadataDefaults   map[string]any `json:"metadata_defaults,omitempty"`
	MetadataSchema     map[string]any `json:"metadata_schema,omitempty"`
	CAProfile          string         `json:"ca_profile,omitempty"`
	IssuerProfile      string         `json:"issuer_profile,omitempty"`
	ServiceOptions     []string       `json:"service_options,omitempty"`
	ClaimPolicy        map[string]any `json:"claim_policy,omitempty"`
	ProvisioningPolicy map[string]any `json:"provisioning_policy,omitempty"`
}

type DeviceGroup struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	DeviceCount    int    `json:"device_count,omitempty"`
}

type DeviceGroupRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

type DeviceTagSummary struct {
	Tag         string `json:"tag"`
	DeviceCount int    `json:"device_count"`
}

type Role struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ScopeType   string `json:"scope_type"`
	Description string `json:"description,omitempty"`
}

type Permission struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Domain      string `json:"domain"`
	Action      string `json:"action"`
	Description string `json:"description,omitempty"`
}

type RoleAssignment struct {
	ID             string `json:"id"`
	RoleID         string `json:"role_id"`
	RoleName       string `json:"role_name"`
	ActorType      string `json:"actor_type"`
	ActorID        string `json:"actor_id"`
	ScopeType      string `json:"scope_type"`
	ScopeID        string `json:"scope_id,omitempty"`
	OrganizationID string `json:"organization_id,omitempty"`
}

type RoleAssignmentRequest struct {
	RoleName  string `json:"role_name"`
	ActorID   string `json:"actor_id"`
	ScopeType string `json:"scope_type"`
	ScopeID   string `json:"scope_id,omitempty"`
}

type AccessCheck struct {
	Allowed   bool   `json:"allowed"`
	ScopeType string `json:"scope_type"`
	ScopeID   string `json:"scope_id"`
}

type ProductionRun struct {
	ID                  string `json:"id"`
	DeviceItemProfileID string `json:"device_item_profile_id"`
	FactoryID           string `json:"factory_id,omitempty"`
	BatchID             string `json:"batch_id,omitempty"`
	Status              string `json:"status"`
	AllowedQuantity     int    `json:"allowed_quantity"`
	IssuedQuantity      int    `json:"issued_quantity"`
}

type DeviceUpdateRequest struct {
	Name     string         `json:"name"`
	Category string         `json:"category"`
	Model    string         `json:"model,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
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

type ResetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
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

func (c *Client) SignIn(ctx context.Context, email string) error {
	return c.doJSON(ctx, http.MethodPost, "/v1/auth/sign-in", "", EmailRequest{Email: email}, nil)
}

func (c *Client) ActivateLogin(ctx context.Context, token string) (LoginResult, error) {
	var out LoginResult
	err := c.doJSON(ctx, http.MethodPost, "/v1/auth/login/activate", "", AuthTokenRequest{Token: token}, &out)
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

func (c *Client) ForgotPassword(ctx context.Context, email string) error {
	return c.doJSON(ctx, http.MethodPost, "/v1/auth/forgot-password", "", EmailRequest{Email: email}, nil)
}

func (c *Client) ResetPassword(ctx context.Context, token, newPassword string) error {
	return c.doJSON(ctx, http.MethodPost, "/v1/auth/reset-password", "", ResetPasswordRequest{
		Token:       token,
		NewPassword: newPassword,
	}, nil)
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

func (c *Client) CreateBrandCloudUser(ctx context.Context, accessToken, brandCloudID string, req BrandCloudUserRequest) (BrandCloudUserResult, int, error) {
	var body BrandCloudUserResult
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID) + "/users"
	status, err := c.doJSONStatus(ctx, http.MethodPost, path, accessToken, req, &body)
	return body, status, err
}

func (c *Client) BrandCloudUsers(ctx context.Context, accessToken, brandCloudID string, query url.Values) ([]BrandCloudUser, error) {
	var body struct {
		BrandCloudUsers []BrandCloudUser `json:"brand_cloud_users"`
	}
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID) + "/users"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.BrandCloudUsers, nil
}

func (c *Client) DisableBrandCloudUser(ctx context.Context, accessToken, brandCloudID, brandCloudUserID string) (BrandCloudUser, error) {
	return c.brandCloudUserAction(ctx, accessToken, brandCloudID, brandCloudUserID, "disable")
}

func (c *Client) EnableBrandCloudUser(ctx context.Context, accessToken, brandCloudID, brandCloudUserID string) (BrandCloudUser, error) {
	return c.brandCloudUserAction(ctx, accessToken, brandCloudID, brandCloudUserID, "enable")
}

func (c *Client) ApproveBrandCloudUser(ctx context.Context, accessToken, brandCloudID, brandCloudUserID string) (BrandCloudUser, error) {
	return c.brandCloudUserAction(ctx, accessToken, brandCloudID, brandCloudUserID, "approve")
}

func (c *Client) DeleteBrandCloudUser(ctx context.Context, accessToken, brandCloudID, brandCloudUserID string) error {
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID) + "/users/" + url.PathEscape(brandCloudUserID)
	return c.doJSON(ctx, http.MethodDelete, path, accessToken, nil, nil)
}

func (c *Client) brandCloudUserAction(ctx context.Context, accessToken, brandCloudID, brandCloudUserID, action string) (BrandCloudUser, error) {
	var body struct {
		BrandCloudUser BrandCloudUser `json:"brand_cloud_user"`
	}
	path := "/v1/admin/brand-clouds/" + url.PathEscape(brandCloudID) + "/users/" + url.PathEscape(brandCloudUserID) + "/" + action
	err := c.doJSON(ctx, http.MethodPost, path, accessToken, nil, &body)
	return body.BrandCloudUser, err
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

func (c *Client) Device(ctx context.Context, accessToken, orgID, deviceID string) (Device, error) {
	var body struct {
		Device Device `json:"device"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/devices/" + url.PathEscape(deviceID)
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return Device{}, err
	}
	return body.Device, nil
}

func (c *Client) UpdateDevice(ctx context.Context, accessToken, orgID, deviceID string, request DeviceUpdateRequest) (Device, error) {
	var body struct {
		Device Device `json:"device"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/devices/" + url.PathEscape(deviceID)
	if err := c.doJSON(ctx, http.MethodPatch, path, accessToken, request, &body); err != nil {
		return Device{}, err
	}
	return body.Device, nil
}

func (c *Client) FleetDevices(ctx context.Context, accessToken, orgID string, query url.Values) (FleetDevicesPage, error) {
	var body FleetDevicesPage
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/fleet/devices"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return FleetDevicesPage{}, err
	}
	return body, nil
}

func (c *Client) FleetSummary(ctx context.Context, accessToken, orgID string) (FleetSummary, error) {
	var body FleetSummary
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/fleet/summary"
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return FleetSummary{}, err
	}
	return body, nil
}

func (c *Client) DeviceGroups(ctx context.Context, accessToken, orgID string, query url.Values) ([]DeviceGroup, error) {
	var body struct {
		DeviceGroups []DeviceGroup `json:"device_groups"`
		Groups       []DeviceGroup `json:"groups"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	if len(body.DeviceGroups) > 0 {
		return body.DeviceGroups, nil
	}
	return body.Groups, nil
}

func (c *Client) DeviceGroup(ctx context.Context, accessToken, orgID, groupID string) (DeviceGroup, error) {
	var body struct {
		Group DeviceGroup `json:"group"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups/" + url.PathEscape(groupID)
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return DeviceGroup{}, err
	}
	return body.Group, nil
}

func (c *Client) DeviceTags(ctx context.Context, accessToken, orgID string, query url.Values) ([]DeviceTagSummary, error) {
	var body struct {
		Tags []DeviceTagSummary `json:"tags"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/tags"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Tags, nil
}

func (c *Client) CreateDeviceGroup(ctx context.Context, accessToken, orgID string, request DeviceGroupRequest) (DeviceGroup, error) {
	var body struct {
		Group DeviceGroup `json:"group"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups"
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, request, &body); err != nil {
		return DeviceGroup{}, err
	}
	return body.Group, nil
}

func (c *Client) UpdateDeviceGroup(ctx context.Context, accessToken, orgID, groupID string, request DeviceGroupRequest) (DeviceGroup, error) {
	var body struct {
		Group DeviceGroup `json:"group"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups/" + url.PathEscape(groupID)
	if err := c.doJSON(ctx, http.MethodPatch, path, accessToken, request, &body); err != nil {
		return DeviceGroup{}, err
	}
	return body.Group, nil
}

func (c *Client) DeleteDeviceGroup(ctx context.Context, accessToken, orgID, groupID string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups/" + url.PathEscape(groupID)
	return c.doJSON(ctx, http.MethodDelete, path, accessToken, nil, nil)
}

func (c *Client) Roles(ctx context.Context, accessToken, orgID string, query url.Values) ([]Role, error) {
	var body struct {
		Roles []Role `json:"roles"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/roles"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Roles, nil
}

func (c *Client) Permissions(ctx context.Context, accessToken, orgID string, query url.Values) ([]Permission, error) {
	var body struct {
		Permissions []Permission `json:"permissions"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/permissions"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Permissions, nil
}

func (c *Client) RoleAssignments(ctx context.Context, accessToken, orgID string, query url.Values) ([]RoleAssignment, error) {
	var body struct {
		Assignments []RoleAssignment `json:"role_assignments"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/role-assignments"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Assignments, nil
}

func (c *Client) CheckAccess(ctx context.Context, accessToken, orgID, permission, scopeType, scopeID string) (bool, error) {
	var body AccessCheck
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/access/check?permission=" + url.QueryEscape(permission) + "&scope_type=" + url.QueryEscape(scopeType) + "&scope_id=" + url.QueryEscape(scopeID)
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return false, err
	}
	return body.Allowed, nil
}

func (c *Client) CreateRoleAssignment(ctx context.Context, accessToken, orgID string, request RoleAssignmentRequest) (RoleAssignment, error) {
	var body struct {
		Assignment RoleAssignment `json:"role_assignment"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/role-assignments"
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, request, &body); err != nil {
		return RoleAssignment{}, err
	}
	return body.Assignment, nil
}

func (c *Client) DeleteRoleAssignment(ctx context.Context, accessToken, orgID, assignmentID string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/role-assignments/" + url.PathEscape(assignmentID)
	return c.doJSON(ctx, http.MethodDelete, path, accessToken, nil, nil)
}

func (c *Client) ProductionRuns(ctx context.Context, accessToken, orgID, profileID string, query url.Values) ([]ProductionRun, error) {
	var body struct {
		Runs []ProductionRun `json:"production_runs"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles/" + url.PathEscape(profileID) + "/production-runs"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.Runs, nil
}

func (c *Client) AddDeviceToGroup(ctx context.Context, accessToken, orgID, groupID, deviceID string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups/" + url.PathEscape(groupID) + "/devices/" + url.PathEscape(deviceID)
	return c.doJSON(ctx, http.MethodPut, path, accessToken, nil, nil)
}

func (c *Client) RemoveDeviceFromGroup(ctx context.Context, accessToken, orgID, groupID, deviceID string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-groups/" + url.PathEscape(groupID) + "/devices/" + url.PathEscape(deviceID)
	return c.doJSON(ctx, http.MethodDelete, path, accessToken, nil, nil)
}

func (c *Client) AddDeviceTag(ctx context.Context, accessToken, orgID, deviceID, tag string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/devices/" + url.PathEscape(deviceID) + "/tags/" + url.PathEscape(tag)
	return c.doJSON(ctx, http.MethodPut, path, accessToken, nil, nil)
}

func (c *Client) RemoveDeviceTag(ctx context.Context, accessToken, orgID, deviceID, tag string) error {
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/devices/" + url.PathEscape(deviceID) + "/tags/" + url.PathEscape(tag)
	return c.doJSON(ctx, http.MethodDelete, path, accessToken, nil, nil)
}

func (c *Client) DeviceItemProfiles(ctx context.Context, accessToken, orgID string, query url.Values) ([]DeviceItemProfile, error) {
	var body struct {
		DeviceItemProfiles []DeviceItemProfile `json:"device_item_profiles"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return nil, err
	}
	return body.DeviceItemProfiles, nil
}

func (c *Client) DeviceItemProfile(ctx context.Context, accessToken, orgID, profileID string) (DeviceItemProfile, error) {
	var body struct {
		DeviceItemProfile DeviceItemProfile `json:"device_item_profile"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles/" + url.PathEscape(profileID)
	if err := c.doJSON(ctx, http.MethodGet, path, accessToken, nil, &body); err != nil {
		return DeviceItemProfile{}, err
	}
	return body.DeviceItemProfile, nil
}

func (c *Client) CreateDeviceItemProfile(ctx context.Context, accessToken, orgID string, request DeviceItemProfileRequest) (DeviceItemProfile, error) {
	var body struct {
		DeviceItemProfile DeviceItemProfile `json:"device_item_profile"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles"
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, request, &body); err != nil {
		return DeviceItemProfile{}, err
	}
	return body.DeviceItemProfile, nil
}

func (c *Client) UpdateDeviceItemProfile(ctx context.Context, accessToken, orgID, profileID string, request DeviceItemProfileRequest) (DeviceItemProfile, error) {
	var body struct {
		DeviceItemProfile DeviceItemProfile `json:"device_item_profile"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles/" + url.PathEscape(profileID)
	if err := c.doJSON(ctx, http.MethodPatch, path, accessToken, request, &body); err != nil {
		return DeviceItemProfile{}, err
	}
	return body.DeviceItemProfile, nil
}

func (c *Client) DisableDeviceItemProfile(ctx context.Context, accessToken, orgID, profileID string) (DeviceItemProfile, error) {
	var body struct {
		DeviceItemProfile DeviceItemProfile `json:"device_item_profile"`
	}
	path := "/v1/orgs/" + url.PathEscape(orgID) + "/device-item-profiles/" + url.PathEscape(profileID) + "/disable"
	if err := c.doJSON(ctx, http.MethodPost, path, accessToken, map[string]string{}, &body); err != nil {
		return DeviceItemProfile{}, err
	}
	return body.DeviceItemProfile, nil
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
	correlation.ApplyHeaders(ctx, req)
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
	_, err := c.doJSONStatus(ctx, method, path, token, in, out)
	return err
}

func (c *Client) doJSONStatus(ctx context.Context, method, path, token string, in any, out any) (int, error) {
	if !c.Enabled() {
		return 0, fmt.Errorf("account manager base URL is not configured")
	}
	var body *bytes.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return 0, err
		}
		body = bytes.NewReader(data)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	correlation.ApplyHeaders(ctx, req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, &HTTPError{
			Method:     method,
			Path:       path,
			StatusCode: resp.StatusCode,
			Body:       strings.TrimSpace(string(body)),
		}
	}
	if out == nil {
		return resp.StatusCode, nil
	}
	return resp.StatusCode, json.NewDecoder(resp.Body).Decode(out)
}
