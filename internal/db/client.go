package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Open opens (or creates) the SQLite database at dataDir/rollhook.db.
// It enables WAL mode for concurrent reads and runs idempotent migrations.
func Open(dataDir string) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "logs"), 0o755); err != nil {
		return nil, fmt.Errorf("create logs dir: %w", err)
	}

	dbPath := filepath.Join(dataDir, "rollhook.db")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// WAL mode allows concurrent reads (SSE log streaming) alongside writes.
	if _, err := database.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("enable WAL: %w", err)
	}

	if err := migrate(database); err != nil {
		database.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return database, nil
}

// migrate creates the jobs table and applies idempotent column additions.
// Matches the TypeScript PRAGMA table_info approach for backward compatibility.
func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS jobs (
			id           TEXT PRIMARY KEY,
			app          TEXT NOT NULL,
			status       TEXT NOT NULL DEFAULT 'queued',
			image_tag    TEXT NOT NULL,
			compose_path TEXT,
			service      TEXT,
			error        TEXT,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create jobs table: %w", err)
	}

	// Idempotent column additions for databases created before compose_path/service existed.
	rows, err := db.Query("PRAGMA table_info(jobs)")
	if err != nil {
		return fmt.Errorf("PRAGMA table_info: %w", err)
	}
	defer rows.Close()

	cols := map[string]bool{}
	for rows.Next() {
		var (
			cid     int
			name    string
			colType string
			notNull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return err
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if !cols["compose_path"] {
		if _, err := db.Exec("ALTER TABLE jobs ADD COLUMN compose_path TEXT"); err != nil {
			return fmt.Errorf("add compose_path column: %w", err)
		}
	}
	if !cols["service"] {
		if _, err := db.Exec("ALTER TABLE jobs ADD COLUMN service TEXT"); err != nil {
			return fmt.Errorf("add service column: %w", err)
		}
	}

	return nil
}
