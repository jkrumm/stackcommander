package steps_test

import (
	"testing"

	"github.com/docker/docker/api/types/container"

	"github.com/jkrumm/rollhook/internal/jobs/steps"
)

func TestExtractImageName(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"nginx", "nginx"},
		{"nginx:latest", "nginx"},
		{"localhost:5000/app:v1", "localhost:5000/app"},
		{"localhost:7700/rollhook-e2e-hello:v1", "localhost:7700/rollhook-e2e-hello"},
		{"registry.example.com/org/app:sha256abc", "registry.example.com/org/app"},
		{"myapp", "myapp"},
		{"myapp:1.2.3", "myapp"},
	}
	for _, tc := range cases {
		got := steps.ExtractImageName(tc.input)
		if got != tc.want {
			t.Errorf("ExtractImageName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestFindMatchingContainer(t *testing.T) {
	containers := []container.Summary{
		{ID: "aaa", Image: "nginx:latest", Names: []string{"/nginx"}},
		{ID: "bbb", Image: "localhost:5000/app", Names: []string{"/app"}},
		{ID: "ccc", Image: "localhost:5000/myapp:v2", Names: []string{"/myapp"}},
	}

	cases := []struct {
		imageName string
		wantID    string
	}{
		{"nginx", "aaa"},                      // bare name matches "nginx:latest"
		{"localhost:5000/app", "bbb"},         // exact match without tag
		{"localhost:5000/myapp", "ccc"},       // prefix match with tag
		{"localhost:5000/other", ""},          // no match
		{"localhost:5000/app:v3", ""},         // full tag doesn't match bare image
	}

	for _, tc := range cases {
		got := steps.FindMatchingContainer(containers, tc.imageName)
		if tc.wantID == "" {
			if got != nil {
				t.Errorf("FindMatchingContainer(%q) = %q, want nil", tc.imageName, got.ID)
			}
		} else {
			if got == nil {
				t.Errorf("FindMatchingContainer(%q) = nil, want %q", tc.imageName, tc.wantID)
			} else if got.ID != tc.wantID {
				t.Errorf("FindMatchingContainer(%q) = %q, want %q", tc.imageName, got.ID, tc.wantID)
			}
		}
	}
}

func TestExtractComposeInfo_Success(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project.config_files": "/app/compose.yml,/app/override.yml",
		"com.docker.compose.service":              "web",
		"com.docker.compose.project":              "myproject",
	}
	result, err := steps.ExtractComposeInfo(labels, "mycontainer")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ComposePath != "/app/compose.yml" {
		t.Errorf("ComposePath = %q, want %q", result.ComposePath, "/app/compose.yml")
	}
	if result.Service != "web" {
		t.Errorf("Service = %q, want %q", result.Service, "web")
	}
	if result.Project != "myproject" {
		t.Errorf("Project = %q, want %q", result.Project, "myproject")
	}
}

func TestExtractComposeInfo_NilLabels(t *testing.T) {
	_, err := steps.ExtractComposeInfo(nil, "mycontainer")
	if err == nil {
		t.Error("expected error for nil labels")
	}
}

func TestExtractComposeInfo_MissingConfigFiles(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.service": "web",
		"com.docker.compose.project": "myproject",
	}
	_, err := steps.ExtractComposeInfo(labels, "mycontainer")
	if err == nil {
		t.Error("expected error for missing config_files label")
	}
}

func TestExtractComposeInfo_MissingService(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project.config_files": "/app/compose.yml",
		"com.docker.compose.project":              "myproject",
	}
	_, err := steps.ExtractComposeInfo(labels, "mycontainer")
	if err == nil {
		t.Error("expected error for missing service label")
	}
}
