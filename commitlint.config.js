export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Disabled: semantic-release generates CHANGELOG commit bodies with long GitHub URLs
    'body-max-line-length': [0],
  },
}
