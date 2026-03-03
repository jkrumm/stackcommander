package steps

import (
	"context"
	"fmt"

	"github.com/docker/docker/client"

	dockerpkg "github.com/jkrumm/rollhook/internal/docker"
)

// Pull pulls imageTag, logging high-signal events via logFn.
// secret is the ROLLHOOK_SECRET used to authenticate against localhost registries.
func Pull(ctx context.Context, cli *client.Client, imageTag, secret string, logFn func(string)) error {
	logFn(fmt.Sprintf("[pull] Pulling %s", imageTag))
	if err := dockerpkg.PullImage(ctx, cli, imageTag, func(line string) {
		logFn(fmt.Sprintf("[pull] %s", line))
	}, secret); err != nil {
		return err
	}
	return nil
}
