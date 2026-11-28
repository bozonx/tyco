/** How many characters of an application name fit on an insert button */
export const INSERT_TARGET_NAME_MAX_CHARS = 10

/**
 * The application name as an insert button shows it: cut to `maxChars` with an
 * ellipsis; `undefined` when no name is known.
 */
export function shortInsertTargetName(
  appName: string | null | undefined,
  maxChars = INSERT_TARGET_NAME_MAX_CHARS
): string | undefined {
  const name = appName?.trim()
  if (!name) return undefined
  const chars = Array.from(name)
  if (chars.length <= maxChars) return name
  return `${chars
    .slice(0, Math.max(1, maxChars - 1))
    .join('')
    .trimEnd()}…`
}
