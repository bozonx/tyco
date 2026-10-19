import { describe, expect, it, vi } from 'vitest'

import { createScriptAndWebhookTools } from './script-and-webhook-tools'

const scriptTool = (executeScriptAction = vi.fn()) =>
  createScriptAndWebhookTools({ executeScriptAction }).find(
    (tool) => tool.id === 'script'
  )!

describe('script tool', () => {
  it('runs a saved command only: the backend takes its shell command', async () => {
    const executeScriptAction = vi.fn()
    const result = await scriptTool(executeScriptAction).run({
      input: { text: 'x' },
      config: { command: 'echo {{TEXT}}' },
      source: 'chat',
      signal: new AbortController().signal,
      wantsOutput: true,
    })
    expect(result).toEqual({ ok: false, messageKey: 'toast.scriptNotSaved' })
    expect(executeScriptAction).not.toHaveBeenCalled()
  })
})
