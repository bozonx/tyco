import { describe, expect, it } from 'vitest'

import { buildLlmPrompt, fillTemplate } from './llm-prompt'

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

  it('fills every placeholder occurrence', () => {
    expect(
      fillTemplate('to {{LANG}}, only {{LANG}}; {{OTHER}}', { LANG: 'en_US' })
    ).toBe('to en_US, only en_US; {{OTHER}}')
  })
})
