import { describe, expect, it, vi } from 'vitest'

import { downloadBinaryFile } from './file-download'

function createResponse(options: {
  ok?: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  chunks?: number[][]
}) {
  const headers = new Headers(options.headers)
  const chunks = options.chunks || []
  let index = 0

  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers,
    body: {
      getReader() {
        return {
          read: vi.fn(async () => {
            if (index >= chunks.length) {
              return { done: true, value: undefined }
            }

            const value = new Uint8Array(chunks[index]!)
            index += 1
            return { done: false, value }
          }),
        }
      },
    },
  }
}

describe('file download', () => {
  it('skips fetching the body when local file is already complete', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createResponse({
        headers: {
          'Content-Length': '128',
        },
      })
    )

    vi.stubGlobal('fetch', fetchMock)
    const onChunk = vi.fn()

    const result = await downloadBinaryFile({
      url: 'https://example.com/model.bin',
      fileName: 'model.bin',
      existingSize: 128,
      onChunk,
    })

    expect(result).toEqual({ loaded: 128, total: 128 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/model.bin', {
      method: 'HEAD',
    })
    expect(onChunk).not.toHaveBeenCalled()
  })

  it('resumes downloading from the saved offset when the server supports range requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          headers: {
            'Content-Length': '10',
          },
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          status: 206,
          headers: {
            'Content-Length': '6',
            'Content-Range': 'bytes 4-9/10',
          },
          chunks: [
            [5, 6, 7],
            [8, 9, 10],
          ],
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    const onChunk = vi.fn(async () => {})
    const onProgress = vi.fn()

    const result = await downloadBinaryFile({
      url: 'https://example.com/model.bin',
      fileName: 'model.bin',
      existingSize: 4,
      onChunk,
      onProgress,
    })

    expect(result).toEqual({ loaded: 10, total: 10 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/model.bin',
      {
        method: 'HEAD',
      }
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/model.bin',
      {
        headers: {
          Range: 'bytes=4-',
        },
      }
    )
    expect(onChunk).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), true)
    expect(onChunk).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), true)
    expect(onProgress).toHaveBeenCalledWith({
      file: 'model.bin',
      loaded: 4,
      total: 10,
      status: 'downloading',
    })
    expect(onProgress).toHaveBeenLastCalledWith({
      file: 'model.bin',
      loaded: 10,
      total: 10,
      status: 'done',
    })
  })
})
