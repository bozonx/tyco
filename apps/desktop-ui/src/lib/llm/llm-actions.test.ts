import { describe, expect, it, vi } from 'vitest'
import { APP_CONFIG, DEFAULT_USER_CONFIG, type ChatMessage } from '@tyco/shared'
import { createLlmActions } from './llm-actions'
import { CHAT_TITLE_INSTRUCTIONS } from '../chat/chat-title'
import { chatAnswer } from '../chat/testing'

function fixture() {
  const userConfig = structuredClone(DEFAULT_USER_CONFIG)
  const aiRequest = Object.assign(
    vi.fn(async () => 'Answer'),
    { chatTurn: vi.fn(async () => chatAnswer('Answer')) }
  )
  const notifyEmptyText = vi.fn()
  const actions = createLlmActions({
    aiRequest,
    getUserConfig: () => userConfig,
    getAppConfig: () => APP_CONFIG,
    notifyEmptyText,
  })
  return { userConfig, aiRequest, notifyEmptyText, actions }
}

describe('LLM application actions', () => {
  it('reads the current rules on each correction and preserves cancellation options', async () => {
    const f = fixture()
    const signal = new AbortController().signal
    f.userConfig.llm.tasks.correction.rule = 'First rules'
    await f.actions.correctText('Sample', { signal, notifyError: false })
    expect(f.aiRequest).toHaveBeenLastCalledWith('correction', 'Sample', {
      instructions: APP_CONFIG.aiInstructions.correction,
      rules: 'First rules',
      signal,
      notifyError: false,
    })
    f.userConfig.llm.tasks.correction.rule = 'Updated rules'
    await f.actions.correctText('Next')
    expect(f.aiRequest).toHaveBeenLastCalledWith(
      'correction',
      'Next',
      expect.objectContaining({ rules: 'Updated rules' })
    )
  })

  it('runs voice correction with its own instructions and rules', async () => {
    const f = fixture()
    f.userConfig.llm.tasks.voiceCorrection.rule = 'Voice rules'
    const signal = new AbortController().signal
    expect(await f.actions.voiceCorrection('Transcript', signal)).toBe('Answer')
    expect(f.aiRequest).toHaveBeenCalledWith('voiceCorrection', 'Transcript', {
      instructions: APP_CONFIG.aiInstructions.voiceCorrection,
      rules: 'Voice rules',
      signal,
    })
  })

  it('preserves chat history, model and streaming options without mutating messages', async () => {
    const f = fixture()
    const history: ChatMessage[] = [{ role: 'assistant', content: 'Previous' }]
    const onUpdate = vi.fn()
    await f.actions.sendChatMessage('Question', history, undefined, {
      modelId: 'chosen',
      rules: 'Chat rules',
      onUpdate,
    })
    expect(history).toEqual([{ role: 'assistant', content: 'Previous' }])
    expect(f.aiRequest.chatTurn).toHaveBeenCalledWith(
      [...history, { role: 'user', content: 'Question' }],
      {
        modelId: 'chosen',
        onUpdate,
        notifyError: false,
        instructions: APP_CONFIG.aiInstructions.chat,
        rules: 'Chat rules',
      }
    )
    const message: ChatMessage = {
      role: 'user',
      content: 'Image question',
      images: [
        { id: 'image', mediaType: 'image/webp', width: 1, height: 1, size: 1 },
      ],
    }
    await f.actions.sendChatMessage(message, [], 'Custom instructions', {
      modelId: 'chosen',
      onUpdate,
    })
    expect(f.aiRequest.chatTurn).toHaveBeenLastCalledWith(
      [message],
      expect.objectContaining({ instructions: 'Custom instructions' })
    )
  })

  it('generates a title on the selected model without user chat rules', async () => {
    const f = fixture()
    f.aiRequest.mockResolvedValue('"A useful title"')
    const signal = new AbortController().signal
    expect(
      await f.actions.generateChatTitle('Question', 'Answer', 'model', signal)
    ).toBe('A useful title')
    expect(f.aiRequest).toHaveBeenCalledWith('chat', expect.any(String), {
      modelId: 'model',
      notifyError: false,
      instructions: CHAT_TITLE_INSTRUCTIONS,
      signal,
    })
  })

  it('uses a trimmed custom prompt and refuses empty inputs', async () => {
    const f = fixture()
    expect(await f.actions.aiCustomPrompt('  Summarize  ', 'Sample')).toBe(
      'Answer'
    )
    expect(f.aiRequest).toHaveBeenCalledWith('aiTask', 'Sample', {
      instructions: APP_CONFIG.aiInstructions.aiTask,
      rules: 'Summarize',
    })
    f.aiRequest.mockClear()
    expect(await f.actions.aiCustomPrompt('  ', 'Sample')).toBe('')
    expect(await f.actions.aiCustomPrompt('Prompt')).toBe('')
    expect(await f.actions.correctText('  ')).toBe('')
    expect(f.notifyEmptyText).toHaveBeenCalledTimes(2)
    expect(f.aiRequest).not.toHaveBeenCalled()
  })

  it('preserves request failures for the caller', async () => {
    const f = fixture()
    const error = new Error('Provider unavailable')
    f.aiRequest.mockRejectedValue(error)
    await expect(f.actions.correctText('Sample')).rejects.toBe(error)
  })
})
