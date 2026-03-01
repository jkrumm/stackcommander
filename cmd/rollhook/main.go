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
	"github.com/jkrumm/rollhook/internal/db"
	dockerpkg "github.com/jkrumm/rollhook/internal/docker"
	"github.com/jkrumm/rollhook/internal/jobs"
	"github.com/jkrumm/rollhook/internal/middleware"
	"github.com/jkrumm/rollhook/internal/registry"
	"github.com/jkrumm/rollhook/internal/state"
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

	// Database
	sqlDB, err := db.Open(dataDir)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	store := db.NewStore(sqlDB)

	// Docker client
	cli, err := dockerpkg.NewClient()
	if err != nil {
		log.Fatalf("failed to create docker client: %v", err)
	}
	defer cli.Close()

	// Job executor (creates and starts the internal queue)
	exec := jobs.NewExecutor(store, cli, secret, dataDir)

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
	api.RegisterDeploy(humaAPI, exec)
	api.RegisterJobsAPI(humaAPI, store)

	// SSE log stream — registered directly on Chi to bypass huma's response wrapping.
	r.With(middleware.RequireAuth(secret)).Get("/jobs/{id}/logs", api.StreamLogsHandler(store, dataDir))

	// OCI distribution routes — proxied to internal Zot (127.0.0.1:5000).
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
		// Signal /health to return 503 so Traefik stops routing traffic here.
		state.StartShutdown()
		// Allow Traefik time to deregister this backend before we stop accepting.
		time.Sleep(3 * time.Second)
		// Wait for any in-flight job to complete (up to 5 minutes).
		exec.Queue().Drain(5 * time.Minute)
		// Stop registry and HTTP server.
		_ = mgr.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	slog.Info("RollHook starting", "port", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	slog.Info("RollHook stopped")
}
