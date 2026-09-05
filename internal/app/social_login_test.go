package app

import (
	"errors"
	"testing"
)

func TestSocialLoginDestinationRejectsCrossViewAndExternalRedirects(t *testing.T) {
	if got := socialLoginDestination("customer", "/console/clouds/cloud-1"); got != "/console/clouds/cloud-1" {
		t.Fatalf("customer destination = %q", got)
	}
	if got := socialLoginDestination("customer", "/admin"); got != "/console/clouds" {
		t.Fatalf("cross-view destination = %q", got)
	}
	if got := socialLoginDestination("platform_admin", "https://evil.example/admin"); got != "/admin" {
		t.Fatalf("external destination = %q", got)
	}
}

func TestSocialErrorCodeDoesNotExposeProviderDetails(t *testing.T) {
	if got := socialErrorCode(errors.New("provider request included client_secret=private")); got != "unavailable" {
		t.Fatalf("social error code = %q", got)
	}
}
