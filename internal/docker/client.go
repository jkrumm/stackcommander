package docker

import "github.com/docker/docker/client"

// NewClient creates a Docker client from DOCKER_HOST env or default socket.
// Caller is responsible for closing.
func NewClient() (*client.Client, error) {
	return client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
}
