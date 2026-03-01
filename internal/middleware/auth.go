package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
)

// RequireAuth returns a standard http.Handler middleware that enforces bearer token auth.
// Use as a standalone chi middleware or in unit tests. Protected huma operations use
// huma middleware (registered in main.go) that checks ctx.Operation().Security instead.
func RequireAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || token != secret {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"}) //nolint:errcheck
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
