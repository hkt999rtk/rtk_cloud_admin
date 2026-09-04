package app

import (
	"archive/zip"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"rtk_cloud_admin/internal/accountclient"
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
	Quantity     int    `json:"quantity,omitempty"`
	// Deprecated compatibility fields; new clients never send these.
	DeviceID     string `json:"device_id,omitempty"`
	SerialNumber string `json:"serial_number,omitempty"`
	CSRPEM       string `json:"csr_pem,omitempty"`
}

func generateDeviceCSR(deviceID string) (csrPEM, privateKeyPEM string, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: deviceID}, DNSNames: []string{deviceID}}, key)
	if err != nil {
		return "", "", err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr})), string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})), nil
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
	if session.ActiveOrgID != body.BrandCloudID || body.ProfileID == "" {
		http.Error(w, "invalid or cross-Brand-Cloud request", http.StatusForbidden)
		return
	}
	if body.Quantity < 1 {
		body.Quantity = 1
	}
	if body.Quantity > 10 {
		http.Error(w, "quantity must be between 1 and 10", http.StatusBadRequest)
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
	run, err := s.accountClient.CreateDeveloperPKITestProductionRunWithQuantity(r.Context(), session.AccessToken, body.BrandCloudID, body.ProfileID, testID, body.Quantity, now.Add(-time.Minute), now.Add(30*time.Minute))
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if body.DeviceID != "" && body.CSRPEM != "" {
		payload, _ := json.Marshal(map[string]any{"request_id": "developer-pki-device-" + testID, "devid": body.DeviceID, "serial_number": body.SerialNumber, "csr_pem": body.CSRPEM, "factory_id": "developer-console", "batch_id": "pki-test-" + testID, "production_run_id": run.ProductionRun.ID, "service_options": profile.ServiceOptions, "ttl_days": 30})
		bundle, enrollErr := issueDeveloperDeviceBundle(r, run.FactoryJWT, payload, s.cfg.FactoryEnrollBaseURL)
		if enrollErr != nil {
			http.Error(w, "certificate issuance failed", http.StatusBadGateway)
			return
		}
		writeCertificateBundleJSON(w, bundle)
		return
	}
	// The first implementation executes a bounded synchronous batch. IDs and
	// credentials are generated by the services, never supplied by the browser.
	results := make([]map[string]any, 0, body.Quantity)
	for i := 0; i < body.Quantity; i++ {
		device, createErr := s.accountClient.CreateDevice(r.Context(), session.AccessToken, body.BrandCloudID, key+fmt.Sprint("-device-", i), accountclient.DeviceCreateRequest{Name: "Test device", Category: profile.Category, Model: profile.Model, DeviceItemProfileID: body.ProfileID, Metadata: map[string]any{"purpose": "test"}})
		if createErr != nil {
			results = append(results, map[string]any{"status": "failed", "error": "device allocation failed"})
			continue
		}
		csrPEM, privateKeyPEM, genErr := generateDeviceCSR(device.ID)
		if genErr != nil {
			results = append(results, map[string]any{"device_id": device.ID, "status": "failed", "error": "credential generation failed"})
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"request_id": "developer-pki-device-" + testID + "-" + device.ID, "devid": device.ID, "serial_number": device.ID,
			"csr_pem": csrPEM, "factory_id": "developer-console", "batch_id": "pki-test-" + testID,
			"production_run_id": run.ProductionRun.ID, "service_options": profile.ServiceOptions, "ttl_days": 30,
		})
		bundle, enrollErr := issueDeveloperDeviceBundle(r, run.FactoryJWT, payload, s.cfg.FactoryEnrollBaseURL)
		if enrollErr != nil {
			results = append(results, map[string]any{"device_id": device.ID, "status": "failed", "error": "certificate issuance failed"})
			continue
		}
		bundle["profile"] = "test_exportable"
		if keyObj, ok := bundle["key"].(map[string]any); ok {
			keyObj["material"] = map[string]any{"type": "embedded_pkcs8_pem", "private_key_pem": privateKeyPEM}
			bundle["key"] = keyObj
		}
		results = append(results, map[string]any{"device_id": device.ID, "status": "ready", "certificate_bundle": bundle})
	}
	if len(results) > 1 {
		writeTestDeviceBatchZIP(w, testID, results)
		return
	}
	if len(results) == 1 {
		if b, ok := results[0]["certificate_bundle"].(map[string]any); ok {
			writeCertificateBundleJSON(w, b)
			return
		}
	}
	http.Error(w, "test device provisioning failed", http.StatusBadGateway)
	return
}

func writeTestDeviceBatchZIP(w http.ResponseWriter, batchID string, items []map[string]any) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	index := make([]map[string]any, 0, len(items))
	for _, item := range items {
		id, _ := item["device_id"].(string)
		status, _ := item["status"].(string)
		entry := map[string]any{"device_id": id, "status": status}
		if bundle, ok := item["certificate_bundle"].(map[string]any); ok {
			f, err := zw.Create("devices/" + id + "/certificate-bundle.json")
			if err == nil {
				_ = json.NewEncoder(f).Encode(bundle)
			}
			if cert, ok := bundle["certificate"].(map[string]any); ok {
				if chain, ok := cert["chain_pem"].([]any); ok && len(chain) > 0 {
					if leaf, ok := chain[0].(string); ok {
						if f, err := zw.Create("devices/" + id + "/device.crt"); err == nil {
							_, _ = f.Write([]byte(leaf))
						}
					}
				}
			}
			if key, ok := bundle["key"].(map[string]any); ok {
				if material, ok := key["material"].(map[string]any); ok {
					if privateKey, ok := material["private_key_pem"].(string); ok {
						if f, err := zw.Create("devices/" + id + "/device.key"); err == nil {
							_, _ = f.Write([]byte(privateKey))
						}
					}
				}
			}
		}
		if message, ok := item["error"].(string); ok {
			entry["error"] = message
		}
		index = append(index, entry)
	}
	if f, err := zw.Create("index.json"); err == nil {
		_ = json.NewEncoder(f).Encode(map[string]any{"batch_id": batchID, "items": index})
	}
	_ = zw.Close()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="rtk-test-devices-`+batchID+`.zip"`)
	_, _ = w.Write(buf.Bytes())
}

func issueDeveloperDeviceBundle(r *http.Request, jwt string, payload []byte, rawBaseURL string) (map[string]any, error) {
	base, err := url.Parse(strings.TrimRight(rawBaseURL, "/"))
	if err != nil {
		return nil, err
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/factory/enroll"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	result, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("factory enrollment failed")
	}
	var envelope struct {
		CertificateBundle map[string]any `json:"certificate_bundle"`
	}
	if err := json.Unmarshal(result, &envelope); err != nil || envelope.CertificateBundle == nil {
		return nil, fmt.Errorf("factory enrollment returned no certificate bundle")
	}
	return envelope.CertificateBundle, nil
}

func writeCertificateBundleJSON(w http.ResponseWriter, bundle any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", certificateBundleMIME)
	if err := json.NewEncoder(w).Encode(bundle); err != nil {
		http.Error(w, "failed to encode certificate bundle", http.StatusInternalServerError)
	}
}
