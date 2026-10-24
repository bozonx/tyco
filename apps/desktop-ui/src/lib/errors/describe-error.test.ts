import { DESKTOP_ERROR_CODES } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { DESKTOP_ERROR_KEYS, DesktopIpcError } from '../desktop/ipc-error'
import enUS from '../i18n/locales/en-US.json'
import { LlmError } from '../llm/llm-client'
import { formatLlmError } from '../llm/llm-errors'
import { describeError } from './describe-error'
import { MAX_ERROR_DETAIL_CHARACTERS, withErrorDetail } from './error-detail'

const keyOnly = (key: string) => key

describe('describeError', () => {
  it('formats provider errors like formatLlmError', () => {
    const error = new LlmError('auth', 'Rejected')
    expect(describeError(error, keyOnly)).toBe(formatLlmError(error, keyOnly))
  })

  it('gives desktop errors a localized summary and keeps the message as detail', () => {
    const error = new DesktopIpcError('notFound', 'No such folder: /x', null)
    expect(describeError(error, keyOnly)).toBe(
      'desktopErrors.notFound\nNo such folder: /x'
    )
    expect(describeError({ code: 'busy', message: 'Recording' }, keyOnly)).toBe(
      'desktopErrors.busy\nRecording'
    )
  })

  it('keeps the message of other errors as it is', () => {
    expect(describeError(new Error('Unavailable'), keyOnly)).toBe('Unavailable')
    expect(describeError('Failed', keyOnly)).toBe('Failed')
  })
})

describe('withErrorDetail', () => {
  it('cuts long details and drops blank or repeated ones', () => {
    expect(
      withErrorDetail('S', 'x'.repeat(MAX_ERROR_DETAIL_CHARACTERS + 1))
    ).toBe(`S\n${'x'.repeat(MAX_ERROR_DETAIL_CHARACTERS)}…`)
    expect(withErrorDetail('S', '  ')).toBe('S')
    expect(withErrorDetail('S', ' S ')).toBe('S')
  })
})

describe('DESKTOP_ERROR_KEYS', () => {
  it('names a message of the base locale for every error code', () => {
    const messages: Record<string, string> = enUS.desktopErrors
    for (const code of DESKTOP_ERROR_CODES)
      expect(
        messages[DESKTOP_ERROR_KEYS[code].replace('desktopErrors.', '')]
      ).toBeTruthy()
  })
})
