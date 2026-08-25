package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const certificateBundleMIME = "application/vnd.realtek.rtk-certificate-bundle+json"

type developerPKIAppRequest struct {
	BrandCloudID string `json:"brand_cloud_id"`
	TargetType   string `json:"target_type"`
	TargetID     string `json:"target_id"`
	CSRPEM       string `json:"csr_pem"`
}

type developerPKIDeviceRequest struct {
	BrandCloudID string `json:"brand_cloud_id"`
	ProfileID    string `json:"device_item_profile_id"`
	DeviceID     string `json:"device_id"`
	SerialNumber string `json:"serial_number"`
	CSRPEM       string `json:"csr_pem"`
}

func (s *Server) developerPKIAllowed(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.cfg.DeveloperPKITestToolsEnabled || strings.EqualFold(s.cfg.Environment, "production") || strings.EqualFold(s.cfg.Environment, "prod") {
		http.Error(w, "PKI test tools are unavailable", http.StatusNotFound)
		return "", false
	}
	key, ok := requireIdempotencyKey(w, r)
	return key, ok
}

func (s *Server) apiDeveloperPKITestAppBundle(w http.ResponseWriter, r *http.Request) {
	key, ok := s.developerPKIAllowed(w, r)
	if !ok {
		return
	}
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	var body developerPKIAppRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if session.ActiveOrgID != body.BrandCloudID {
		http.Error(w, "active Brand Cloud mismatch", http.StatusForbidden)
		return
	}
	bundle, err := s.accountClient.IssueDeveloperPKITestAppCertificate(r.Context(), session.AccessToken, body.BrandCloudID, key, body.TargetType, body.TargetID, body.CSRPEM)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	writeCertificateBundleJSON(w, bundle)
}

func (s *Server) apiDeveloperPKITestDeviceBundle(w http.ResponseWriter, r *http.Request) {
	key, ok := s.developerPKIAllowed(w, r)
	if !ok {
		return
	}
	session, ok := s.customerSession(r)
	if !ok {
		http.Error(w, "developer authentication required", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.FactoryEnrollBaseURL) == "" {
		http.Error(w, "factory enrollment is not configured", http.StatusServiceUnavailable)
		return
	}
	var body developerPKIDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if session.ActiveOrgID != body.BrandCloudID || body.ProfileID == "" || body.DeviceID == "" || body.SerialNumber == "" || body.CSRPEM == "" {
		http.Error(w, "invalid or cross-Brand-Cloud request", http.StatusForbidden)
		return
	}
	keyDigest := sha256.Sum256([]byte(key))
	testID := hex.EncodeToString(keyDigest[:16])
	now := time.Now().UTC()
	profile, err := s.accountClient.DeviceItemProfile(r.Context(), session.AccessToken, body.BrandCloudID, body.ProfileID)
	if err != nil || profile.Status != "active" {
		http.Error(w, "active device item profile is required", http.StatusBadRequest)
		return
	}
	run, err := s.accountClient.CreateDeveloperPKITestProductionRun(r.Context(), session.AccessToken, body.BrandCloudID, body.ProfileID, testID, now.Add(-time.Minute), now.Add(30*time.Minute))
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"request_id": "developer-pki-device-" + testID, "devid": body.DeviceID, "serial_number": body.SerialNumber,
		"csr_pem": body.CSRPEM, "factory_id": "developer-console", "batch_id": "pki-test-" + testID,
		"production_run_id": run.ProductionRun.ID, "service_options": profile.ServiceOptions, "ttl_days": 30,
	})
	base, err := url.Parse(strings.TrimRight(s.cfg.FactoryEnrollBaseURL, "/"))
	if err != nil {
		http.Error(w, "factory enrollment is not configured", http.StatusServiceUnavailable)
		return
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/factory/enroll"
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, base.String(), bytes.NewReader(payload))
	request.Header.Set("Authorization", "Bearer "+run.FactoryJWT)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		http.Error(w, "factory enrollment unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	result, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		http.Error(w, "factory enrollment rejected request", http.StatusBadGateway)
		return
	}
	var envelope struct {
		CertificateBundle map[string]any `json:"certificate_bundle"`
	}
	if json.Unmarshal(result, &envelope) != nil || envelope.CertificateBundle == nil {
		http.Error(w, "factory enrollment returned no certificate bundle", http.StatusBadGateway)
		return
	}
	writeCertificateBundleJSON(w, envelope.CertificateBundle)
}

func writeCertificateBundleJSON(w http.ResponseWriter, bundle any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", certificateBundleMIME)
	if err := json.NewEncoder(w).Encode(bundle); err != nil {
		http.Error(w, "failed to encode certificate bundle", http.StatusInternalServerError)
	}
}
