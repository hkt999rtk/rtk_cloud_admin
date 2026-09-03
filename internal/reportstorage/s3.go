package reportstorage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
)

type Store struct {
	Endpoint, Bucket, Region, AccessKey, SecretKey string
	Client                                         *http.Client
}

func (s Store) Enabled() bool {
	return strings.TrimSpace(s.Endpoint) != "" && s.Bucket != "" && s.AccessKey != "" && s.SecretKey != ""
}

func (s Store) objectURL(key string) (*url.URL, error) {
	u, err := url.Parse(s.Endpoint)
	if err != nil {
		return nil, err
	}
	u.Path = path.Join(u.Path, s.Bucket, key)
	u.RawQuery = ""
	return u, nil
}

func (s Store) Put(ctx context.Context, key string, body []byte, contentType string) error {
	u, err := s.objectURL(key)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	amzDate, shortDate := now.Format("20060102T150405Z"), now.Format("20060102")
	hash := sha256.Sum256(body)
	payloadHash := hex.EncodeToString(hash[:])
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Host = u.Host
	req.Header.Set("Host", u.Host)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	s.sign(req, shortDate, amzDate, payloadHash)
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("object storage put failed: %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return nil
}

func (s Store) PresignGet(key string, ttl time.Duration) (string, error) {
	u, err := s.objectURL(key)
	if err != nil {
		return "", err
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	if ttl > 10*time.Minute {
		ttl = 10 * time.Minute
	}
	now := time.Now().UTC()
	amzDate, shortDate := now.Format("20060102T150405Z"), now.Format("20060102")
	scope := strings.Join([]string{shortDate, s.RegionOrDefault(), "s3", "aws4_request"}, "/")
	q := u.Query()
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", s.AccessKey+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(ttl.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")
	u.RawQuery = q.Encode()
	canonical := strings.Join([]string{http.MethodGet, uriEncodePath(u.Path), canonicalQuery(u.Query()), "host:" + u.Host + "\n", "host", "UNSIGNED-PAYLOAD"}, "\n")
	h := sha256.Sum256([]byte(canonical))
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, hex.EncodeToString(h[:])}, "\n")
	sig := hex.EncodeToString(hmacSHA256(sigV4Key(s.SecretKey, shortDate, s.RegionOrDefault()), stringToSign))
	q.Set("X-Amz-Signature", sig)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (s Store) RegionOrDefault() string {
	if strings.TrimSpace(s.Region) != "" {
		return s.Region
	}
	return "us-east-1"
}
func (s Store) sign(req *http.Request, shortDate, amzDate, payloadHash string) {
	scope := strings.Join([]string{shortDate, s.RegionOrDefault(), "s3", "aws4_request"}, "/")
	canonical := strings.Join([]string{req.Method, uriEncodePath(req.URL.Path), "", "host:" + req.Host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n", "host;x-amz-content-sha256;x-amz-date", payloadHash}, "\n")
	h := sha256.Sum256([]byte(canonical))
	sts := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, hex.EncodeToString(h[:])}, "\n")
	sig := hex.EncodeToString(hmacSHA256(sigV4Key(s.SecretKey, shortDate, s.RegionOrDefault()), sts))
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=%s", s.AccessKey, scope, sig))
}
func sigV4Key(secret, date, region string) []byte {
	return hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+secret), date), region), "s3"), "aws4_request")
}
func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(data))
	return h.Sum(nil)
}
func uriEncodePath(p string) string {
	parts := strings.Split(p, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	out := strings.Join(parts, "/")
	if strings.HasPrefix(p, "/") && !strings.HasPrefix(out, "/") {
		out = "/" + out
	}
	return out
}
func canonicalQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		vals := append([]string(nil), q[k]...)
		sort.Strings(vals)
		for _, v := range vals {
			if b.Len() > 0 {
				b.WriteByte('&')
			}
			b.WriteString(url.QueryEscape(k))
			b.WriteByte('=')
			b.WriteString(url.QueryEscape(v))
		}
	}
	return b.String()
}
