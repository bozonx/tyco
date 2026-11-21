import { describe, expect, it, vi } from 'vitest'

import { createScriptAndWebhookOperations } from './script-and-webhook-operations'

const scriptTool = (executeScriptAction = vi.fn()) =>
  createScriptAndWebhookOperations({ executeScriptAction }).find(
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
      isOutputRequested: true,
    })
    expect(result).toEqual({ ok: false, messageKey: 'toast.scriptNotSaved' })
    expect(executeScriptAction).not.toHaveBeenCalled()
  })
})

describe('a window without the clients', () => {
  const call = {
    input: { text: 'x' },
    source: 'menu' as const,
    signal: new AbortController().signal,
    isOutputRequested: true,
    command: { id: 'c-1', name: 'C', isOutputLogged: false },
  }
  const [script, webhook] = createScriptAndWebhookOperations({})

  it('fails a script it cannot send to the backend', async () => {
    await expect(
      script.run({ ...call, config: { command: 'echo' } })
    ).resolves.toEqual({ ok: false, messageKey: 'toast.scriptFailed' })
  })

  it('does not pass a webhook it cannot send for a success', async () => {
    await expect(
      webhook.run({ ...call, config: { url: 'https://x.test' } })
    ).resolves.toEqual({ ok: false, messageKey: 'toast.webhookFailed' })
  })
})

describe('webhook keys', () => {
  it('asks for the key of an authorization that has no key id', async () => {
    const executeWebhook = vi.fn()
    const [, webhook] = createScriptAndWebhookOperations({
      executeWebhook,
      secretIds: async () => new Set<string>(),
    })
    const result = await webhook.run({
      input: {},
      config: { url: 'https://x.test', isAuthEnabled: true },
      source: 'menu',
      signal: new AbortController().signal,
      isOutputRequested: true,
      command: { id: 'c-1', name: 'Hook', isOutputLogged: false },
    })
    expect(result).toMatchObject({
      ok: false,
      messageKey: 'toast.webhookKeyNotSet',
    })
    expect(executeWebhook).not.toHaveBeenCalled()
  })

  it('tells the variables a webhook misses with their message key', async () => {
    const [, webhook] = createScriptAndWebhookOperations({
      executeWebhook: async () => {
        const { WebhookConfigError } =
          await import('../custom-actions/webhook-executor')
        throw new WebhookConfigError('toast.variablesNotSet', 'HOST')
      },
    })
    const result = await webhook.run({
      input: {},
      config: { url: 'https://x.test' },
      source: 'menu',
      signal: new AbortController().signal,
      isOutputRequested: true,
      command: { id: 'c-1', name: 'Hook', isOutputLogged: false },
    })
    expect(result).toEqual({
      ok: false,
      level: 'warn',
      messageKey: 'toast.variablesNotSet',
      message: 'HOST',
    })
  })
})
