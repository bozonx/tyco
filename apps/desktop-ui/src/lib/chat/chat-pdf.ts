import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'

import {
  ChatFileError,
  extractedTextAttachment,
  MAX_CHAT_FILE_CHARACTERS,
} from './chat-file-input'

const MAX_PDF_PAGES = 100

export interface PdfContents {
  text?: ReturnType<typeof extractedTextAttachment>
  pages: File[]
  /** Scanned pages left out because the message has no room for more images */
  skippedPages?: number
}

/**
 * Render pages without a text layer locally, without scripts or remote
 * resources.
 */
export async function readChatPdf(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  maxImageCount: number,
  isCurrent: () => boolean
): Promise<PdfContents> {
  GlobalWorkerOptions.workerPort ??= new PdfWorker()
  const task = getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
    disableAutoFetch: true,
    isOffscreenCanvasSupported: false,
    maxImageSize: 24_000_000,
    canvasMaxAreaInBytes: 96_000_000,
    stopAtErrors: true,
    cMapUrl: `${import.meta.env.BASE_URL}pdf-assets/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdf-assets/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdf-assets/wasm/`,
  })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new ChatFileError('pdfPages')
    const textParts: string[] = []
    const pages: File[] = []
    let skippedPages = 0
    let characters = 0
    for (let index = 1; index <= pdf.numPages; index++) {
      if (!isCurrent()) return { pages: [] }
      const page = await pdf.getPage(index)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''
          )
          .join('')
          .trim()
        characters += text.length
        if (characters > MAX_CHAT_FILE_CHARACTERS)
          throw new ChatFileError('textLimit')
        if (text) textParts.push(`[Page ${index}]\n${text}`)
        const sparseImagePage =
          text.length > 0 &&
          text.length < 100 &&
          (await page.getOperatorList()).fnArray.some((operation) =>
            [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(
              operation
            )
          )
        if ((!text || sparseImagePage) && pages.length >= maxImageCount) {
          skippedPages++
        } else if (!text || sparseImagePage) {
          const base = page.getViewport({ scale: 1 })
          if (
            !Number.isFinite(base.width) ||
            !Number.isFinite(base.height) ||
            base.width <= 0 ||
            base.height <= 0
          )
            throw new ChatFileError('invalid')
          const viewport = page.getViewport({
            scale: Math.min(2, 3072 / Math.max(base.width, base.height)),
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.ceil(viewport.width))
          canvas.height = Math.max(1, Math.ceil(viewport.height))
          try {
            await page.render({ canvas, viewport }).promise
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (blob) =>
                  blob ? resolve(blob) : reject(new ChatFileError('invalid')),
                'image/png'
              )
            )
            pages.push(
              new File([blob], `${name} — page ${index}.png`, {
                type: 'image/png',
              })
            )
          } finally {
            canvas.width = 0
            canvas.height = 0
          }
        }
      } finally {
        page.cleanup()
      }
    }
    const text = textParts.join('\n\n')
    if (!text && !pages.length)
      throw new ChatFileError(skippedPages ? 'imageLimit' : 'empty')
    return {
      ...(text
        ? { text: extractedTextAttachment(text, name, 'application/pdf') }
        : {}),
      pages,
      ...(skippedPages ? { skippedPages } : {}),
    }
  } catch (error) {
    if (error instanceof ChatFileError) throw error
    if (error instanceof Error && error.name === 'PasswordException')
      throw new ChatFileError('password')
    throw new ChatFileError('invalid')
  } finally {
    await task.destroy()
  }
}
