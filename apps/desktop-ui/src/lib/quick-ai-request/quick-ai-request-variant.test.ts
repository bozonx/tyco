import { describe, expect, it } from 'vitest'

import { quickAiRequestVariantOf } from './quick-ai-request-variant'

describe('quickAiRequestVariantOf', () => {
  it.each([
    ['quickAiRequest', 'text', false],
    ['voiceQuickAiRequest', 'voice', false],
    ['screenshotQuickAiRequest', 'text', true],
    ['voiceScreenshotQuickAiRequest', 'voice', true],
  ] as const)('maps %s', (mode, inputMode, isScreenshot) => {
    expect(quickAiRequestVariantOf(mode)).toEqual({ inputMode, isScreenshot })
  })

  it('opens no quick request for the other modes', () => {
    expect(quickAiRequestVariantOf('chat')).toBeNull()
    expect(quickAiRequestVariantOf(null)).toBeNull()
  })
})
