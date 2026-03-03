package steps_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jkrumm/rollhook/internal/jobs/steps"
)

func writeCompose(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, "compose.yml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write compose: %v", err)
	}
	return path
}

func TestValidate_RelativePath(t *testing.T) {
	err := steps.Validate("compose.yml", "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error for relative path")
	}
}

func TestValidate_MissingFile(t *testing.T) {
	err := steps.Validate("/tmp/rollhook-nonexistent-xyz/compose.yml", "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error for missing file")
	}
}

func TestValidate_ServiceNotFound(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  api:
    image: myapp:v1
`)
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error for missing service")
	}
}

func TestValidate_Success(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: ${IMAGE_TAG:-localhost:7700/myapp:v1}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 5s
      timeout: 3s
      retries: 3
`)
	err := steps.Validate(path, "web", "localhost:7700/myapp:v1", nil)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidate_BuildOnlyService(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 5s
      timeout: 3s
      retries: 3
`)
	// Build-only service has no image: field — IMAGE_TAG check is skipped
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err != nil {
		t.Errorf("unexpected error for build-only service: %v", err)
	}
}

func TestValidate_HealthcheckRequiredFails(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: ${IMAGE_TAG:-myapp:v1}
`)
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error when healthcheck is missing")
	}
	if !strings.Contains(err.Error(), "healthcheck") {
		t.Errorf("expected error to mention healthcheck, got: %q", err)
	}
}

func TestValidate_HealthcheckDisabledFails(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: ${IMAGE_TAG:-myapp:v1}
    healthcheck:
      disable: true
`)
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error when healthcheck is disabled")
	}
	if !strings.Contains(err.Error(), "healthcheck") {
		t.Errorf("expected error to mention healthcheck, got: %q", err)
	}
}

func TestValidate_PortsBindingFails(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: ${IMAGE_TAG:-myapp:v1}
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
      timeout: 3s
      retries: 3
`)
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error for port bindings")
	}
	if !strings.Contains(err.Error(), "ports") {
		t.Errorf("expected error to mention ports, got: %q", err)
	}
}

func TestValidate_ContainerNameFails(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: ${IMAGE_TAG:-myapp:v1}
    container_name: myapp
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
      timeout: 3s
      retries: 3
`)
	err := steps.Validate(path, "web", "myapp:v1", nil)
	if err == nil {
		t.Error("expected error for container_name")
	}
	if !strings.Contains(err.Error(), "container_name") {
		t.Errorf("expected error to mention container_name, got: %q", err)
	}
}

func TestValidate_HardcodedImageFails(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: myapp:latest
    healthcheck:
      test: ["CMD", "true"]
      interval: 5s
      timeout: 3s
      retries: 3
`)
	err := steps.Validate(path, "web", "myapp:latest", nil)
	if err == nil {
		t.Error("expected error for hardcoded image (no IMAGE_TAG reference)")
	}
	if !strings.Contains(err.Error(), "IMAGE_TAG") {
		t.Errorf("expected error to mention IMAGE_TAG, got: %q", err)
	}
}
