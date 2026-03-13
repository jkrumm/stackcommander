package oidc

import (
	"context"
	"fmt"
	"os"
	"strings"

	coreidc "github.com/coreos/go-oidc/v3/oidc"
)

const githubIssuer = "https://token.actions.githubusercontent.com"

type claimsKey struct{}

// ClaimsContextKey is the context key for OIDC claims, used with huma.WithValue.
var ClaimsContextKey = claimsKey{}

// Claims holds the GitHub Actions OIDC token claims relevant to deploy authorization.
type Claims struct {
	Repository      string `json:"repository"`
	RepositoryOwner string `json:"repository_owner"`
	Ref             string `json:"ref"`
	Actor           string `json:"actor"`
	Sub             string `json:"sub"`
}

// Verifier wraps the go-oidc provider verifier.
type Verifier struct {
	inner *coreidc.IDTokenVerifier
}

// New creates an OIDC verifier by fetching the provider discovery document.
// ROLLHOOK_OIDC_ISSUER overrides the issuer (useful for testing with a mock server).
// If ROLLHOOK_URL is set, the audience (aud) claim is verified against it;
// otherwise the aud check is skipped.
func New(ctx context.Context) (*Verifier, error) {
	issuer := os.Getenv("ROLLHOOK_OIDC_ISSUER")
	if issuer == "" {
		issuer = githubIssuer
	}
	provider, err := coreidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc provider init: %w", err)
	}
	cfg := &coreidc.Config{SkipClientIDCheck: true}
	if audience := os.Getenv("ROLLHOOK_URL"); audience != "" {
		cfg = &coreidc.Config{ClientID: audience}
	}
	return &Verifier{inner: provider.Verifier(cfg)}, nil
}

// Verify validates the raw OIDC JWT and returns the extracted claims.
func (v *Verifier) Verify(ctx context.Context, rawToken string) (Claims, error) {
	tok, err := v.inner.Verify(ctx, rawToken)
	if err != nil {
		return Claims{}, fmt.Errorf("oidc verify: %w", err)
	}
	var c Claims
	if err := tok.Claims(&c); err != nil {
		return Claims{}, fmt.Errorf("oidc claims: %w", err)
	}
	return c, nil
}

// IsJWT reports whether the token looks like a JWT (fast pre-check, no verification).
func IsJWT(token string) bool {
	return strings.HasPrefix(token, "eyJ")
}

// ClaimsFromContext retrieves OIDC claims stored by the auth middleware.
func ClaimsFromContext(ctx context.Context) (Claims, bool) {
	c, ok := ctx.Value(claimsKey{}).(Claims)
	return c, ok
}

// WithClaims returns a new context carrying the OIDC claims.
func WithClaims(ctx context.Context, c Claims) context.Context {
	return context.WithValue(ctx, claimsKey{}, c)
}
