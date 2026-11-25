/**
 * Builds a chronologically sortable, filesystem-safe dialog id:
 * `YYYY-MM-DD_HH-MM-SS_<6 hex>` in local time.
 */
export function createDialogId(nowMs = Date.now(), randomHex?: string): string {
  const date = new Date(nowMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join('_')
  const suffix = (randomHex ?? randomHexSuffix()).toLowerCase().slice(0, 6)
  return `${stamp}_${suffix.padEnd(6, '0')}`
}

function randomHexSuffix(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(3)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  }
  return Math.floor(Math.random() * 0x1_000_000)
    .toString(16)
    .padStart(6, '0')
}
