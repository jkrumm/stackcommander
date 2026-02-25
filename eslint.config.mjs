import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  react: true,
  astro: true,
  formatters: true,
  ignores: [
    '**/dist/**',
    '**/.output/**',
    '**/node_modules/**',
    'apps/marketing/.astro/**',
  ],
})
  .override('antfu/react/rules', {
    rules: {
      // Disable in Astro routes (not pure React)
      'react-refresh/only-export-components': 'off',
    },
  })
