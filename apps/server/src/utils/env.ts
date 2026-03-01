/**
 * Merges a KEY=VALUE entry into .env file content string.
 * Replaces the existing KEY= line if present, appends otherwise.
 * Preserves the file's trailing newline convention.
 */
export function setEnvLine(content: string, key: string, value: string): string {
  const keyPrefix = `${key}=`
  const newLine = `${key}=${value}`
  const lines = content.split('\n')
  const idx = lines.findLastIndex(l => l.startsWith(keyPrefix))
  if (idx >= 0) {
    lines[idx] = newLine
    return lines.join('\n')
  }
  // Append, preserving the file's trailing-newline convention
  if (content === '')
    return newLine
  if (content.endsWith('\n'))
    return `${content}${newLine}\n`
  return `${content}\n${newLine}`
}
