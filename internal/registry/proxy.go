package registry

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
)

// hopByHopHeaders lists connection-specific headers that must not be forwarded upstream.
// httputil.ReverseProxy strips most of these automatically, but we strip them explicitly
// in Director to match the TypeScript proxy behaviour (notably Authorization).
var hopByHopHeaders = []string{
	"Authorization",
	"Host",
	"Transfer-Encoding",
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailers",
	"Upgrade",
}

// zotAbsoluteURLPattern matches absolute URLs pointing at the internal Zot address.
// Location headers from Zot contain these and must be rewritten to relative paths
// so Docker follows redirects through our proxy, not directly to the loopback address.
var zotAbsoluteURLPattern = regexp.MustCompile(`(?i)^https?://127\.0\.0\.1:\d+`)

// validateProxyAuth validates an Authorization header against the shared secret.
// Bearer: token must equal secret.
// Basic: base64-decoded password (after the first colon) must equal secret — any username accepted.
func validateProxyAuth(header, secret string) bool {
	if header == "" {
		return false
	}
	if bearer, ok := strings.CutPrefix(header, "Bearer "); ok {
		return bearer == secret
	}
	if basic, ok := strings.CutPrefix(header, "Basic "); ok {
		decoded, err := base64.StdEncoding.DecodeString(basic)
		if err != nil {
			return false
		}
		_, password, found := strings.Cut(string(decoded), ":")
		if !found {
			return false
		}
		return password == secret
	}
	return false
}

// NewProxy returns an http.Handler that:
//  1. Validates the client's Authorization header (Bearer or Basic, password = secret).
//  2. Strips hop-by-hop headers and injects Zot Basic auth credentials.
//  3. Proxies the request to zotAddr via httputil.ReverseProxy (streaming, no buffering).
//  4. Rewrites absolute Location headers from Zot to relative paths.
func NewProxy(zotAddr, secret string) http.Handler {
	target, err := url.Parse(zotAddr)
	if err != nil {
		panic("invalid zot address: " + err.Error())
	}

	zotAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte(ZotUser+":"+secret))

	proxy := httputil.NewSingleHostReverseProxy(target)

	// Rewrite absolute Zot Location URLs to relative paths so Docker follows
	// redirects through our proxy endpoint, not directly to 127.0.0.1:5000.
	proxy.ModifyResponse = func(resp *http.Response) error {
		if loc := resp.Header.Get("Location"); loc != "" {
			rewritten := zotAbsoluteURLPattern.ReplaceAllString(loc, "")
			if rewritten == "" {
				rewritten = "/"
			}
			resp.Header.Set("Location", rewritten)
		}
		return nil
	}

	// Override Director: strip hop-by-hop headers and inject Zot credentials.
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		for _, h := range hopByHopHeaders {
			req.Header.Del(h)
		}
		req.Header.Set("Authorization", zotAuth)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !validateProxyAuth(r.Header.Get("Authorization"), secret) {
			writeUnauthorized(w)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func writeUnauthorized(w http.ResponseWriter) {
	body, _ := json.Marshal(map[string]any{
		"errors": []map[string]any{
			{"code": "UNAUTHORIZED", "message": "authentication required", "detail": nil},
		},
	})
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", `Basic realm="RollHook Registry"`)
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write(body)
}
