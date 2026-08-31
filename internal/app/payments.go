package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/billingclient"
	"rtk_cloud_admin/internal/store"
)

type paymentBFFContext struct {
	context context.Context
	session store.Session
	org     accountclient.Organization
	actorID string
}

func (s *Server) paymentContext(w http.ResponseWriter, r *http.Request, permission string) (paymentBFFContext, bool) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := s.requestSession(r)
	if !ok || session.AccessToken == "" || (session.Kind != "account" && session.Kind != "customer" && session.Kind != "platform_admin") {
		http.Error(w, "global account authentication required", http.StatusUnauthorized)
		return paymentBFFContext{}, false
	}
	if s.billingClient == nil || !s.billingClient.Enabled() {
		http.Error(w, "Billing service is not configured", http.StatusServiceUnavailable)
		return paymentBFFContext{}, false
	}
	cloudID := r.PathValue("brandCloudID")
	if !managedCloudUUID.MatchString(cloudID) {
		http.Error(w, "explicit cloud scope required", 400)
		return paymentBFFContext{}, false
	}
	if r.Method != http.MethodGet && !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", 403)
		return paymentBFFContext{}, false
	}
	detail, err := s.accountClient.ManagedCloudCommand(r.Context(), session.AccessToken, http.MethodGet, cloudID, "", "", nil)
	if err != nil {
		s.managedCloudError(w, session.ID, err)
		return paymentBFFContext{}, false
	}
	cloud := detail.BrandCloud
	if cloud.MyRole != "owner" || cloud.OwnerUserID != session.Subject || !hasCapability(cloud.Capabilities, permission) {
		http.Error(w, "current cloud owner required", 403)
		return paymentBFFContext{}, false
	}
	if r.Method != http.MethodGet && (len(r.Header.Values("X-Cloud-Ownership-Version")) != 1 || r.Header.Get("X-Cloud-Ownership-Version") != strconv.FormatInt(cloud.OwnershipVersion, 10)) {
		http.Error(w, "ownership changed; refresh before writing", http.StatusConflict)
		return paymentBFFContext{}, false
	}
	ctx, err := billingclient.WithOwnership(r.Context(), cloudID, session.Subject, cloud.OwnershipVersion)
	if err != nil {
		http.Error(w, "Billing ownership evidence unavailable", 502)
		return paymentBFFContext{}, false
	}
	w.Header().Set("X-Cloud-Ownership-Version", strconv.FormatInt(cloud.OwnershipVersion, 10))
	return paymentBFFContext{context: ctx, session: session, org: accountclient.Organization{ID: cloudID}, actorID: session.Subject}, true
}

func (s *Server) apiBillingAccount(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_account.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingAccount(ctx.context, ctx.actorID, ctx.org.ID)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	if result.Account.OrganizationID != ctx.org.ID {
		http.Error(w, "invalid Billing account scope", 502)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingSummary(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_summary.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingSummary(ctx.context, ctx.actorID, ctx.org.ID)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingUsage(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_usage.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingUsage(ctx.context, ctx.actorID, ctx.org.ID, boundedBillingQuery(r, "period_start", "period_end"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingInvoices(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "invoice.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingInvoices(ctx.context, ctx.actorID, ctx.org.ID, boundedBillingQuery(r, "limit", "offset", "state", "invoice_number", "period_start", "period_end"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingInvoice(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "invoice.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingInvoice(ctx.context, ctx.actorID, ctx.org.ID, r.PathValue("invoiceId"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingInvoicePDF(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "invoice_document.read")
	if !ok {
		return
	}
	download, err := s.billingClient.BillingDownload(ctx.context, ctx.actorID, ctx.org.ID, "/billing/invoices/"+url.PathEscape(r.PathValue("invoiceId"))+"/pdf")
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="invoice.pdf"`)
	if download.ETag != "" {
		w.Header().Set("ETag", download.ETag)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(download.Body)
}

func (s *Server) apiBillingActivity(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_activity.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingActivity(ctx.context, ctx.actorID, ctx.org.ID, boundedBillingQuery(r, "limit", "offset", "state", "type", "reference"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingActivityDetail(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_activity.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingActivityDetail(ctx.context, ctx.actorID, ctx.org.ID, r.PathValue("activityId"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingProfile(w http.ResponseWriter, r *http.Request) {
	permission := "billing_profile.read"
	if r.Method == http.MethodPut {
		permission = "billing_profile.manage"
	}
	ctx, ok := s.paymentContext(w, r, permission)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		result, err := s.billingClient.BillingProfile(ctx.context, ctx.actorID, ctx.org.ID)
		if err != nil {
			s.writePaymentBFFError(w, ctx.session.ID, err)
			return
		}
		writeJSON(w, result)
		return
	}
	var request struct {
		LegalName          string `json:"legal_name"`
		TaxIdentifier      string `json:"tax_identifier"`
		BillingAddress     string `json:"billing_address"`
		ContactEmail       string `json:"contact_email"`
		Locale             string `json:"locale"`
		Timezone           string `json:"timezone"`
		DeliveryPreference string `json:"delivery_preference"`
		Version            int64  `json:"version"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	if strings.TrimSpace(request.LegalName) == "" || request.Version < 1 {
		writeInvalidPaymentRequest(w)
		return
	}
	result, err := s.billingClient.PutBillingProfile(ctx.context, ctx.actorID, ctx.org.ID, `"`+strconv.FormatInt(request.Version, 10)+`"`, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiBillingStatement(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_statement.export")
	if !ok {
		return
	}
	suffix := "/billing/statements"
	if query := boundedBillingQuery(r, "period_start", "period_end"); len(query) > 0 {
		suffix += "?" + query.Encode()
	}
	download, err := s.billingClient.BillingDownload(ctx.context, ctx.actorID, ctx.org.ID, suffix)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="billing-statement.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(download.Body)
}

func (s *Server) apiBillingLedger(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "billing_ledger.read")
	if !ok {
		return
	}
	result, err := s.billingClient.BillingLedger(ctx.context, ctx.actorID, ctx.org.ID, boundedPaymentQuery(r))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiPaymentMethods(w http.ResponseWriter, r *http.Request) {
	permission := "payment_method.read"
	if r.Method != http.MethodGet {
		permission = "payment_method.manage"
	}
	ctx, ok := s.paymentContext(w, r, permission)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		result, err := s.billingClient.PaymentMethods(ctx.context, ctx.actorID, ctx.org.ID, boundedPaymentQuery(r))
		if err != nil {
			s.writePaymentBFFError(w, ctx.session.ID, err)
			return
		}
		writeJSON(w, result)
		return
	}
	idempotencyKey, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var request struct {
		Provider string `json:"provider"`
		Consent  struct {
			Accepted    bool   `json:"accepted"`
			TextVersion string `json:"text_version"`
			TextSHA256  string `json:"text_sha256"`
			Locale      string `json:"locale"`
		} `json:"consent"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	if strings.TrimSpace(request.Provider) == "" || !request.Consent.Accepted ||
		len(strings.TrimSpace(request.Consent.TextVersion)) == 0 || len(strings.TrimSpace(request.Consent.TextVersion)) > 128 ||
		!validPaymentSHA256(request.Consent.TextSHA256) || len(strings.TrimSpace(request.Consent.Locale)) < 2 || len(strings.TrimSpace(request.Consent.Locale)) > 35 {
		writeInvalidPaymentRequest(w)
		return
	}
	result, err := s.billingClient.SetupPaymentMethod(ctx.context, ctx.actorID, ctx.org.ID, idempotencyKey, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, result)
}

func validPaymentSHA256(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			if character < 'a' || character > 'f' {
				return false
			}
		}
	}
	return true
}

func (s *Server) apiPaymentMethod(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "payment_method.manage")
	if !ok {
		return
	}
	methodID := strings.TrimSpace(r.PathValue("methodId"))
	var request struct {
		Reason string `json:"reason"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	if methodID == "" || len(strings.TrimSpace(request.Reason)) < 3 {
		writeInvalidPaymentRequest(w)
		return
	}
	result, err := s.billingClient.RevokePaymentMethod(ctx.context, ctx.actorID, ctx.org.ID, methodID, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiAutoTopUp(w http.ResponseWriter, r *http.Request) {
	permission := "auto_topup.read"
	if r.Method != http.MethodGet {
		permission = "auto_topup.manage"
	}
	ctx, ok := s.paymentContext(w, r, permission)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		result, etag, err := s.billingClient.AutoTopUp(ctx.context, ctx.actorID, ctx.org.ID)
		if err != nil {
			s.writePaymentBFFError(w, ctx.session.ID, err)
			return
		}
		if etag != "" {
			w.Header().Set("ETag", etag)
		}
		writeJSON(w, result)
		return
	}
	version := strings.TrimSpace(r.Header.Get("If-Match"))
	if version == "" {
		writeJSONStatus(w, http.StatusPreconditionRequired, map[string]any{"code": "AUTO_TOPUP_POLICY_CONFLICT", "message": "If-Match is required."})
		return
	}
	if r.Method == http.MethodPut {
		var request autoTopUpBFFRequest
		if !decodePaymentRequest(w, r, &request) {
			return
		}
		result, etag, err := s.billingClient.PutAutoTopUp(ctx.context, ctx.actorID, ctx.org.ID, version, request)
		if err != nil {
			s.writePaymentBFFError(w, ctx.session.ID, err)
			return
		}
		if etag != "" {
			w.Header().Set("ETag", etag)
		}
		writeJSON(w, result)
		return
	}
	var request struct {
		Reason string `json:"reason"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	if len(strings.TrimSpace(request.Reason)) < 3 {
		writeInvalidPaymentRequest(w)
		return
	}
	result, etag, err := s.billingClient.DisableAutoTopUp(ctx.context, ctx.actorID, ctx.org.ID, version, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	if etag != "" {
		w.Header().Set("ETag", etag)
	}
	writeJSON(w, result)
}

type autoTopUpBFFRequest struct {
	Enabled               bool   `json:"enabled"`
	ThresholdMinor        int64  `json:"threshold_minor"`
	TopUpAmountMinor      int64  `json:"top_up_amount_minor"`
	Currency              string `json:"currency"`
	PaymentMethodID       string `json:"payment_method_id"`
	DailyAttemptLimit     int    `json:"daily_attempt_limit"`
	DailyAmountLimitMinor int64  `json:"daily_amount_limit_minor"`
	CooldownSeconds       int64  `json:"cooldown_seconds"`
	Consent               struct {
		Accepted    bool   `json:"accepted"`
		TextVersion string `json:"text_version"`
		TextSHA256  string `json:"text_sha256"`
		Locale      string `json:"locale"`
	} `json:"consent"`
}

func (s *Server) apiManualTopUp(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "payment_intent.create")
	if !ok {
		return
	}
	idempotencyKey, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var request struct {
		AmountMinor     int64  `json:"amount_minor"`
		Currency        string `json:"currency"`
		PaymentMethodID string `json:"payment_method_id"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	result, err := s.billingClient.CreateManualTopUp(ctx.context, ctx.actorID, ctx.org.ID, idempotencyKey, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, result)
}

func (s *Server) apiHostedTopUp(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "payment_intent.create")
	if !ok {
		return
	}
	idempotencyKey, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var request struct {
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		Provider    string `json:"provider"`
	}
	if !decodePaymentRequest(w, r, &request) {
		return
	}
	result, err := s.billingClient.CreateHostedTopUp(ctx.context, ctx.actorID, ctx.org.ID, idempotencyKey, request)
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSONStatus(w, http.StatusAccepted, result)
}

func (s *Server) apiPaymentIntents(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "payment_intent.read")
	if !ok {
		return
	}
	result, err := s.billingClient.PaymentIntents(ctx.context, ctx.actorID, ctx.org.ID, boundedPaymentQuery(r))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func (s *Server) apiPaymentIntent(w http.ResponseWriter, r *http.Request) {
	ctx, ok := s.paymentContext(w, r, "payment_intent.read")
	if !ok {
		return
	}
	result, err := s.billingClient.PaymentIntent(ctx.context, ctx.actorID, ctx.org.ID, r.PathValue("intentId"))
	if err != nil {
		s.writePaymentBFFError(w, ctx.session.ID, err)
		return
	}
	writeJSON(w, result)
}

func boundedPaymentQuery(r *http.Request) url.Values {
	values := url.Values{}
	for _, key := range []string{"limit", "offset"} {
		if value := strings.TrimSpace(r.URL.Query().Get(key)); value != "" {
			values.Set(key, value)
		}
	}
	return values
}

func boundedBillingQuery(r *http.Request, keys ...string) url.Values {
	values := url.Values{}
	for _, key := range keys {
		if value := strings.TrimSpace(r.URL.Query().Get(key)); value != "" {
			values.Set(key, value)
		}
	}
	return values
}

func decodePaymentRequest(w http.ResponseWriter, r *http.Request, destination any) bool {
	if err := decodeStrictManagedJSON(w, r, destination); err != nil {
		writeInvalidPaymentRequest(w)
		return false
	}
	return true
}

func writeInvalidPaymentRequest(w http.ResponseWriter) {
	writeJSONStatus(w, http.StatusBadRequest, map[string]any{"code": "INVALID_PAYMENT_REQUEST", "message": "Invalid payment request."})
}

func (s *Server) writePaymentBFFError(w http.ResponseWriter, sessionID string, err error) {
	var upstream *billingclient.HTTPError
	if errors.As(err, &upstream) {
		var envelope struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Error   struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(upstream.Body), &envelope) == nil {
			if envelope.Code == "" {
				envelope.Code = envelope.Error.Code
				envelope.Message = envelope.Error.Message
			}
		}
		ownershipErrors := map[string]int{"BILLING_OWNER_REQUIRED": 403, "BILLING_OWNERSHIP_VERSION_CONFLICT": 409, "BILLING_OWNERSHIP_TRANSITION": 409, "BILLING_SNAPSHOT_CONFLICT": 409, "BILLING_OWNERSHIP_UNAVAILABLE": 503, "BILLING_OWNERSHIP_CONTEXT_REQUIRED": 502}
		if status, ok := ownershipErrors[envelope.Code]; ok {
			writeJSONStatus(w, status, map[string]any{"code": envelope.Code, "message": "Current Billing ownership evidence is required; refresh this cloud before continuing."})
			return
		}
		if paymentErrorCodeAllowed(envelope.Code) {
			status := upstream.StatusCode
			if status < 400 || status > 499 {
				status = http.StatusBadGateway
			}
			writeJSONStatus(w, status, map[string]any{"code": envelope.Code, "message": envelope.Message})
			return
		}
	}
	s.writeCustomerErrorForSession(w, sessionID, err)
}

func paymentErrorCodeAllowed(code string) bool {
	switch code {
	case "PAYMENT_PROVIDER_UNAVAILABLE", "PAYMENT_PROVIDER_NOT_CONFIGURED", "PAYMENT_CAPABILITY_UNSUPPORTED",
		"PAYMENT_METHOD_REQUIRED", "PAYMENT_METHOD_INACTIVE", "PAYMENT_METHOD_SETUP_CONFLICT",
		"PAYMENT_CONSENT_REQUIRED", "PAYMENT_AMOUNT_INVALID", "PAYMENT_PROVIDER_RESPONSE_INVALID",
		"PAYMENT_REFERENCE_PROTECTION_UNCONFIGURED", "PAYMENT_REFERENCE_PROTECTION_FAILED",
		"PAYMENT_CURRENCY_UNSUPPORTED", "PAYMENT_INTENT_CONFLICT", "PAYMENT_STATUS_UNKNOWN",
		"AUTO_TOPUP_POLICY_CONFLICT", "AUTO_TOPUP_LIMIT_REACHED", "BILLING_ACCOUNT_SUSPENDED",
		"BILLING_RESOURCE_NOT_FOUND", "BILLING_CONFLICT", "BILLING_INCOMPLETE", "INVOICE_IMMUTABLE",
		"idempotency_key_required", "invalid_request", "not_found":
		return true
	default:
		return false
	}
}
