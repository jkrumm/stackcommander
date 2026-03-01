package notifier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jkrumm/rollhook/internal/db"
)

// Config holds optional notification settings loaded from environment variables.
type Config struct {
	PushoverUserKey  string // PUSHOVER_USER_KEY
	PushoverAppToken string // PUSHOVER_APP_TOKEN
	WebhookURL       string // NOTIFICATION_WEBHOOK_URL
}

// pushoverEndpoint is the Pushover API URL. Override in tests.
var pushoverEndpoint = "https://api.pushover.net/1/messages.json"

// httpClient is used for outgoing notification requests. Override in tests.
var httpClient = http.DefaultClient //nolint:gochecknoglobals

// Notify sends Pushover and/or webhook notifications for a completed job.
// Notification failures are logged but never cause the deploy to fail.
func Notify(ctx context.Context, cfg Config, job db.Job) {
	if cfg.PushoverUserKey != "" && cfg.PushoverAppToken != "" {
		if err := sendPushover(ctx, cfg.PushoverUserKey, cfg.PushoverAppToken, job); err != nil {
			slog.Warn("pushover notification failed", "job", job.ID, "err", err)
		}
	}
	if cfg.WebhookURL != "" {
		if err := sendWebhook(ctx, cfg.WebhookURL, job); err != nil {
			slog.Warn("webhook notification failed", "job", job.ID, "err", err)
		}
	}
}

func sendPushover(ctx context.Context, userKey, appToken string, job db.Job) error {
	title := fmt.Sprintf("✅ Deployed %s", job.App)
	if job.Status != db.StatusSuccess {
		title = fmt.Sprintf("❌ Deployment failed: %s", job.App)
	}
	message := fmt.Sprintf("Image: %s\nStatus: %s", job.ImageTag, job.Status)
	if job.Error != nil {
		message += fmt.Sprintf("\nError: %s", *job.Error)
	}

	body, err := json.Marshal(map[string]string{
		"token":   appToken,
		"user":    userKey,
		"title":   title,
		"message": message,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pushoverEndpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("pushover returned %d", resp.StatusCode)
	}
	return nil
}

func sendWebhook(ctx context.Context, url string, job db.Job) error {
	body, err := json.Marshal(job)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}
