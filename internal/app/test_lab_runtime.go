package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type labSession struct {
	ID         string    `json:"id"`
	Cloud      string    `json:"brand_cloud_id"`
	Product    string    `json:"product_id"`
	Device     string    `json:"device_id"`
	Devid      string    `json:"devid"`
	Expires    time.Time `json:"expires_at"`
	Account    string    `json:"account_id"`
	mu         sync.Mutex
	stream     string
	closed     bool
	lastAction time.Time
	actions    int
}
type labCredentials struct {
	AccessToken string    `json:"access_token"`
	Expires     time.Time `json:"expires_at"`
	MQTT        struct {
		Username string `json:"username"`
		ClientID string `json:"client_id"`
	} `json:"mqtt"`
	AWS struct {
		AccessKey string `json:"accessKeyId"`
		Secret    string `json:"secretAccessKey"`
		Token     string `json:"sessionToken"`
		Region    string `json:"region"`
	} `json:"aws_credentials"`
}

var labShadowName = regexp.MustCompile(`^[$A-Za-z0-9:_-]{1,64}$`)

func (s *Server) apiTestLabSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor, ok := s.requestSession(r)
	if !ok || actor.AccessToken == "" || (actor.Kind != "account" && actor.Kind != "customer") {
		http.Error(w, "developer authentication required", 401)
		return
	}
	if !s.cfg.TestLabEnabled || s.cfg.Environment == "prod" || s.cfg.Environment == "production" {
		http.NotFound(w, r)
		return
	}
	if !managedCloudSameOrigin(r) {
		http.Error(w, "same-origin request required", 403)
		return
	}
	cloud, id, action := r.PathValue("brandCloudID"), r.PathValue("labID"), r.PathValue("action")
	if !managedCloudUUID.MatchString(cloud) || (id != "" && !managedCloudUUID.MatchString(id)) {
		http.Error(w, "invalid session scope", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	// Sweep expired in-memory bindings without preserving runtime credentials.
	s.testLabSessions.Range(func(key, value any) bool {
		if time.Now().After(value.(*labSession).Expires) {
			s.testLabSessions.Delete(key)
		}
		return true
	})
	if id == "" {
		var in struct {
			Product string `json:"product_id"`
			Device  string `json:"device_id"`
			Account string `json:"account_id"`
		}
		if decodeStrictManagedJSON(w, r, &in) != nil || !managedCloudUUID.MatchString(in.Product) || !managedCloudUUID.MatchString(in.Device) {
			http.Error(w, "invalid device scope", 400)
			return
		}
		if !managedCloudUUID.MatchString(in.Account) {
			http.Error(w, "test account authorization required", 400)
			return
		}
		raw, err := s.accountClient.TestLab(ctx, actor.AccessToken, cloud, "", "", "POST", map[string]string{"product_id": in.Product, "device_id": in.Device, "account_id": in.Account})
		if err != nil {
			s.managedCloudError(w, actor.ID, err)
			return
		}
		var lab labSession
		if json.Unmarshal(raw, &lab) != nil || !managedCloudUUID.MatchString(lab.ID) || lab.Cloud != cloud || lab.Product != in.Product || lab.Device != in.Device || !testLabDeviceID.MatchString(lab.Devid) || !lab.Expires.After(time.Now()) || lab.Expires.After(time.Now().Add(6*time.Minute)) {
			http.Error(w, "invalid runtime session", 502)
			return
		}
		if lab.Account != in.Account {
			http.Error(w, "invalid account scope", 502)
			return
		}
		s.testLabSessions.Store(actor.ID+":"+lab.ID, &lab)
		writeJSONStatus(w, 201, &lab)
		return
	}
	value, exists := s.testLabSessions.Load(actor.ID + ":" + id)
	if !exists {
		http.NotFound(w, r)
		return
	}
	lab := value.(*labSession)
	if lab.Cloud != cloud {
		http.NotFound(w, r)
		return
	}
	lab.mu.Lock()
	defer lab.mu.Unlock()
	if lab.closed {
		http.Error(w, "session closed", 410)
		return
	}
	if action == "close" {
		// Close signaling while authority is still active, then revoke the lease.
		if lab.stream != "" {
			if creds, err := s.labCredentials(ctx, actor.AccessToken, lab); err == nil {
				_, _, _ = s.labRequest(ctx, creds, "POST", "/api/request_webrtc/close", map[string]string{"devid": lab.Devid, "session_id": lab.stream}, false)
			}
		}
		_, err := s.accountClient.TestLab(ctx, actor.AccessToken, cloud, id, "", "DELETE", nil)
		if err != nil {
			s.managedCloudError(w, actor.ID, err)
			return
		}
		lab.closed = true
		s.testLabSessions.Delete(actor.ID + ":" + id)
		w.WriteHeader(204)
		return
	}
	if !lab.Expires.After(time.Now()) {
		http.Error(w, "session expired", 410)
		return
	}
	if time.Since(lab.lastAction) >= time.Second {
		lab.lastAction = time.Now()
		lab.actions = 0
	}
	lab.actions++
	if lab.actions > 10 {
		http.Error(w, "test request rate exceeded", 429)
		return
	}
	creds, err := s.labCredentials(ctx, actor.AccessToken, lab)
	if err != nil {
		s.managedCloudError(w, actor.ID, err)
		return
	}
	if action == "credentials" {
		u, err := url.Parse(s.cfg.TestLabMQTTURL)
		if err != nil || u.Scheme != "wss" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			http.Error(w, "MQTT WSS unavailable", 503)
			return
		}
		writeJSON(w, map[string]any{"url": u.String(), "username": creds.MQTT.Username, "client_id": creds.MQTT.ClientID, "password": creds.AccessToken, "expires_at": creds.Expires})
		return
	}
	var in struct {
		Name      string          `json:"name"`
		Operation string          `json:"operation"`
		Payload   json.RawMessage `json:"payload"`
		Offer     json.RawMessage `json:"offer"`
	}
	if decodeLabJSON(w, r, &in) != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	method, path := "", ""
	var body any
	shadow := false
	switch action {
	case "shadow":
		if in.Name != "" && !labShadowName.MatchString(in.Name) {
			http.Error(w, "invalid shadow name", 400)
			return
		}
		shadow = true
		path = "/things/" + url.PathEscape(lab.Devid) + "/shadow"
		if in.Name != "" {
			path += "?" + url.Values{"name": {in.Name}}.Encode()
		}
		switch in.Operation {
		case "get":
			method = "GET"
		case "delete":
			method = "DELETE"
		case "update":
			method = "POST"
			var payload map[string]json.RawMessage
			if len(in.Payload) > 8192 || json.Unmarshal(in.Payload, &payload) != nil || payload == nil {
				http.Error(w, "invalid shadow payload", 400)
				return
			}
			for key := range payload {
				if key != "state" && key != "version" && key != "clientToken" {
					http.Error(w, "unsupported shadow field", 400)
					return
				}
			}
			var state map[string]json.RawMessage
			if json.Unmarshal(payload["state"], &state) != nil || len(state) != 1 || state["desired"] == nil {
				http.Error(w, "only desired state may be edited", 400)
				return
			}
			body = in.Payload
		default:
			http.Error(w, "invalid shadow operation", 400)
			return
		}
	case "ice":
		method = "GET"
		path = "/api/request_webrtc/ice?" + url.Values{"devid": {lab.Devid}, "expiry": {"90"}}.Encode()
	case "offer":
		if lab.stream != "" {
			http.Error(w, "a stream is already open", 409)
			return
		}
		if len(in.Offer) == 0 || len(in.Offer) > 128*1024 {
			http.Error(w, "invalid offer", 400)
			return
		}
		method = "POST"
		path = "/api/request_webrtc"
		body = map[string]any{"devid": lab.Devid, "offer": in.Offer, "expiry": 90}
	case "answer":
		if lab.stream == "" {
			http.Error(w, "no stream", 409)
			return
		}
		method = "GET"
		path = "/api/request_webrtc?" + url.Values{"devid": {lab.Devid}, "session_id": {lab.stream}, "timeout_ms": {"15000"}}.Encode()
	case "stop":
		if lab.stream == "" {
			w.WriteHeader(204)
			return
		}
		method = "POST"
		path = "/api/request_webrtc/close"
		body = map[string]string{"devid": lab.Devid, "session_id": lab.stream}
	default:
		http.NotFound(w, r)
		return
	}
	raw, status, err := s.labRequest(ctx, creds, method, path, body, shadow)
	if err != nil {
		http.Error(w, "test service unavailable", 503)
		return
	}
	if status < 200 || status >= 300 {
		writeJSONStatus(w, status, map[string]any{"error": "test_operation_failed", "upstream_status": status})
		return
	}
	if action == "offer" {
		var out struct {
			Session string `json:"session_id"`
		}
		if json.Unmarshal(raw, &out) != nil || out.Session == "" {
			http.Error(w, "invalid signaling response", 502)
			return
		}
		lab.stream = out.Session
	}
	if action == "stop" {
		lab.stream = ""
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// Shadow uses JSON null to remove desired fields; SDP may exceed the generic
// Console form limit. Keep this bounded decoder local to the lab action body.
func decodeLabJSON(w http.ResponseWriter, r *http.Request, out any) error {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return fmt.Errorf("JSON required")
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 160*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return fmt.Errorf("single JSON object required")
	}
	return nil
}

func (s *Server) labCredentials(ctx context.Context, actor string, lab *labSession) (labCredentials, error) {
	var creds labCredentials
	raw, err := s.accountClient.TestLab(ctx, actor, lab.Cloud, lab.ID, "credentials", "POST", map[string]any{})
	if err != nil {
		return creds, err
	}
	if json.Unmarshal(raw, &creds) != nil || creds.AccessToken == "" || !creds.Expires.After(time.Now()) || creds.Expires.After(time.Now().Add(time.Minute)) {
		return creds, fmt.Errorf("invalid test credentials")
	}
	return creds, nil
}

func (s *Server) labRequest(ctx context.Context, creds labCredentials, method, path string, body any, shadow bool) ([]byte, int, error) {
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.cfg.VideoCloudBaseURL, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if shadow {
		if creds.AWS.AccessKey == "" || creds.AWS.Secret == "" || creds.AWS.Region == "" {
			return nil, 0, fmt.Errorf("shadow credentials missing")
		}
		signLabShadow(req, raw, creds, time.Now())
	} else {
		req.Header.Set("Authorization", "Bearer "+creds.AccessToken)
	}
	client := http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024+1))
	if len(data) > 256*1024 {
		return nil, 0, fmt.Errorf("test response too large")
	}
	return data, resp.StatusCode, err
}

func signLabShadow(req *http.Request, body []byte, creds labCredentials, now time.Time) {
	stamp, day := now.UTC().Format("20060102T150405Z"), now.UTC().Format("20060102")
	hash := func(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
	mac := func(key []byte, value string) []byte {
		m := hmac.New(sha256.New, key)
		m.Write([]byte(value))
		return m.Sum(nil)
	}
	payloadHash := hash(body)
	req.Header.Set("X-Amz-Date", stamp)
	req.Header.Set("X-Amz-Security-Token", creds.AWS.Token)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	headers := "host;x-amz-content-sha256;x-amz-date;x-amz-security-token"
	canonicalHeaders := "host:" + req.URL.Host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + stamp + "\nx-amz-security-token:" + creds.AWS.Token + "\n"
	canonical := strings.Join([]string{req.Method, req.URL.EscapedPath(), strings.ReplaceAll(req.URL.Query().Encode(), "+", "%20"), canonicalHeaders, headers, payloadHash}, "\n")
	scope := day + "/" + creds.AWS.Region + "/iotdevicegateway/aws4_request"
	key := mac(mac(mac(mac([]byte("AWS4"+creds.AWS.Secret), day), creds.AWS.Region), "iotdevicegateway"), "aws4_request")
	signature := hex.EncodeToString(mac(key, "AWS4-HMAC-SHA256\n"+stamp+"\n"+scope+"\n"+hash([]byte(canonical))))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+creds.AWS.AccessKey+"/"+scope+", SignedHeaders="+headers+", Signature="+signature)
}
