import { expect, it } from 'vitest'
import { voiceReplyActionParams } from './listen-reply-actions'

it('separates the heard message from the dictated AI request', () => {
  expect(
    voiceReplyActionParams(
      'quickAiRequest',
      'Decline politely',
      'Can you come?'
    )
  ).toEqual({
    text: 'Can you come?',
    prompt: 'Decline politely',
    inputMode: 'text',
  })
  expect(
    voiceReplyActionParams('voiceQuickAiRequest', 'Answer', 'Message')
      ?.inputMode
  ).toBe('voice')
  expect(
    voiceReplyActionParams('quickAiRequest', 'Answer', undefined)
  ).toBeUndefined()
  expect(
    voiceReplyActionParams('copyToClipboard', 'Answer', 'Message')
  ).toBeUndefined()
})
