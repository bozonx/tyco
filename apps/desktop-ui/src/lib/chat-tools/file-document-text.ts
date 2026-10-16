import { ChatFileError } from '../chat/chat-file-error'

/**
 * The text of a PDF or a DOCX the model reads with a file tool, extracted the
 * way a file dropped into the chat is. Scanned pages are left out: a tool
 * result carries no images
 *
 * @throws Error with a reason the model can act on
 */
export async function readDocumentText(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
  mediaType: string
): Promise<string> {
  const name = path.split('/').at(-1) || path
  let text: string
  try {
    if (mediaType === 'application/pdf') {
      const { readChatPdf } = await import('../chat/chat-pdf')
      text = (await readChatPdf(bytes, name, 0, () => true)).text?.text ?? ''
    } else {
      const { readChatDocx } = await import('../chat/chat-docx')
      text = readChatDocx(bytes, name).text
    }
  } catch (error) {
    if (error instanceof ChatFileError && error.kind === 'empty') text = ''
    else
      throw new Error(
        `Could not read the text of ${path}` +
          (error instanceof ChatFileError ? ` (${error.kind})` : ''),
        { cause: error }
      )
  }
  if (!text.trim())
    throw new Error(`${path} has no text to read; it may be a scanned document`)
  return text
}
