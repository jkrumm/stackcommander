package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jkrumm/rollhook/internal/api"
	"github.com/jkrumm/rollhook/internal/registry"
)

const scalarHTML = `<!doctype html>
<html>
<head><title>RollHook API</title><meta charset="utf-8"/></head>
<body>
<script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`

func main() {
	secret := os.Getenv("ROLLHOOK_SECRET")
	if len(secret) < 7 {
		log.Fatal("ROLLHOOK_SECRET must be set and at least 7 characters")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}

	// Start Zot registry subprocess before opening the HTTP port.
	mgr := registry.NewManager(dataDir, secret)
	if err := mgr.Start(ctx); err != nil {
		log.Fatalf("failed to start registry: %v", err)
	}

	r := chi.NewRouter()

	config := huma.DefaultConfig("RollHook", "0.1.0")
	config.Info.Description = "Webhook-driven rolling deployment orchestrator for Docker Compose stacks"
	config.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {
			Type:   "http",
			Scheme: "bearer",
		},
	}
	// Disable huma's built-in docs UI — we serve Scalar at /openapi ourselves.
	// SpecPath="/openapi" (default) exposes /openapi.json and /openapi.yaml.
	config.DocsPath = ""

	humaAPI := humachi.New(r, config)

	// Auth enforcement via huma middleware — operations with Security requirements
	// are checked; public operations (health, openapi) pass through.
	humaAPI.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		if len(ctx.Operation().Security) > 0 {
			token, ok := strings.CutPrefix(ctx.Header("Authorization"), "Bearer ")
			if !ok || token != secret {
				_ = huma.WriteErr(humaAPI, ctx, http.StatusUnauthorized, "unauthorized")
				return
			}
		}
		next(ctx)
	})

	// Scalar UI — served at /openapi, spec JSON is at /openapi.json (huma default)
	r.Get("/openapi", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(scalarHTML))
	})

	api.RegisterHealth(humaAPI)
	api.RegisterDeploy(humaAPI)
	api.RegisterJobs(humaAPI)

	// OCI distribution routes — proxied to internal Zot (127.0.0.1:5000).
	// Chi wildcard handles all nested paths correctly (unlike Elysia 1.4 .all()).
	proxyHandler := registry.NewProxy("http://127.0.0.1:5000", secret)
	r.Handle("/v2", proxyHandler)
	r.Handle("/v2/", proxyHandler)
	r.Handle("/v2/*", proxyHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "7700"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		_ = mgr.Stop()
	}()

	slog.Info("RollHook starting", "port", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	slog.Info("RollHook stopped")
}
