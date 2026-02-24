import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  react: false,
  formatters: true,
  ignores: [
    '**/dist/**',
    '**/.output/**',
    '**/node_modules/**',
  ],
})
