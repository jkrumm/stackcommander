package db

import (
	"testing"
)

func TestOpen_PingSucceeds(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(dir)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer database.Close()

	if err := database.Ping(); err != nil {
		t.Errorf("Ping failed after Open: %v", err)
	}
}
