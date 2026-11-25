import { describe, expect, it, vi } from 'vitest'

import {
  createDataUrl,
  createRecordingMediaUrl,
  loadRecordingMediaSource,
} from './recording-media-url'

const DIALOG_ID = '2026-11-20_14-03-05_a1b2c3'

describe('recording media URLs', () => {
  it.each([
    ['tyco-media://localhost/', 'tyco-media://localhost/'],
    ['http://tyco-media.localhost/', 'http://tyco-media.localhost/'],
  ])('keeps the routing of %s and names the file', (base, expected) => {
    const convert = (path: string) => base + encodeURIComponent(path)
    expect(
      createRecordingMediaUrl(
        DIALOG_ID,
        '2026-11-20 14-03-05 a1b2c3.opus',
        convert
      )
    ).toBe(
      `${expected}recording/${DIALOG_ID}/2026-11-20%2014-03-05%20a1b2c3.opus`
    )
  })

  it('keeps a file name inside the recording path', () => {
    const convert = (path: string) => `tyco-media://localhost/${path}`
    expect(createRecordingMediaUrl(DIALOG_ID, '../x/y.opus', convert)).toBe(
      `tyco-media://localhost/recording/${DIALOG_ID}/..%2Fx%2Fy.opus`
    )
  })

  it('encodes bytes as a data URL', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, index) => index % 251)
    const url = createDataUrl(bytes.buffer, 'audio/ogg')
    expect(url.startsWith('data:audio/ogg;base64,')).toBe(true)
    const decoded = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    expect(new Uint8Array(decoded)).toEqual(bytes)
  })

  it('creates a data URL on Linux where tyco-media:// is not a GStreamer URI scheme', async () => {
    const convert = () => 'tyco-media://localhost/'
    const readRecording = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
    const source = await loadRecordingMediaSource(
      DIALOG_ID,
      '2026-11-20 14-03-05 a1b2c3.opus',
      convert,
      readRecording
    )
    expect(readRecording).toHaveBeenCalledWith(
      DIALOG_ID,
      '2026-11-20 14-03-05 a1b2c3.opus'
    )
    expect(source.url).toBe('data:audio/ogg;base64,AQID')
  })

  it('streams directly from http://tyco-media.localhost/ on Windows', async () => {
    const convert = () => 'http://tyco-media.localhost/'
    const readRecording = vi.fn()
    const source = await loadRecordingMediaSource(
      DIALOG_ID,
      '2026-11-20 14-03-05 a1b2c3.opus',
      convert,
      readRecording
    )
    expect(readRecording).not.toHaveBeenCalled()
    expect(source.url).toBe(
      `http://tyco-media.localhost/recording/${DIALOG_ID}/2026-11-20%2014-03-05%20a1b2c3.opus`
    )
  })
})
