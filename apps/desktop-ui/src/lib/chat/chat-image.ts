import { isChatWebUrl } from './chat-markdown'

/**
 * Mirrors `MAX_CHAT_IMAGE_RESPONSE_BYTES` in
 * `src-tauri/src/services/net/http.rs`
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
])

/** Load images through the injected Rust transport, with bounded memory. */
export async function loadChatImage(
  url: string,
  signal: AbortSignal,
  fetchImage: typeof fetch
): Promise<Blob> {
  if (!isChatWebUrl(url)) throw new Error('Unsupported image URL')
  const response = await fetchImage(url, { signal, credentials: 'omit' })
  const type =
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ??
    ''
  if (
    !response.ok ||
    !IMAGE_TYPES.has(type) ||
    Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES
  ) {
    await response.body?.cancel()
    throw new Error('Unsupported image response')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty image response')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) throw new Error('Image size limit exceeded')
      chunks.push(new Uint8Array(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  if (!size) throw new Error('Empty image response')
  if (type === 'image/svg+xml') {
    const { createChatSvgImage } = await import('./chat-svg')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder().decode(bytes)
    return createChatSvgImage(text)
  }
  return new Blob(chunks, { type })
}
