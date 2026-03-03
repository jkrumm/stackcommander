package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/compose-spec/compose-go/v2/cli"
	"github.com/compose-spec/compose-go/v2/loader"
	"go.yaml.in/yaml/v4"
)

// rawComposeService holds only the image field, parsed without variable substitution.
type rawComposeService struct {
	Image string `yaml:"image"`
}

type rawComposeFile struct {
	Services map[string]rawComposeService `yaml:"services"`
}

// Validate checks that composePath is absolute, the compose file is parseable,
// and the named service satisfies all rolling-deploy requirements:
//   - no port bindings (prevents a second instance from starting)
//   - no fixed container_name (blocks scale-up)
//   - healthcheck defined (required for zero-downtime polling)
//   - image field references ${IMAGE_TAG} (ensures deploy uses the new image)
func Validate(composePath, service, imageTag string, logFn func(string)) error {
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

	if len(svc.Ports) > 0 {
		return fmt.Errorf("service must not expose ports — port bindings prevent a second instance from starting")
	}

	if svc.ContainerName != "" {
		return fmt.Errorf("service must not set container_name — a fixed name blocks rollout scale-up")
	}

	if svc.HealthCheck == nil || svc.HealthCheck.Disable {
		return fmt.Errorf("service must define healthcheck — required for zero-downtime rolling deploys")
	}

	// Check raw YAML (before variable substitution) that the image field references IMAGE_TAG.
	// compose-go resolves ${IMAGE_TAG:-default} at load time, so svc.Image cannot be used here.
	if svc.Image != "" {
		rawBytes, readErr := os.ReadFile(composePath)
		if readErr == nil {
			var raw rawComposeFile
			if unmarshalErr := yaml.Unmarshal(rawBytes, &raw); unmarshalErr == nil {
				if rawSvc, ok := raw.Services[service]; ok && rawSvc.Image != "" {
					if !strings.Contains(rawSvc.Image, "IMAGE_TAG") {
						return fmt.Errorf("service image must reference IMAGE_TAG (got: %s)", rawSvc.Image)
					}
				}
			}
		}
	}

	return nil
}
