/**
 * The `tyco-media://` URL a call recording plays from, named by its file name
 * (`src-tauri/src/services/media_protocol.rs`). `convert` is the platform's
 * custom-protocol routing (`convertFileSrc`): `tyco-media://localhost/` on
 * Linux, `http://tyco-media.localhost/` on Windows
 */
export function createRecordingMediaUrl(
  file: string,
  convert: (path: string, protocol: string) => string
): string {
  const url = new URL(convert('', 'tyco-media'))
  url.pathname = `/recording/${encodeURIComponent(file)}`
  return url.href
}
