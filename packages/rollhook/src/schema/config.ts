import { Type } from '@sinclair/typebox'

export const ServerConfigSchema = Type.Object({
  apps: Type.Array(
    Type.Object({
      name: Type.String({ description: 'Unique app name, matches the deploy/:app route param' }),
      clone_path: Type.String({ description: 'Absolute path to the cloned repo on the VPS' }),
    }),
    { description: 'Registered apps' },
  ),
  notifications: Type.Optional(Type.Object({
    pushover: Type.Optional(Type.Object({
      user_key: Type.String(),
      app_token: Type.String(),
    })),
    webhook: Type.Optional(Type.String({ description: 'URL to POST job result JSON to' })),
  })),
}, {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'RollHook Server Config',
  description: 'rollhook.config.yaml — server-side configuration',
})
