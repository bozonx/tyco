export type ClipboardChatFiles =
  { kind: 'files'; files: File[] } | { kind: 'paths'; paths: string[] }

type ClipboardData = Pick<DataTransfer, 'files' | 'getData'> & {
  items?: DataTransfer['items']
}

/** A local `file://` URI as a path the Rust side can read, or null */
export function fileUriToPath(uri: string): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  // a file on another host is a network share, not a local file
  if (url.protocol !== 'file:' || (url.host && url.host !== 'localhost'))
    return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  // file:///C:/dir/file is C:/dir/file on Windows
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path || null
}

function clipboardFiles(data: ClipboardData): File[] {
  const files = Array.from(data.files || [])
  if (files.length) return files
  // some webviews expose a pasted image only as an item
  return Array.from(data.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/**
 * What a paste attaches to the chat, or null for an ordinary text paste. Office
 * apps put a picture of copied text next to the text itself: a paste with text
 * stays a text paste, and only a clipboard without text attaches its files.
 * Files copied in a file manager come as `file://` URIs (and their paths as
 * text); they are read by path, like dropped files.
 */
export function clipboardChatFiles(
  data: ClipboardData | null | undefined
): ClipboardChatFiles | null {
  if (!data) return null
  const files = clipboardFiles(data)
  if (files.length && !data.getData('text/plain'))
    return { kind: 'files', files }
  const uris = data
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (!uris.length) return null
  const paths = uris.map(fileUriToPath)
  // a link copied in a browser is text to paste, not a file
  if (paths.some((path) => path === null)) return null
  return { kind: 'paths', paths: paths as string[] }
}
