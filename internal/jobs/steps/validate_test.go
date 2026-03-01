package steps_test

import (
	"os"
	"path/filepath"
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
	err := steps.Validate("compose.yml", "web", "myapp:v1")
	if err == nil {
		t.Error("expected error for relative path")
	}
}

func TestValidate_MissingFile(t *testing.T) {
	err := steps.Validate("/tmp/rollhook-nonexistent-xyz/compose.yml", "web", "myapp:v1")
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
	err := steps.Validate(path, "web", "myapp:v1")
	if err == nil {
		t.Error("expected error for missing service")
	}
}

func TestValidate_Success(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: localhost:7700/myapp:v1
`)
	err := steps.Validate(path, "web", "localhost:7700/myapp:v1")
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
`)
	// Service with no image: field — image check is skipped
	err := steps.Validate(path, "web", "myapp:v1")
	if err != nil {
		t.Errorf("unexpected error for build-only service: %v", err)
	}
}

func TestValidate_ImageMismatch(t *testing.T) {
	dir := t.TempDir()
	path := writeCompose(t, dir, `
services:
  web:
    image: other-image:v1
`)
	err := steps.Validate(path, "web", "myapp:v1")
	if err == nil {
		t.Error("expected error for image mismatch")
	}
}
