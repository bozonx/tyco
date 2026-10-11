import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(),
  page: vi.fn(),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
  OPS: { paintImageXObject: 85, paintInlineImageXObject: 86 },
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker', () => ({
  default: class {},
}))
import { readChatPdf } from './chat-pdf'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: mocks.page }),
    destroy: mocks.destroy,
  })
})

describe('PDF local extraction', () => {
  it('extracts text without rendering and releases the loading task', async () => {
    const cleanup = vi.fn()
    const render = vi.fn()
    mocks.page.mockResolvedValue({
      getTextContent: async () => ({
        items: [{ str: 'hello', hasEOL: true }, { str: 'world' }],
      }),
      render,
      getOperatorList: async () => ({ fnArray: [] }),
      cleanup,
    })
    const result = await readChatPdf(
      new Uint8Array([1]),
      'report.pdf',
      4,
      () => true
    )
    expect(result.text?.text).toBe('[Page 1]\nhello\nworld')
    expect(result.pages).toEqual([])
    expect(render).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('rejects scans without image slots instead of omitting pages', async () => {
    mocks.page.mockResolvedValue({
      getTextContent: async () => ({ items: [] }),
      cleanup: vi.fn(),
    })
    await expect(
      readChatPdf(new Uint8Array([1]), 'scan.pdf', 0, () => true)
    ).rejects.toMatchObject({ kind: 'imageLimit' })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('renders scan pages and returns a named image', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }))
    mocks.page.mockResolvedValue({
      getTextContent: async () => ({ items: [] }),
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      }),
      render,
      cleanup: vi.fn(),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback) => callback(new Blob(['png'], { type: 'image/png' }))
    )
    const result = await readChatPdf(
      new Uint8Array([1]),
      'scan.pdf',
      1,
      () => true
    )
    expect(result.text).toBeUndefined()
    expect(result.pages[0].name).toBe('scan.pdf — page 1.png')
    expect(render).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })
  it('reports passwords and page limits, and cancels replaced drafts', async () => {
    mocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(
        Object.assign(new Error(), { name: 'PasswordException' })
      ),
      destroy: mocks.destroy,
    })
    await expect(
      readChatPdf(new Uint8Array([1]), 'locked.pdf', 4, () => true)
    ).rejects.toMatchObject({ kind: 'password' })
    mocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 101 }),
      destroy: mocks.destroy,
    })
    await expect(
      readChatPdf(new Uint8Array([1]), 'long.pdf', 4, () => true)
    ).rejects.toMatchObject({ kind: 'pdfPages' })
    expect(
      await readChatPdf(new Uint8Array([1]), 'old.pdf', 4, () => false)
    ).toEqual({ pages: [] })
    expect(mocks.page).not.toHaveBeenCalled()
  })
})

it('keeps scanned page images even when a small footer text layer exists', async () => {
  mocks.page.mockResolvedValue({
    getTextContent: async () => ({ items: [{ str: 'Page 1' }] }),
    getOperatorList: async () => ({ fnArray: [85] }),
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(new Blob(['png'], { type: 'image/png' }))
  )
  try {
    const result = await readChatPdf(
      new Uint8Array([1]),
      'scan.pdf',
      1,
      () => true
    )
    expect(result.text?.text).toContain('Page 1')
    expect(result.pages).toHaveLength(1)
  } finally {
    vi.restoreAllMocks()
  }
})
