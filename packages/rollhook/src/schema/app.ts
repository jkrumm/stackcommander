import { Type } from '@sinclair/typebox'

export const AppConfigSchema = Type.Object({
  name: Type.String({ description: 'Unique app name, matches the deploy/:app route param' }),
  compose_file: Type.Optional(Type.String({ description: 'Path to docker-compose file relative to clone_path', default: 'compose.yml' })),
  steps: Type.Array(
    Type.Object({
      service: Type.String({ description: 'Docker Compose service name' }),
      wait_for_healthy: Type.Optional(Type.Boolean({ description: 'Wait for health check to pass before proceeding', default: false })),
      after: Type.Optional(Type.String({ description: 'Service name that must complete before this step starts' })),
    }),
    { description: 'Ordered rollout steps' },
  ),
  notifications: Type.Optional(Type.Object({
    on_failure: Type.Optional(Type.Boolean({ default: true })),
    on_success: Type.Optional(Type.Boolean({ default: false })),
  })),
  secrets: Type.Optional(Type.Object({
    doppler_project: Type.Optional(Type.String()),
    doppler_config: Type.Optional(Type.String()),
  })),
}, {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'RollHook App Config',
  description: 'Per-app rollhook.yaml configuration',
})
