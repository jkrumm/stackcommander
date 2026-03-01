package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/compose-spec/compose-go/v2/cli"
	"github.com/compose-spec/compose-go/v2/loader"
)

// Validate checks that composePath is absolute, the compose file is parseable,
// the named service exists, and (if the service declares an image) that it
// references the same image name as imageTag.
func Validate(composePath, service, imageTag string) error {
	if !filepath.IsAbs(composePath) {
		return fmt.Errorf("compose_path must be absolute, got: %s", composePath)
	}

	if _, err := os.Stat(composePath); err != nil {
		return fmt.Errorf("compose file not found: %s", composePath)
	}

	opts, err := cli.NewProjectOptions(
		[]string{composePath},
		cli.WithOsEnv,
		cli.WithLoadOptions(func(o *loader.Options) {
			o.SkipValidation = true // skip strict JSON schema checks
		}),
	)
	if err != nil {
		return fmt.Errorf("validate: compose options: %w", err)
	}

	project, err := opts.LoadProject(context.Background())
	if err != nil {
		return fmt.Errorf("compose file invalid: %w", err)
	}

	svc, err := project.GetService(service)
	if err != nil {
		return fmt.Errorf("service %q not found in %s", service, composePath)
	}

	// Only check the image reference if the service has an explicit image field.
	// Build-only services (no image:) are allowed.
	if svc.Image != "" {
		imageName := ExtractImageName(imageTag)
		if !strings.Contains(svc.Image, imageName) {
			return fmt.Errorf("service %q image %q does not reference %q", service, svc.Image, imageName)
		}
	}

	return nil
}
