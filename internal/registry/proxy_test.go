package registry

import (
	"encoding/base64"
	"testing"
)

func TestValidateProxyAuth_Bearer(t *testing.T) {
	secret := "test-secret-ok"
	header := "Bearer " + secret
	if !validateProxyAuth(header, secret) {
		t.Error("expected true for valid Bearer token")
	}
}

func TestValidateProxyAuth_Basic_AnyUsername(t *testing.T) {
	secret := "test-secret-ok"

	for _, username := range []string{"rollhook", "anyuser", "docker", ""} {
		creds := base64.StdEncoding.EncodeToString([]byte(username + ":" + secret))
		header := "Basic " + creds
		if !validateProxyAuth(header, secret) {
			t.Errorf("expected true for username=%q with correct password", username)
		}
	}
}

func TestValidateProxyAuth_InvalidToken(t *testing.T) {
	secret := "test-secret-ok"

	cases := []struct {
		name   string
		header string
	}{
		{"wrong Bearer", "Bearer wrong-token"},
		{"wrong Basic password", "Basic " + base64.StdEncoding.EncodeToString([]byte("user:wrongpass"))},
		{"malformed Basic", "Basic not-base64!!!"},
		{"Basic no colon", "Basic " + base64.StdEncoding.EncodeToString([]byte("nocolon"))},
	}

	for _, tc := range cases {
		if validateProxyAuth(tc.header, secret) {
			t.Errorf("%s: expected false, got true", tc.name)
		}
	}
}

func TestValidateProxyAuth_Missing(t *testing.T) {
	if validateProxyAuth("", "test-secret-ok") {
		t.Error("expected false for empty header")
	}
	if validateProxyAuth("Token something", "test-secret-ok") {
		t.Error("expected false for unknown auth scheme")
	}
}
