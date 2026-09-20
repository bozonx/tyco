export interface DownloadProgress {
  file: string
  loaded: number
  total: number
  status: 'downloading' | 'saving' | 'done' | 'error'
}

interface DownloadBinaryFileOptions {
  url: string
  fileName: string
  existingSize?: number
  onProgress?: (progress: DownloadProgress) => void
  onChunk: (chunk: Uint8Array, append: boolean) => Promise<void>
}

const STALLED_DOWNLOAD_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: Error) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (reason) => {
        clearTimeout(timer)
        reject(reason)
      }
    )
  })
}

function parseTotalFromContentRange(header: string | null): number {
  if (!header) {
    return 0
  }

  const match = /^bytes\s+\d+-\d+\/(\d+)$/.exec(header)
  return match ? Number(match[1]) || 0 : 0
}

export async function downloadBinaryFile({
  url,
  fileName,
  existingSize = 0,
  onProgress,
  onChunk,
}: DownloadBinaryFileOptions): Promise<{ loaded: number; total: number }> {
  let remoteTotal = 0
  const normalizedExistingSize = Math.max(0, existingSize)

  try {
    const headResponse = await fetch(url, { method: 'HEAD' })
    if (headResponse.ok) {
      remoteTotal = Number(headResponse.headers.get('Content-Length')) || 0
    }
  } catch {
    remoteTotal = 0
  }

  if (remoteTotal > 0 && normalizedExistingSize === remoteTotal) {
    onProgress?.({
      file: fileName,
      loaded: remoteTotal,
      total: remoteTotal,
      status: 'done',
    })
    return { loaded: remoteTotal, total: remoteTotal }
  }

  let resumeFrom =
    remoteTotal > 0 && normalizedExistingSize > remoteTotal
      ? 0
      : normalizedExistingSize

  onProgress?.({
    file: fileName,
    loaded: resumeFrom,
    total: remoteTotal,
    status: 'downloading',
  })

  const response = await fetch(
    url,
    resumeFrom > 0
      ? {
          headers: {
            Range: `bytes=${resumeFrom}-`,
          },
        }
      : undefined
  )

  if (!response.ok) {
    throw new Error(`Failed to download ${fileName}: ${response.statusText}`)
  }

  if (resumeFrom > 0 && response.status !== 206) {
    resumeFrom = 0
  }

  const total =
    parseTotalFromContentRange(response.headers.get('Content-Range')) ||
    remoteTotal ||
    (resumeFrom > 0
      ? resumeFrom + (Number(response.headers.get('Content-Length')) || 0)
      : Number(response.headers.get('Content-Length')) || 0)
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error(`Failed to read ${fileName}`)
  }

  let loaded = resumeFrom
  let append = resumeFrom > 0

  while (true) {
    const { done, value } = await withTimeout(
      reader.read(),
      STALLED_DOWNLOAD_TIMEOUT_MS,
      new Error(`Download stalled for ${fileName}`)
    )

    if (done) {
      break
    }

    loaded += value.length

    onProgress?.({
      file: fileName,
      loaded,
      total,
      status: 'saving',
    })

    await onChunk(value, append)
    append = true

    onProgress?.({
      file: fileName,
      loaded,
      total,
      status: 'downloading',
    })
  }

  onProgress?.({
    file: fileName,
    loaded: total || loaded,
    total: total || loaded,
    status: 'done',
  })

  return { loaded, total }
}
