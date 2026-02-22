import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  react: true,
  formatters: true,
  ignores: [
    '**/dist/**',
    '**/.output/**',
    '**/.vinxi/**',
    '**/node_modules/**',
  ],
})
