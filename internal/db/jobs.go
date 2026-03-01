package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// JobStatus represents the lifecycle state of a deployment job.
type JobStatus string

const (
	StatusQueued  JobStatus = "queued"
	StatusRunning JobStatus = "running"
	StatusSuccess JobStatus = "success"
	StatusFailed  JobStatus = "failed"
)

// Job represents a deployment job record.
type Job struct {
	ID          string    `json:"id"`
	App         string    `json:"app"`
	Status      JobStatus `json:"status"`
	ImageTag    string    `json:"image_tag"`
	ComposePath *string   `json:"compose_path,omitempty"`
	Service     *string   `json:"service,omitempty"`
	Error       *string   `json:"error,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Store wraps a *sql.DB and provides job CRUD operations.
type Store struct {
	db *sql.DB
}

// NewStore creates a new Store backed by the given database.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Insert persists a new job record.
func (s *Store) Insert(job Job) error {
	_, err := s.db.Exec(
		`INSERT INTO jobs (id, app, status, image_tag, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		job.ID, job.App, job.Status, job.ImageTag,
		job.CreatedAt.UTC().Format(time.RFC3339),
		job.UpdatedAt.UTC().Format(time.RFC3339),
	)
	return err
}

// Get returns a job by ID, or nil if not found (not an error).
func (s *Store) Get(id string) (*Job, error) {
	row := s.db.QueryRow(
		`SELECT id, app, status, image_tag, compose_path, service, error, created_at, updated_at
		 FROM jobs WHERE id = ?`, id,
	)
	return scanRow(row)
}

// List returns jobs matching optional filters, ordered newest-first.
// Zero/empty values mean no filter; limit <= 0 defaults to 50.
func (s *Store) List(app, status string, limit int) ([]Job, error) {
	if limit <= 0 {
		limit = 50
	}

	query := `SELECT id, app, status, image_tag, compose_path, service, error, created_at, updated_at FROM jobs`
	var conditions []string
	var args []any

	if app != "" {
		conditions = append(conditions, "app = ?")
		args = append(args, app)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []Job
	for rows.Next() {
		job, err := scanRows(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, *job)
	}
	return jobs, rows.Err()
}

// UpdateStatus sets a job's status and optional error message.
func (s *Store) UpdateStatus(id string, status JobStatus, errMsg *string) error {
	_, err := s.db.Exec(
		`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`,
		status, errMsg, time.Now().UTC().Format(time.RFC3339), id,
	)
	return err
}

// UpdateDiscovery sets compose_path and service after the discover step completes.
func (s *Store) UpdateDiscovery(id string, composePath, service string) error {
	_, err := s.db.Exec(
		`UPDATE jobs SET compose_path = ?, service = ?, updated_at = ? WHERE id = ?`,
		composePath, service, time.Now().UTC().Format(time.RFC3339), id,
	)
	return err
}

// scanRow scans a single *sql.Row into a Job, returning nil for ErrNoRows.
func scanRow(row *sql.Row) (*Job, error) {
	var j Job
	var composePath, service, errMsg sql.NullString
	var createdAt, updatedAt string

	err := row.Scan(&j.ID, &j.App, &j.Status, &j.ImageTag,
		&composePath, &service, &errMsg, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if composePath.Valid {
		j.ComposePath = &composePath.String
	}
	if service.Valid {
		j.Service = &service.String
	}
	if errMsg.Valid {
		j.Error = &errMsg.String
	}
	j.CreatedAt = parseTime(createdAt)
	j.UpdatedAt = parseTime(updatedAt)
	return &j, nil
}

// scanRows scans a *sql.Rows row into a Job.
func scanRows(rows *sql.Rows) (*Job, error) {
	var j Job
	var composePath, service, errMsg sql.NullString
	var createdAt, updatedAt string

	err := rows.Scan(&j.ID, &j.App, &j.Status, &j.ImageTag,
		&composePath, &service, &errMsg, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}

	if composePath.Valid {
		j.ComposePath = &composePath.String
	}
	if service.Valid {
		j.Service = &service.String
	}
	if errMsg.Valid {
		j.Error = &errMsg.String
	}
	j.CreatedAt = parseTime(createdAt)
	j.UpdatedAt = parseTime(updatedAt)
	return &j, nil
}

// parseTime parses a stored datetime string, tolerating multiple formats.
func parseTime(s string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// --- Log file helpers ---

// LogPath returns the absolute path for a job's log file.
func LogPath(dataDir, jobID string) string {
	return filepath.Join(dataDir, "logs", jobID+".log")
}

// EnsureLogDir creates the logs directory if it doesn't exist.
func EnsureLogDir(dataDir string) error {
	return os.MkdirAll(filepath.Join(dataDir, "logs"), 0o755)
}

// AppendLog appends a timestamped line to the given log file path.
func AppendLog(logPath, line string) error {
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "[%s] %s\n", time.Now().UTC().Format(time.RFC3339), line)
	return err
}
