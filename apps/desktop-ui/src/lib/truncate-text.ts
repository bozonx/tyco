export function truncate(
  src: string | undefined | null,
  maxLength: number,
  suffix: string = '...'
): string {
  if (!src) return ''
  if (src.length <= maxLength) return src
  return src.slice(0, maxLength) + suffix
}
