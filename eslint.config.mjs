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
    'apps/dashboard/src/api/generated/**',
    'docs/**',
    'e2e/fixtures/validate/invalid.yml',
  ],
})
  .override('antfu/react/rules', {
    rules: {
      // Disable in Astro routes (not pure React)
      'react-refresh/only-export-components': 'off',
    },
  })
  .override('antfu/regexp/rules', {
    rules: {
      // e18e/prefer-static-regex + eslint-plugin-regexp@3.1.0 causes a
      // stack overflow in regexp/no-useless-dollar-replacements when it
      // tries to dereference variable-held regexes. Disable until fixed.
      'e18e/prefer-static-regex': 'off',
    },
  })
  .override('antfu/perfectionist/setup', {
    rules: {
      // Treat bun:* modules as builtins (same category as node:*) so they
      // sort together and lint:fix doesn't cycle between two valid orderings.
      'perfectionist/sort-imports': ['error', {
        environment: 'bun',
        internalPattern: ['^@/.*'],
        groups: [
          'type-import',
          ['type-parent', 'type-sibling', 'type-index', 'type-internal'],
          'value-builtin',
          'value-external',
          'value-internal',
          ['value-parent', 'value-sibling', 'value-index'],
          'side-effect',
          'ts-equals-import',
          'unknown',
        ],
        newlinesBetween: 'ignore',
        newlinesInside: 'ignore',
        order: 'asc',
        type: 'natural',
      }],
    },
  })
