import { describe, expect, it, vi } from 'vitest'

import type {
  ScriptExecutionResult,
  ScriptMainAction,
  WebhookMainAction,
} from '@tyco/shared'

import type { ActionMenuDependencies } from './action-menu-store'
import {
  buildWebhookRequest,
  createScriptActionItem,
  createWebhookActionItem,
  executeWebhookAction,
  fillJsonTemplate,
  scriptFailureDetail,
  webhookResultText,
} from './custom-actions'

const okResponse = (body = 'ok') => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: () => Promise.resolve(body),
})

const webhook = (
  extra: Partial<WebhookMainAction> = {}
): WebhookMainAction => ({
  type: 'webhook',
  id: 'wh-1',
  name: 'My Webhook',
  url: 'https://api.example.com/endpoint',
  ...extra,
})

const script = (extra: Partial<ScriptMainAction> = {}): ScriptMainAction => ({
  type: 'script',
  id: 's-1',
  name: 'Echo',
  command: 'echo 123',
  ...extra,
})

const result = (
  extra: Partial<ScriptExecutionResult> = {}
): ScriptExecutionResult => ({
  success: true,
  exitCode: 0,
  stdout: '',
  stderr: '',
  running: false,
  ...extra,
})

function makeDeps(extra: Partial<ActionMenuDependencies> = {}) {
  return {
    showToast: vi.fn(),
    showError: vi.fn(),
    showResultMenu: vi.fn(),
    saveOutput: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn(),
    ...extra,
  } as unknown as ActionMenuDependencies & {
    showToast: ReturnType<typeof vi.fn>
    showError: ReturnType<typeof vi.fn>
    showResultMenu: ReturnType<typeof vi.fn>
    closeWindow: ReturnType<typeof vi.fn>
  }
}

describe('fillJsonTemplate', () => {
  const text = 'say "hi"\nnow \\ {{TEXT}}'

  it('escapes the text inside a JSON string', () => {
    const body = fillJsonTemplate('{"text":"{{TEXT}}","n":1}', text)
    expect(JSON.parse(body)).toEqual({ text, n: 1 })
  })

  it('escapes the text inside a longer JSON string', () => {
    const body = fillJsonTemplate('{"text":"> {{TEXT}} <"}', text)
    expect(JSON.parse(body)).toEqual({ text: `> ${text} <` })
  })

  it('makes a JSON string of a bare placeholder', () => {
    const body = fillJsonTemplate('{"text": {{TEXT}}}', text)
    expect(JSON.parse(body)).toEqual({ text })
  })
})

describe('buildWebhookRequest', () => {
  it('sends the default JSON payload with POST', () => {
    const { url, init } = buildWebhookRequest(webhook(), 'test text')
    expect(url).toBe('https://api.example.com/endpoint')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toContain('application/json')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      text: 'test text',
      action: 'My Webhook',
      source: 'tyco',
    })
  })

  it('sends a template that is not JSON as plain text', () => {
    const { init } = buildWebhookRequest(
      webhook({ payloadTemplate: 'Text: {{TEXT}}' }),
      'a'
    )
    expect(init.body).toBe('Text: "a"')
    expect(init.headers['content-type']).toContain('text/plain')
  })

  it('adds the text as a query parameter with GET', () => {
    const { url, init } = buildWebhookRequest(
      webhook({ method: 'GET', url: 'https://api.example.com/trigger' }),
      'hello world'
    )
    expect(url).toBe('https://api.example.com/trigger?text=hello+world')
    expect(init.body).toBeUndefined()
    expect(init.headers['content-type']).toBeUndefined()
  })

  it('puts the text where the URL has a placeholder', () => {
    const { url } = buildWebhookRequest(
      webhook({ method: 'GET', url: 'https://x.test/?q={{TEXT}}&a=1' }),
      'a&b'
    )
    expect(url).toBe('https://x.test/?q=a%26b&a=1')
  })

  it('adds the custom headers and the secret Authorization', () => {
    const { init } = buildWebhookRequest(
      webhook({
        id: 'ABC',
        headers: { 'X-Token': 't', ' ': 'skip' },
        authSecret: true,
      }),
      'a'
    )
    expect(init.headers['x-token']).toBe('t')
    expect(init.headers[' ']).toBeUndefined()
    expect(init.headers.authorization).toBe('tyco-secret:webhook-abc')
  })
})

describe('webhookResultText', () => {
  it('takes the text field of a JSON answer', () => {
    expect(webhookResultText('{"text":"done"}')).toBe('done')
  })

  it('takes any other body as it is', () => {
    expect(webhookResultText('{"result":1}')).toBe('{"result":1}')
    expect(webhookResultText('plain')).toBe('plain')
  })
})

describe('executeWebhookAction', () => {
  it('resolves with the response body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('answer'))
    await expect(
      executeWebhookAction(webhook(), 'test', fetchFn as never)
    ).resolves.toBe('answer')
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('fails on an error status and logs the template URL', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('boom'),
      })
    const log = vi.fn().mockResolvedValue(undefined)
    await expect(
      executeWebhookAction(
        webhook({ url: 'https://x.test/{{TEXT}}', logOutput: true }),
        'private',
        fetchFn as never,
        log
      )
    ).rejects.toThrow('HTTP 500 Internal Server Error')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][2]).toContain('URL: https://x.test/{{TEXT}}')
    expect(log.mock.calls[0][2]).not.toContain('private')
  })
})

describe('scriptFailureDetail', () => {
  it('takes the first line of stderr', () => {
    expect(
      scriptFailureDetail(
        result({ success: false, stderr: '\nsh: foo: not found\nmore' })
      )
    ).toBe('sh: foo: not found')
  })

  it('falls back to the exit code', () => {
    expect(scriptFailureDetail(result({ success: false, exitCode: 2 }))).toBe(
      'exit code 2'
    )
  })
})

describe('createScriptActionItem', () => {
  it('warns when the command is empty', async () => {
    const executeScriptAction = vi.fn()
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script({ command: '  ' }), deps).action('x')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptEmptyCommand',
      'warn'
    )
    expect(executeScriptAction).not.toHaveBeenCalled()
  })

  it('runs the command and closes the window', async () => {
    const executeScriptAction = vi.fn().mockResolvedValue(result())
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(
      script({ workingDir: ' /tmp ', logOutput: true }),
      deps
    ).action('input')

    expect(executeScriptAction).toHaveBeenCalledWith({
      name: 'Echo',
      command: 'echo 123',
      workingDir: '/tmp',
      text: 'input',
      captureOutput: false,
      logOutput: true,
    })
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptSuccess',
      'success'
    )
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('reports a command left running in the background', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ success: false, running: true }))
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script(), deps).action('input')
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.scriptRunning',
      'success'
    )
    expect(deps.closeWindow).toHaveBeenCalled()
  })

  it('shows why the command failed and keeps the window', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ success: false, stderr: 'bad thing' }))
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script(), deps).action('input')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.scriptFailed',
      'bad thing'
    )
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })

  it('shows an error the backend returned', async () => {
    const executeScriptAction = vi
      .fn()
      .mockRejectedValue(new Error('Working directory `x` does not exist'))
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script(), deps).action('input')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.scriptFailed',
      'Working directory `x` does not exist'
    )
  })

  it('opens the action menu on the output', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ stdout: 'UPPER\n' }))
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script({ afterRun: 'showMenu' }), deps).action(
      'upper'
    )
    expect(executeScriptAction.mock.calls[0][0].captureOutput).toBe(true)
    expect(deps.showResultMenu).toHaveBeenCalledWith('UPPER', 'upper')
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })

  it('warns when there is no output to show', async () => {
    const executeScriptAction = vi
      .fn()
      .mockResolvedValue(result({ stdout: '\n' }))
    const deps = makeDeps({ executeScriptAction })
    await createScriptActionItem(script({ afterRun: 'showMenu' }), deps).action(
      'x'
    )
    expect(deps.showResultMenu).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.actionEmptyOutput',
      'warn'
    )
  })

  it('falls back to the command as the name', () => {
    const item = createScriptActionItem(script({ name: '' }), makeDeps())
    expect(item.name).toBe('echo 123')
  })
})

describe('createWebhookActionItem', () => {
  it('warns when the url is empty', async () => {
    const deps = makeDeps()
    await createWebhookActionItem(webhook({ url: '' }), deps).action('x')
    expect(deps.showToast).toHaveBeenCalledWith('toast.webhookEmptyUrl', 'warn')
  })

  it('opens the action menu on the answer', async () => {
    const executeWebhookAction = vi.fn().mockResolvedValue('{"text":"done"}')
    const deps = makeDeps({ executeWebhookAction })
    await createWebhookActionItem(
      webhook({ afterRun: 'showMenu' }),
      deps
    ).action('x')
    expect(deps.showResultMenu).toHaveBeenCalledWith('done', 'x')
  })

  it('shows why the request failed', async () => {
    const executeWebhookAction = vi
      .fn()
      .mockRejectedValue(new Error('HTTP 404'))
    const deps = makeDeps({ executeWebhookAction })
    await createWebhookActionItem(webhook(), deps).action('x')
    expect(deps.showError).toHaveBeenCalledWith(
      'toast.webhookFailed',
      'HTTP 404'
    )
    expect(deps.closeWindow).not.toHaveBeenCalled()
  })
})
