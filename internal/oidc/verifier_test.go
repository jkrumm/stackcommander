package oidc_test

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	oidcpkg "github.com/jkrumm/rollhook/internal/oidc"
)

var (
	testKey    *rsa.PrivateKey
	testServer *httptest.Server
	testIssuer string
)

func TestMain(m *testing.M) {
	var err error
	testKey, err = rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("generate RSA key: " + err.Error())
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
			"issuer":   testIssuer,
			"jwks_uri": testIssuer + "/.well-known/jwks",
		})
	})
	mux.HandleFunc("/.well-known/jwks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"keys": []map[string]any{rsaPublicKeyToJWK(&testKey.PublicKey, "test-key-1")},
		})
	})

	testServer = httptest.NewServer(mux)
	testIssuer = testServer.URL

	code := m.Run()
	testServer.Close()
	os.Exit(code)
}

// rsaPublicKeyToJWK converts an RSA public key to a JWK map.
func rsaPublicKeyToJWK(pub *rsa.PublicKey, kid string) map[string]any {
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": kid,
		"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}
}

// signJWT creates a signed RS256 JWT without external JWT libraries.
func signJWT(key *rsa.PrivateKey, header, payload map[string]any) (string, error) {
	hJSON, _ := json.Marshal(header)
	pJSON, _ := json.Marshal(payload)
	hEnc := base64.RawURLEncoding.EncodeToString(hJSON)
	pEnc := base64.RawURLEncoding.EncodeToString(pJSON)
	sigInput := hEnc + "." + pEnc

	h := sha256.Sum256([]byte(sigInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h[:])
	if err != nil {
		return "", err
	}
	return sigInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

func makeToken(repo, ref string, expOffset int64) (string, error) {
	now := time.Now().Unix()
	return signJWT(testKey,
		map[string]any{"alg": "RS256", "typ": "JWT", "kid": "test-key-1"},
		map[string]any{
			"iss":              testIssuer,
			"sub":              "repo:" + repo + ":ref:" + ref,
			"aud":              testIssuer,
			"ref":              ref,
			"repository":       repo,
			"repository_owner": "testorg",
			"actor":            "test-actor",
			"iat":              now,
			"nbf":              now,
			"exp":              now + expOffset,
		},
	)
}

func newVerifier(t *testing.T) *oidcpkg.Verifier {
	t.Helper()
	t.Setenv("ROLLHOOK_OIDC_ISSUER", testIssuer)
	os.Unsetenv("ROLLHOOK_URL") //nolint:errcheck
	v, err := oidcpkg.New(context.Background())
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return v
}

func TestVerify_ValidToken(t *testing.T) {
	v := newVerifier(t)
	tok, err := makeToken("testorg/myapp", "refs/heads/main", 3600)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := v.Verify(context.Background(), tok)
	if err != nil {
		t.Fatalf("expected valid token, got error: %v", err)
	}
	if claims.Repository != "testorg/myapp" {
		t.Errorf("repository = %q, want %q", claims.Repository, "testorg/myapp")
	}
	if claims.Ref != "refs/heads/main" {
		t.Errorf("ref = %q, want %q", claims.Ref, "refs/heads/main")
	}
}

func TestVerify_ExpiredToken(t *testing.T) {
	v := newVerifier(t)
	tok, err := makeToken("testorg/myapp", "refs/heads/main", -1) // expired
	if err != nil {
		t.Fatal(err)
	}
	_, err = v.Verify(context.Background(), tok)
	if err == nil {
		t.Error("expected error for expired token, got nil")
	}
}

func TestVerify_WrongIssuer(t *testing.T) {
	// Create a verifier for a different issuer URL
	t.Setenv("ROLLHOOK_OIDC_ISSUER", testIssuer)
	v, err := oidcpkg.New(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// Sign a token with a different issuer claim
	tok, _ := signJWT(testKey,
		map[string]any{"alg": "RS256", "typ": "JWT", "kid": "test-key-1"},
		map[string]any{
			"iss": "https://wrong.issuer.example.com",
			"sub": "repo:testorg/myapp:ref:refs/heads/main",
			"aud": testIssuer,
			"exp": time.Now().Unix() + 3600,
			"iat": time.Now().Unix(),
		},
	)
	_, err = v.Verify(context.Background(), tok)
	if err == nil {
		t.Error("expected error for wrong issuer, got nil")
	}
}

func TestVerify_InvalidSignature(t *testing.T) {
	v := newVerifier(t)
	tok, err := makeToken("testorg/myapp", "refs/heads/main", 3600)
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt the signature (last segment)
	parts := splitToken(tok)
	if len(parts) != 3 {
		t.Fatal("expected 3 JWT parts")
	}
	corrupted := parts[0] + "." + parts[1] + ".invalidsignature"
	_, err = v.Verify(context.Background(), corrupted)
	if err == nil {
		t.Error("expected error for invalid signature, got nil")
	}
}

func TestVerify_MalformedJWT(t *testing.T) {
	v := newVerifier(t)
	_, err := v.Verify(context.Background(), "eyJub3QudmFsaWQ=")
	if err == nil {
		t.Error("expected error for malformed JWT, got nil")
	}
}

func TestIsJWT(t *testing.T) {
	if !oidcpkg.IsJWT("eyJhbGciOiJSUzI1NiJ9.payload.sig") {
		t.Error("IsJWT returned false for valid JWT prefix")
	}
	if oidcpkg.IsJWT("abc123plaintoken") {
		t.Error("IsJWT returned true for non-JWT token")
	}
	if oidcpkg.IsJWT("") {
		t.Error("IsJWT returned true for empty string")
	}
}

func TestClaimsFromContext(t *testing.T) {
	ctx := context.Background()
	_, ok := oidcpkg.ClaimsFromContext(ctx)
	if ok {
		t.Error("expected no claims in empty context")
	}

	c := oidcpkg.Claims{Repository: "testorg/myapp", Ref: "refs/heads/main"}
	ctx = oidcpkg.WithClaims(ctx, c)
	got, ok := oidcpkg.ClaimsFromContext(ctx)
	if !ok {
		t.Fatal("expected claims in context")
	}
	if got.Repository != "testorg/myapp" {
		t.Errorf("repository = %q, want %q", got.Repository, "testorg/myapp")
	}
}

func splitToken(tok string) []string {
	var parts []string
	start := 0
	for i := 0; i <= len(tok); i++ {
		if i == len(tok) || tok[i] == '.' {
			parts = append(parts, tok[start:i])
			start = i + 1
		}
	}
	return parts
}
