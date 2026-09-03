package lke

import (
	"os"
	"strings"
	"testing"
)

func TestRuntimeImageInstallsCertificateAuthorities(t *testing.T) {
	body, err := os.ReadFile("Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "apt-get install -y --no-install-recommends ca-certificates") {
		t.Fatal("runtime image must install ca-certificates for HTTPS upstreams")
	}
}
