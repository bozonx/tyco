import { describe, expect, it } from 'vitest'

import { buildLlmPrompt } from './llm-prompt'

describe('llm-prompt', () => {
  it('puts instructions and rules into the system prompt', () => {
    const prompt = buildLlmPrompt('  some text  ', {
      instructions: ' Correct the text. ',
      rules: ' - be brief ',
      rulePrefix: 'Rules',
    })

    expect(prompt).toEqual({
      system: 'Correct the text.\n\nRules:\n\n- be brief',
      messages: [{ role: 'user', content: 'some text' }],
    })
  })

  it('leaves out an empty system prompt', () => {
    expect(buildLlmPrompt('hi', { rules: '  ', rulePrefix: 'Rules' })).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
    })
  })

  it('keeps a conversation and moves developer messages to the system', () => {
    const prompt = buildLlmPrompt(
      [
        { role: 'developer', content: 'Act as a role' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      { instructions: 'Answer only', rulePrefix: 'Rules' }
    )

    expect(prompt.system).toBe('Answer only\n\nAct as a role')
    expect(prompt.messages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ])
  })

  it('includes stored attachments in conversation context', () => {
    const prompt = buildLlmPrompt(
      [
        {
          role: 'user',
          content: 'Explain it',
          attachments: [{ text: 'Source text' }],
        },
      ],
      { rulePrefix: 'Rules' }
    )

    expect(prompt.messages[0]?.content).toContain(
      '<attachment>\nSource text\n</attachment>'
    )
    expect(prompt.messages[0]?.content).toContain('Source text')
    expect(prompt.messages[0]?.content).toContain('Explain it')
  })
})

describe('image prompts', () => {
  const image = {
    id: 'image',
    mediaType: 'image/png' as const,
    width: 1,
    height: 1,
    size: 3,
  }
  it('includes image bytes for both historical and current user messages', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const prompt = buildLlmPrompt(
      [
        { role: 'user', content: 'Earlier', images: [image] },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: '', images: [image] },
      ],
      { rulePrefix: 'Rules', imageBytes: new Map([['image', bytes]]) }
    )
    expect(prompt.messages[0].content).toEqual([
      { type: 'text', text: 'Earlier' },
      { type: 'file', data: bytes, mediaType: 'image/png' },
    ])
    expect(prompt.messages[2].content).toEqual([
      { type: 'file', data: bytes, mediaType: 'image/png' },
    ])
  })
  it('never silently drops an unavailable image', () => {
    expect(() =>
      buildLlmPrompt([{ role: 'user', content: '', images: [image] }], {
        rulePrefix: 'Rules',
      })
    ).toThrow('Chat image is unavailable')
  })
})
