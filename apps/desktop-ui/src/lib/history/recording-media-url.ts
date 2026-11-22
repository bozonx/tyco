/**
 * The URL a call recording plays from: a `blob:` URL on Linux (WebKitGTK's
 * GStreamer pipeline rejects custom URI schemes in `isProtocolAllowed`, while
 * `blob:` is allowed and seekable) and the streaming `tyco-media://` URL on
 * Windows (`http://tyco-media.localhost/recording/<file name>`, served by
 * `src-tauri/src/services/media_protocol.rs`)
 */
export function createRecordingMediaUrl(
  file: string,
  convert: (path: string, protocol: string) => string
): string {
  const url = new URL(convert('', 'tyco-media'))
  url.pathname = `/recording/${encodeURIComponent(file)}`
  return url.href
}

export async function loadRecordingMediaSource(
  file: string,
  convert: (path: string, protocol: string) => string,
  readRecording?: (file: string) => Promise<ArrayBuffer>
): Promise<{ url: string; dispose?: () => void }> {
  const mediaUrl = createRecordingMediaUrl(file, convert)
  if (
    readRecording &&
    mediaUrl.startsWith('tyco-media:') &&
    typeof URL.createObjectURL === 'function'
  ) {
    const bytes = await readRecording(file)
    const url = URL.createObjectURL(
      new Blob([bytes], { type: 'audio/ogg; codecs=opus' })
    )
    return {
      url,
      dispose: () => {
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
      },
    }
  }
  return { url: mediaUrl }
}
