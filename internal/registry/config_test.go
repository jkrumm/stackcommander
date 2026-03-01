package registry

import (
	"encoding/json"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestGenerateZotConfig_ContainsDockerCompat(t *testing.T) {
	cfg := GenerateZotConfig("/tmp/registry", "/tmp/registry/.htpasswd", 5000)

	var parsed map[string]any
	if err := json.Unmarshal([]byte(cfg), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	httpSection, ok := parsed["http"].(map[string]any)
	if !ok {
		t.Fatal("missing http section")
	}
	compat, ok := httpSection["compat"].([]any)
	if !ok || len(compat) == 0 {
		t.Fatal("missing or empty http.compat")
	}
	found := false
	for _, v := range compat {
		if v == "docker2s2" {
			found = true
		}
	}
	if !found {
		t.Errorf("http.compat does not contain docker2s2: %v", compat)
	}
}

func TestGenerateZotConfig_LoopbackAddress(t *testing.T) {
	cfg := GenerateZotConfig("/tmp/registry", "/tmp/registry/.htpasswd", 5000)

	var parsed map[string]any
	if err := json.Unmarshal([]byte(cfg), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	httpSection := parsed["http"].(map[string]any)
	if addr, ok := httpSection["address"].(string); !ok || addr != "127.0.0.1" {
		t.Errorf("expected address 127.0.0.1, got %v", httpSection["address"])
	}
}

func TestGenerateZotConfig_PortAsString(t *testing.T) {
	cfg := GenerateZotConfig("/tmp/registry", "/tmp/registry/.htpasswd", 5000)

	var parsed map[string]any
	if err := json.Unmarshal([]byte(cfg), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	httpSection := parsed["http"].(map[string]any)
	if port, ok := httpSection["port"].(string); !ok || port != "5000" {
		t.Errorf("expected port string '5000', got %v", httpSection["port"])
	}
}

func TestGenerateHtpasswd_Format(t *testing.T) {
	line, err := GenerateHtpasswd("test-secret-ok")
	if err != nil {
		t.Fatalf("GenerateHtpasswd error: %v", err)
	}
	if !strings.HasPrefix(line, "rollhook:$2") {
		t.Errorf("expected rollhook:$2... prefix, got: %s", line)
	}
	if !strings.HasSuffix(line, "\n") {
		t.Errorf("expected trailing newline, got: %q", line)
	}
}

func TestGenerateHtpasswd_VerifiesCorrectly(t *testing.T) {
	password := "test-secret-ok"
	line, err := GenerateHtpasswd(password)
	if err != nil {
		t.Fatalf("GenerateHtpasswd error: %v", err)
	}

	// Parse: "rollhook:<hash>\n" → extract hash
	line = strings.TrimSuffix(line, "\n")
	parts := strings.SplitN(line, ":", 2)
	if len(parts) != 2 {
		t.Fatalf("unexpected format: %q", line)
	}
	hash := parts[1]

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		t.Errorf("bcrypt verification failed: %v", err)
	}
}
