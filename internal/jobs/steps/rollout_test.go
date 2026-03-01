package steps

import (
	"testing"
)

func TestScaleTarget(t *testing.T) {
	tests := []struct {
		current int
		want    int
	}{
		{0, 1}, // first deploy: start 1, not 0
		{1, 2}, // 1 old → 2 total (1 old + 1 new)
		{2, 4}, // 2 old → 4 total
		{3, 6},
	}
	for _, tt := range tests {
		got := scaleTarget(tt.current)
		if got != tt.want {
			t.Errorf("scaleTarget(%d) = %d, want %d", tt.current, got, tt.want)
		}
	}
}

func TestSetEnvLine(t *testing.T) {
	tests := []struct {
		name    string
		content string
		key     string
		value   string
		want    string
	}{
		{
			name:    "empty content",
			content: "",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "IMAGE_TAG=app:v2",
		},
		{
			name:    "append to non-empty content without trailing newline",
			content: "FOO=bar",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "FOO=bar\nIMAGE_TAG=app:v2",
		},
		{
			name:    "append preserving trailing newline",
			content: "FOO=bar\n",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "FOO=bar\nIMAGE_TAG=app:v2\n",
		},
		{
			name:    "replace existing key",
			content: "FOO=bar\nIMAGE_TAG=app:v1\nBAZ=qux",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "FOO=bar\nIMAGE_TAG=app:v2\nBAZ=qux",
		},
		{
			name:    "replace last occurrence when key appears multiple times",
			content: "IMAGE_TAG=old\nIMAGE_TAG=app:v1",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "IMAGE_TAG=old\nIMAGE_TAG=app:v2",
		},
		{
			name:    "does not match partial key prefix",
			content: "MY_IMAGE_TAG=other\n",
			key:     "IMAGE_TAG",
			value:   "app:v2",
			want:    "MY_IMAGE_TAG=other\nIMAGE_TAG=app:v2\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := setEnvLine(tt.content, tt.key, tt.value)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEnvInt_Default(t *testing.T) {
	got := envInt("ROLLHOOK_NO_SUCH_ENV_VAR_12345", 42)
	if got != 42 {
		t.Errorf("expected default 42, got %d", got)
	}
}

func TestEnvInt_Set(t *testing.T) {
	t.Setenv("ROLLHOOK_TEST_TIMEOUT_MS", "30000")
	got := envInt("ROLLHOOK_TEST_TIMEOUT_MS", 1000)
	if got != 30000 {
		t.Errorf("expected 30000, got %d", got)
	}
}
