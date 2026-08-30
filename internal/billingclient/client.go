package billingclient

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

type Pagination struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
	Total  int `json:"total"`
}
type CommercialAccount struct {
	ID                    string `json:"id"`
	OrganizationID        string `json:"organization_id"`
	Currency              string `json:"currency"`
	AvailableBalanceMinor int64  `json:"available_balance_minor"`
	State                 string `json:"state"`
	Version               int64  `json:"version"`
	CreatedAt             string `json:"created_at"`
	UpdatedAt             string `json:"updated_at"`
}
type ProviderCapabilities struct {
	HostedSetup             bool `json:"hosted_setup"`
	HostedCharge            bool `json:"hosted_charge"`
	MerchantInitiatedCharge bool `json:"merchant_initiated_charge"`
	StatusQuery             bool `json:"status_query"`
	Webhook                 bool `json:"webhook"`
	Refund                  bool `json:"refund"`
}
type PaymentProviderSummary struct {
	Name         string               `json:"name"`
	Environment  string               `json:"environment"`
	Capabilities ProviderCapabilities `json:"capabilities"`
}
type AutoTopUpPolicy struct {
	ID                      string `json:"id"`
	Enabled                 bool   `json:"enabled"`
	ThresholdMinor          int64  `json:"threshold_minor"`
	TopUpAmountMinor        int64  `json:"top_up_amount_minor"`
	Currency                string `json:"currency"`
	PaymentMethodID         string `json:"payment_method_id"`
	DailyAttemptLimit       int    `json:"daily_attempt_limit"`
	DailyAmountLimitMinor   int64  `json:"daily_amount_limit_minor"`
	CooldownSeconds         int64  `json:"cooldown_seconds"`
	Generation              int64  `json:"generation"`
	Version                 int64  `json:"version"`
	Armed                   bool   `json:"armed"`
	ConsecutiveFailureCount int    `json:"consecutive_failure_count"`
	LastTriggeredAt         string `json:"last_triggered_at,omitempty"`
	LastSucceededAt         string `json:"last_succeeded_at,omitempty"`
	LimitTimezone           string `json:"limit_timezone"`
	LimitResetAt            string `json:"limit_reset_at"`
	CreatedAt               string `json:"created_at"`
	UpdatedAt               string `json:"updated_at"`
}
type BillingAccountResponse struct {
	Account          CommercialAccount        `json:"account"`
	AutoTopUp        *AutoTopUpPolicy         `json:"auto_topup"`
	PaymentProviders []PaymentProviderSummary `json:"payment_providers"`
}
type LedgerEntry struct {
	ID                string `json:"id"`
	Direction         string `json:"direction"`
	AmountMinor       int64  `json:"amount_minor"`
	Currency          string `json:"currency"`
	Reason            string `json:"reason"`
	BalanceAfterMinor int64  `json:"balance_after_minor"`
	CreatedAt         string `json:"created_at"`
}
type BillingLedgerResponse struct {
	LedgerEntries []LedgerEntry `json:"ledger_entries"`
	Pagination    Pagination    `json:"pagination"`
}
type PaymentMethod struct {
	ID           string               `json:"id"`
	Provider     string               `json:"provider"`
	Status       string               `json:"status"`
	CardBrand    string               `json:"card_brand,omitempty"`
	LastFour     string               `json:"last_four,omitempty"`
	ExpiryMonth  *int                 `json:"expiry_month,omitempty"`
	ExpiryYear   *int                 `json:"expiry_year,omitempty"`
	Capabilities ProviderCapabilities `json:"capabilities"`
	CreatedAt    string               `json:"created_at"`
	UpdatedAt    string               `json:"updated_at"`
}
type PaymentMethodsResponse struct {
	PaymentMethods []PaymentMethod `json:"payment_methods"`
	Pagination     Pagination      `json:"pagination"`
}
type AutoTopUpResponse struct {
	AutoTopUp *AutoTopUpPolicy `json:"auto_topup"`
}
type PaymentIntent struct {
	ID                     string `json:"id"`
	AmountMinor            int64  `json:"amount_minor"`
	Currency               string `json:"currency"`
	Reason                 string `json:"reason"`
	Provider               string `json:"provider"`
	PaymentMethodID        string `json:"payment_method_id"`
	State                  string `json:"state"`
	RequiresCustomerAction bool   `json:"requires_customer_action"`
	CorrelationID          string `json:"correlation_id"`
	CreatedAt              string `json:"created_at"`
	UpdatedAt              string `json:"updated_at"`
	CompletedAt            string `json:"completed_at,omitempty"`
}
type PaymentAttempt struct {
	ID                   string `json:"id"`
	Operation            string `json:"operation"`
	AttemptNumber        int    `json:"attempt_number"`
	StartedAt            string `json:"started_at"`
	CompletedAt          string `json:"completed_at,omitempty"`
	Status               string `json:"status"`
	ProviderCode         string `json:"provider_code,omitempty"`
	NextReconciliationAt string `json:"next_reconciliation_at,omitempty"`
}
type PaymentIntentsResponse struct {
	PaymentIntents []PaymentIntent `json:"payment_intents"`
	Pagination     Pagination      `json:"pagination"`
}
type PaymentIntentResponse struct {
	PaymentIntent PaymentIntent    `json:"payment_intent"`
	Attempts      []PaymentAttempt `json:"attempts,omitempty"`
	Duplicate     bool             `json:"duplicate,omitempty"`
	PaymentAction *PaymentAction   `json:"payment_action,omitempty"`
}
type PaymentAction struct {
	Method string            `json:"method"`
	URL    string            `json:"url"`
	Fields map[string]string `json:"fields"`
}
type BillingDownload struct {
	ContentType, ContentDisposition, ETag string
	Body                                  []byte
}
type HTTPError struct {
	Method, Path string
	StatusCode   int
	Body         string
}

func (e *HTTPError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("upstream %s %s returned %d: %s", e.Method, e.Path, e.StatusCode, e.Body)
	}
	return fmt.Sprintf("upstream %s %s returned %d", e.Method, e.Path, e.StatusCode)
}

type Client struct {
	baseURL, serviceToken string
	httpClient            *http.Client
}

func New(baseURL, serviceToken string) *Client {
	return &Client{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), serviceToken: strings.TrimSpace(serviceToken), httpClient: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) Enabled() bool { return c != nil && c.baseURL != "" && len(c.serviceToken) >= 32 }

func (c *Client) BillingAccount(ctx context.Context, actorID, orgID string) (BillingAccountResponse, error) {
	var out BillingAccountResponse
	err := c.do(ctx, "GET", orgPath(orgID, "/billing/account"), actorID, "billing_account.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingSummary(ctx context.Context, actorID, orgID string) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", orgPath(orgID, "/billing/summary"), actorID, "billing_summary.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingUsage(ctx context.Context, actorID, orgID string, query url.Values) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/billing/usage"), query), actorID, "billing_usage.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingInvoices(ctx context.Context, actorID, orgID string, query url.Values) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/billing/invoices"), query), actorID, "invoice.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingInvoice(ctx context.Context, actorID, orgID, invoiceID string) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", orgPath(orgID, "/billing/invoices/")+url.PathEscape(invoiceID), actorID, "invoice.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingActivity(ctx context.Context, actorID, orgID string, query url.Values) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/billing/activity"), query), actorID, "billing_activity.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingActivityDetail(ctx context.Context, actorID, orgID, activityID string) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", orgPath(orgID, "/billing/activity/")+url.PathEscape(activityID), actorID, "billing_activity.read", nil, &out, nil)
	return out, err
}
func (c *Client) BillingProfile(ctx context.Context, actorID, orgID string) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "GET", orgPath(orgID, "/billing/profile"), actorID, "billing_profile.read", nil, &out, nil)
	return out, err
}
func (c *Client) PutBillingProfile(ctx context.Context, actorID, orgID, version string, request any) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "PUT", orgPath(orgID, "/billing/profile"), actorID, "billing_profile.manage", request, &out, map[string]string{"If-Match": version})
	return out, err
}
func (c *Client) BillingLedger(ctx context.Context, actorID, orgID string, query url.Values) (BillingLedgerResponse, error) {
	var out BillingLedgerResponse
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/billing/ledger"), query), actorID, "billing_ledger.read", nil, &out, nil)
	return out, err
}
func (c *Client) PaymentMethods(ctx context.Context, actorID, orgID string, query url.Values) (PaymentMethodsResponse, error) {
	var out PaymentMethodsResponse
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/payment-methods"), query), actorID, "payment_method.read", nil, &out, nil)
	return out, err
}
func (c *Client) SetupPaymentMethod(ctx context.Context, actorID, orgID, key string, request any) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "POST", orgPath(orgID, "/payment-methods/setup"), actorID, "payment_method.manage", request, &out, map[string]string{"Idempotency-Key": key})
	return out, err
}
func (c *Client) RevokePaymentMethod(ctx context.Context, actorID, orgID, methodID string, request any) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, "DELETE", orgPath(orgID, "/payment-methods/")+url.PathEscape(methodID), actorID, "payment_method.manage", request, &out, nil)
	return out, err
}
func (c *Client) AutoTopUp(ctx context.Context, actorID, orgID string) (AutoTopUpResponse, string, error) {
	var out AutoTopUpResponse
	headers, err := c.doHeaders(ctx, "GET", orgPath(orgID, "/auto-topup"), actorID, "auto_topup.read", nil, &out, nil)
	return out, headers.Get("ETag"), err
}
func (c *Client) PutAutoTopUp(ctx context.Context, actorID, orgID, version string, request any) (AutoTopUpResponse, string, error) {
	var out AutoTopUpResponse
	headers, err := c.doHeaders(ctx, "PUT", orgPath(orgID, "/auto-topup"), actorID, "auto_topup.manage", request, &out, map[string]string{"If-Match": version})
	return out, headers.Get("ETag"), err
}
func (c *Client) DisableAutoTopUp(ctx context.Context, actorID, orgID, version string, request any) (AutoTopUpResponse, string, error) {
	var out AutoTopUpResponse
	headers, err := c.doHeaders(ctx, "DELETE", orgPath(orgID, "/auto-topup"), actorID, "auto_topup.manage", request, &out, map[string]string{"If-Match": version})
	return out, headers.Get("ETag"), err
}
func (c *Client) CreateManualTopUp(ctx context.Context, actorID, orgID, key string, request any) (PaymentIntentResponse, error) {
	var out PaymentIntentResponse
	err := c.do(ctx, "POST", orgPath(orgID, "/topups"), actorID, "payment_intent.create", request, &out, map[string]string{"Idempotency-Key": key})
	return out, err
}
func (c *Client) CreateHostedTopUp(ctx context.Context, actorID, orgID, key string, request any) (PaymentIntentResponse, error) {
	var out PaymentIntentResponse
	err := c.do(ctx, "POST", orgPath(orgID, "/topups/checkout"), actorID, "payment_intent.create", request, &out, map[string]string{"Idempotency-Key": key})
	return out, err
}
func (c *Client) PaymentIntents(ctx context.Context, actorID, orgID string, query url.Values) (PaymentIntentsResponse, error) {
	var out PaymentIntentsResponse
	err := c.do(ctx, "GET", withQuery(orgPath(orgID, "/payment-intents"), query), actorID, "payment_intent.read", nil, &out, nil)
	return out, err
}
func (c *Client) PaymentIntent(ctx context.Context, actorID, orgID, intentID string) (PaymentIntentResponse, error) {
	var out PaymentIntentResponse
	err := c.do(ctx, "GET", orgPath(orgID, "/payment-intents/")+url.PathEscape(intentID), actorID, "payment_intent.read", nil, &out, nil)
	return out, err
}

func (c *Client) BillingDownload(ctx context.Context, actorID, orgID, suffix string) (BillingDownload, error) {
	if !c.Enabled() {
		return BillingDownload{}, fmt.Errorf("billing service is not configured")
	}
	path := orgPath(orgID, suffix)
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+path, nil)
	if err != nil {
		return BillingDownload{}, err
	}
	c.headers(req, actorID, downloadPermission(suffix))
	correlation.ApplyHeaders(ctx, req)
	response, err := c.httpClient.Do(req)
	if err != nil {
		return BillingDownload{}, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return BillingDownload{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return BillingDownload{}, &HTTPError{Method: "GET", Path: path, StatusCode: response.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	return BillingDownload{ContentType: response.Header.Get("Content-Type"), ContentDisposition: response.Header.Get("Content-Disposition"), ETag: response.Header.Get("ETag"), Body: body}, nil
}

func (c *Client) do(ctx context.Context, method, path, actorID, permission string, in, out any, headers map[string]string) error {
	_, err := c.doHeaders(ctx, method, path, actorID, permission, in, out, headers)
	return err
}
func (c *Client) doHeaders(ctx context.Context, method, path, actorID, permission string, in, out any, headers map[string]string) (http.Header, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("billing service is not configured")
	}
	var body io.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c.headers(req, actorID, permission)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	correlation.ApplyHeaders(ctx, req)
	response, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return response.Header, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return response.Header, &HTTPError{Method: method, Path: path, StatusCode: response.StatusCode, Body: strings.TrimSpace(string(data))}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return response.Header, err
		}
	}
	return response.Header, nil
}

func (c *Client) headers(req *http.Request, actorID, permission string) {
	req.Header.Set("Authorization", "Bearer "+c.serviceToken)
	req.Header.Set("X-Billing-Actor-Type", "user")
	req.Header.Set("X-Billing-Actor-ID", actorID)
	req.Header.Set("X-Billing-Permissions", permission)
}
func orgPath(orgID, suffix string) string { return "/v1/orgs/" + url.PathEscape(orgID) + suffix }
func withQuery(path string, query url.Values) string {
	if len(query) == 0 {
		return path
	}
	return path + "?" + query.Encode()
}
func downloadPermission(suffix string) string {
	if strings.Contains(suffix, "/invoices/") {
		return "invoice_document.read"
	}
	return "billing_statement.export"
}
