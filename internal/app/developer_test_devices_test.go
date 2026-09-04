package app

import (
	"archive/zip"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestServerGeneratedTestDeviceDownloads(t *testing.T) {
	for _, tc := range []struct {
		name                                           string
		quantity, allocationFailure, enrollmentFailure int
		inactive, runFailure                           bool
		want                                           int
	}{
		{name: "single", quantity: 1, want: 200},
		{name: "default quantity", want: 200},
		{name: "partial batch", quantity: 3, allocationFailure: 2, enrollmentFailure: 3, want: 200},
		{name: "quantity limit", quantity: 11, want: 400},
		{name: "inactive product", quantity: 1, inactive: true, want: 400},
		{name: "production run unavailable", quantity: 1, runFailure: true, want: 502},
		{name: "allocation failure", quantity: 1, allocationFailure: 1, want: 502},
		{name: "enrollment failure", quantity: 1, enrollmentFailure: 1, want: 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			allocated, enrolled := 0, 0
			ca, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/device-item-profiles/profile-1"):
					status := "active"
					if tc.inactive {
						status = "disabled"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"device_item_profile": map[string]any{"id": "profile-1", "status": status, "category": "ip_camera", "service_options": []string{"video"}}})
				case strings.HasSuffix(r.URL.Path, "/production-runs"):
					if tc.runFailure {
						http.Error(w, "unavailable", 503)
						return
					}
					var body map[string]any
					if json.NewDecoder(r.Body).Decode(&body) != nil {
						t.Error("invalid run request")
						return
					}
					wantQuantity := tc.quantity
					if wantQuantity < 1 {
						wantQuantity = 1
					}
					if body["allowed_quantity"] != float64(wantQuantity) {
						t.Error("incorrect production run quantity")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"production_run": map[string]any{"id": "run-1"}, "factory_jwt": "factory-jwt"})
				case r.Method == http.MethodPost && r.URL.Path == "/v1/orgs/brand-1/devices":
					allocated++
					var body map[string]any
					if json.NewDecoder(r.Body).Decode(&body) != nil {
						t.Error("invalid allocation request")
						return
					}
					if body["device_item_profile_id"] != "profile-1" {
						t.Error("missing product association")
					}
					if r.Header.Get("Idempotency-Key") == "" {
						t.Error("missing allocation idempotency key")
					}
					if allocated == tc.allocationFailure {
						http.Error(w, "unavailable", 503)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"device": map[string]any{"id": fmt.Sprintf("allocated-%d", allocated), "organization_id": "brand-1"}})
				default:
					t.Errorf("unexpected account route %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer account.Close()
			factory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				enrolled++
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("invalid enrollment request")
					return
				}
				id, _ := body["devid"].(string)
				if id == fmt.Sprintf("allocated-%d", tc.enrollmentFailure) {
					http.Error(w, "unavailable", 503)
					return
				}
				csrPEM, _ := body["csr_pem"].(string)
				block, _ := pem.Decode([]byte(csrPEM))
				if block == nil {
					t.Error("missing generated CSR")
					return
				}
				csr, parseErr := x509.ParseCertificateRequest(block.Bytes)
				if parseErr != nil || csr.CheckSignature() != nil {
					t.Error("invalid generated CSR")
					return
				}
				if csr.Subject.CommonName != id || body["ttl_days"] != float64(30) {
					t.Error("incorrect identity or lifetime")
				}
				cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: csr.Subject, NotBefore: time.Now(), NotAfter: time.Now().Add(30 * 24 * time.Hour)}
				der, signErr := x509.CreateCertificate(rand.Reader, cert, cert, csr.PublicKey, ca)
				if signErr != nil {
					t.Error(signErr)
					return
				}
				leaf := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
				_ = json.NewEncoder(w).Encode(map[string]any{"certificate_bundle": map[string]any{"identity": map[string]any{"id": id}, "key": map[string]any{}, "certificate": map[string]any{"chain_pem": []string{leaf}}}})
			}))
			defer factory.Close()
			srv, session := newDeveloperPKITestServer(t, account.URL, factory.URL)
			body := fmt.Sprintf(`{"brand_cloud_id":"brand-1","device_item_profile_id":"profile-1","quantity":%d}`, tc.quantity)
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, developerPKIRequest(t, session, "/api/developer/test-device-batches", "new-request", body))
			if rec.Code != tc.want {
				t.Fatalf("status %d, want %d", rec.Code, tc.want)
			}
			if tc.quantity > 10 || tc.inactive || tc.runFailure {
				if allocated != 0 || enrolled != 0 {
					t.Fatal("rejected request performed allocation or enrollment")
				}
			}
			if rec.Code != 200 {
				return
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("download is cacheable")
			}
			var bundle map[string]any
			if tc.quantity <= 1 {
				if rec.Header().Get("Content-Type") != certificateBundleMIME {
					t.Fatal("expected JSON bundle")
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &bundle); err != nil {
					t.Fatal(err)
				}
			} else {
				if rec.Header().Get("Content-Type") != "application/zip" {
					t.Fatal("expected ZIP")
				}
				archive, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
				if err != nil {
					t.Fatal(err)
				}
				files := map[string][]byte{}
				for _, f := range archive.File {
					reader, err := f.Open()
					if err != nil {
						t.Fatal(err)
					}
					files[f.Name], err = io.ReadAll(reader)
					_ = reader.Close()
					if err != nil {
						t.Fatal(err)
					}
				}
				if len(files) != 4 {
					t.Fatalf("expected only successful device files and index, got %d", len(files))
				}
				if len(files["devices/allocated-1/device.crt"]) == 0 || len(files["devices/allocated-1/device.key"]) == 0 {
					t.Fatal("missing PEM files")
				}
				if err := json.Unmarshal(files["devices/allocated-1/certificate-bundle.json"], &bundle); err != nil {
					t.Fatal(err)
				}
				var index struct {
					Items []struct{ Status, Error string }
				}
				if err := json.Unmarshal(files["index.json"], &index); err != nil {
					t.Fatal(err)
				}
				if len(index.Items) != 3 || index.Items[0].Status != "ready" || index.Items[1].Error != "device allocation failed" || index.Items[2].Error != "certificate issuance failed" {
					t.Fatal("incorrect partial failure index")
				}
			}
			keyPEM := bundle["key"].(map[string]any)["material"].(map[string]any)["private_key_pem"].(string)
			keyBlock, _ := pem.Decode([]byte(keyPEM))
			if keyBlock == nil {
				t.Fatal("missing exported private key")
			}
			key, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
			if err != nil {
				t.Fatal(err)
			}
			leafPEM := bundle["certificate"].(map[string]any)["chain_pem"].([]any)[0].(string)
			leafBlock, _ := pem.Decode([]byte(leafPEM))
			leaf, err := x509.ParseCertificate(leafBlock.Bytes)
			if err != nil {
				t.Fatal(err)
			}
			if !key.(*ecdsa.PrivateKey).PublicKey.Equal(leaf.PublicKey) || leaf.Subject.CommonName != "allocated-1" {
				t.Fatal("downloaded credentials do not match allocated identity")
			}
		})
	}
}
