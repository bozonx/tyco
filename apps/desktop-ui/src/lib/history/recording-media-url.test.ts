import { describe, expect, it } from 'vitest'

import { createRecordingMediaUrl } from './recording-media-url'

describe('recording media URLs', () => {
  it.each([
    ['tyco-media://localhost/', 'tyco-media://localhost/'],
    ['http://tyco-media.localhost/', 'http://tyco-media.localhost/'],
  ])('keeps the routing of %s and names the file', (base, expected) => {
    const convert = (path: string) => base + encodeURIComponent(path)
    expect(
      createRecordingMediaUrl('2026-11-20 14-03-05 a1b2c3.opus', convert)
    ).toBe(`${expected}recording/2026-11-20%2014-03-05%20a1b2c3.opus`)
  })

  it('keeps a file name inside the recording path', () => {
    const convert = (path: string) => `tyco-media://localhost/${path}`
    expect(createRecordingMediaUrl('../x/y.opus', convert)).toBe(
      'tyco-media://localhost/recording/..%2Fx%2Fy.opus'
    )
  })
})
