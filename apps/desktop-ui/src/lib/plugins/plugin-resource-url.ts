/** Keeps path separators and the platform's custom-protocol routing prefix. */
export function createPluginResourceUrl(
  id: string,
  path: string,
  convert: (path: string, protocol: string) => string
): string {
  const protocol = 'tyco-plugin'
  const url = new URL(convert(path, protocol))
  const key = Array.from(new TextEncoder().encode(id), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  url.hostname = `${url.protocol === 'http:' || url.protocol === 'https:' ? `${protocol}.` : ''}${key}.localhost`
  // convertFileSrc encodes the whole filesystem path, including slashes.
  url.pathname = `/${path}`
  return url.href
}
