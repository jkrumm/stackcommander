package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jkrumm/rollhook/internal/middleware"
)

func TestRequireAuth(t *testing.T) {
	const secret = "test-secret-ok"

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := middleware.RequireAuth(secret)(next)

	tests := []struct {
		name       string
		authHeader string
		wantStatus int
	}{
		{"no header", "", http.StatusUnauthorized},
		{"wrong token", "Bearer wrong-token", http.StatusUnauthorized},
		{"correct token", "Bearer " + secret, http.StatusOK},
		{"missing Bearer prefix", secret, http.StatusUnauthorized},
		{"empty bearer", "Bearer ", http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
		})
	}
}
