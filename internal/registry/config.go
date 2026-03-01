package registry

import (
	"encoding/json"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// ZotUser is the fixed internal username for Zot — never exposed to end users.
const ZotUser = "rollhook"

// ZotPassword returns the Zot internal password, which is always ROLLHOOK_SECRET.
// Deterministic and stateless: same password every restart, no random state.
// Security is fine: Zot binds to 127.0.0.1 (loopback only).
func ZotPassword(secret string) string { return secret }

type zotConfig struct {
	DistSpecVersion string     `json:"distSpecVersion"`
	HTTP            zotHTTP    `json:"http"`
	Storage         zotStorage `json:"storage"`
	Log             zotLog     `json:"log"`
}

type zotHTTP struct {
	Address string      `json:"address"`
	Port    string      `json:"port"`
	Auth    zotAuth     `json:"auth"`
	Compat  []string    `json:"compat"`
}

type zotAuth struct {
	Htpasswd zotHtpasswd `json:"htpasswd"`
}

type zotHtpasswd struct {
	Path string `json:"path"`
}

type zotStorage struct {
	RootDirectory string `json:"rootDirectory"`
}

type zotLog struct {
	Level string `json:"level"`
}

// GenerateZotConfig returns a Zot JSON config as a string.
// The compat: ["docker2s2"] field is critical — without it Zot rejects Docker v2
// manifests (application/vnd.docker.distribution.manifest.v2+json) with 415.
func GenerateZotConfig(storageRoot, htpasswdPath string, port int) string {
	cfg := zotConfig{
		DistSpecVersion: "1.1.1",
		HTTP: zotHTTP{
			Address: "127.0.0.1",
			Port:    fmt.Sprintf("%d", port),
			Auth: zotAuth{
				Htpasswd: zotHtpasswd{Path: htpasswdPath},
			},
			Compat: []string{"docker2s2"},
		},
		Storage: zotStorage{RootDirectory: storageRoot},
		Log:     zotLog{Level: "info"},
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		panic(fmt.Sprintf("marshal zot config: %v", err))
	}
	return string(data)
}

// GenerateHtpasswd returns a bcrypt htpasswd line for ZotUser at cost 12.
// Zot's Go bcrypt library accepts both $2a$ and $2b$ prefixes.
func GenerateHtpasswd(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", fmt.Errorf("bcrypt hash: %w", err)
	}
	return fmt.Sprintf("%s:%s\n", ZotUser, string(hash)), nil
}
