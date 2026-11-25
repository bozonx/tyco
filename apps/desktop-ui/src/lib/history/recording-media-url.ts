/**
 * The URL a call recording plays from: a `data:` URL on Linux and the streaming
 * `tyco-media://` URL on Windows
 * (`http://tyco-media.localhost/recording/<dialog id>/<file name>`, served by
 * `src-tauri/src/services/media_protocol.rs`).
 *
 * WebKitGTK's GStreamer pipeline rejects custom URI schemes in
 * `isProtocolAllowed`. A `blob:` URL is allowed but feeds `oggdemux` wrong data
 * after its seek to the end for the duration: a long recording then jumps ahead
 * by minutes at 1×. A `data:` URL plays and seeks like a file.
 */
export function createRecordingMediaUrl(
  dialogId: string,
  file: string,
  convert: (path: string, protocol: string) => string
): string {
  const url = new URL(convert('', 'tyco-media'))
  url.pathname = `/recording/${encodeURIComponent(dialogId)}/${encodeURIComponent(file)}`
  return url.href
}

const RECORDING_MIME_TYPE = 'audio/ogg'
/** Bytes per `String.fromCharCode` call, below the argument limit */
const BASE64_CHUNK_BYTES = 0x8000

/** `bytes` as a `data:` URL of `mimeType` */
export function createDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes)
  const parts: string[] = []
  for (let offset = 0; offset < view.length; offset += BASE64_CHUNK_BYTES) {
    parts.push(
      String.fromCharCode(...view.subarray(offset, offset + BASE64_CHUNK_BYTES))
    )
  }
  return `data:${mimeType};base64,${btoa(parts.join(''))}`
}

export async function loadRecordingMediaSource(
  dialogId: string,
  file: string,
  convert: (path: string, protocol: string) => string,
  readRecording?: (dialogId: string, file: string) => Promise<ArrayBuffer>
): Promise<{ url: string; dispose?: () => void }> {
  const mediaUrl = createRecordingMediaUrl(dialogId, file, convert)
  if (readRecording && mediaUrl.startsWith('tyco-media:')) {
    const bytes = await readRecording(dialogId, file)
    return { url: createDataUrl(bytes, RECORDING_MIME_TYPE) }
  }
  return { url: mediaUrl }
}
