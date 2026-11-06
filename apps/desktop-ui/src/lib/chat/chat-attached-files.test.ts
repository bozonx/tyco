import type { ChatAttachment } from '@tyco/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  attachmentPath,
  conversationAttachedFiles,
  messageFileIds,
  withKeptOriginals,
} from './chat-attached-files'

const id = (char: string) => char.repeat(64)
const attachment = (name: string, fileId?: string): ChatAttachment => ({
  text: 'text',
  name,
  ...(fileId ? { file: { id: fileId, size: 4 } } : {}),
})

describe('chat-attached-files', () => {
  it('names every original once, numbering equal names in order', () => {
    const attachments = [
      attachment('report.pdf', id('a')),
      attachment('Report.pdf', id('b')),
      attachment('report.pdf', id('a')),
      attachment('notes', id('c')),
      attachment('notes', id('d')),
      attachment('pasted text'),
      attachment('../evil/..', id('e')),
    ]

    const files = conversationAttachedFiles(attachments)

    expect(files).toEqual([
      { name: 'report.pdf', id: id('a') },
      { name: 'Report (2).pdf', id: id('b') },
      { name: 'notes', id: id('c') },
      { name: 'notes (2)', id: id('d') },
      { name: 'file', id: id('e') },
    ])
    expect(attachmentPath(attachments[1], files)).toBe(
      'attachments/Report (2).pdf'
    )
    expect(attachmentPath(attachments[5], files)).toBeUndefined()
  })

  it('collects the images and originals of messages', () => {
    expect(
      messageFileIds([
        {
          role: 'user',
          content: '',
          attachments: [attachment('a', id('a')), attachment('b')],
          images: [
            {
              id: id('i'),
              mediaType: 'image/webp',
              width: 1,
              height: 1,
              size: 1,
            },
          ],
        },
      ])
    ).toEqual([id('i'), id('a')])
  })

  it('keeps the original of a file with text, and attaches it anyway on failure', async () => {
    const file = new File(['Report'], 'r.txt')
    const prepare = vi.fn(async () => ({
      attachments: [{ text: 'Report', name: 'r.txt' }],
      images: [],
    }))
    const storeFile = vi.fn(async () => ({ id: id('a'), size: 6 }))
    const warn = vi.fn()
    const wrapped = withKeptOriginals(prepare, { storeFile, warn })

    const kept = await wrapped(file, 4, () => true)
    expect(kept.attachments[0].file).toEqual({ id: id('a'), size: 6 })

    storeFile.mockRejectedValueOnce(new Error('memory'))
    const failed = await wrapped(file, 4, () => true)
    expect(failed.attachments[0].file).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('keeps nothing for images only or a replaced draft', async () => {
    const storeFile = vi.fn()
    const images = withKeptOriginals(
      async () => ({ attachments: [], images: [] }),
      { storeFile, warn: vi.fn() }
    )
    await images(new File(['x'], 'x.png'), 4, () => true)
    const replaced = withKeptOriginals(
      async () => ({ attachments: [{ text: 'x' }], images: [] }),
      { storeFile, warn: vi.fn() }
    )
    await replaced(new File(['x'], 'x.txt'), 4, () => false)
    expect(storeFile).not.toHaveBeenCalled()
  })
})
