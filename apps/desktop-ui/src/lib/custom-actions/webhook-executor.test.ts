import { describe, expect, it, vi } from 'vitest'

import {
  buildWebhookRequest,
  executeWebhook,
  fillJsonTemplate,
  type WebhookTarget,
  webhookResultText,
} from './webhook-executor'

const okResponse = (body = 'ok') => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: () => Promise.resolve(body),
})

const webhook = (extra: Partial<WebhookTarget> = {}): WebhookTarget => ({
  id: 'wh-1',
  name: 'My Webhook',
  url: 'https://api.example.com/endpoint',
  ...extra,
})

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
  it('sends the default JSON payload with POST, without the text', () => {
    const { url, init } = buildWebhookRequest(webhook(), 'test text')
    expect(url).toBe('https://api.example.com/endpoint')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toContain('application/json')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ action: 'My Webhook', source: 'tyco' })
    expect(body).not.toHaveProperty('text')
  })

  it('sends a template that is not JSON as plain text', () => {
    const { init } = buildWebhookRequest(
      webhook({ payloadTemplate: 'Text: {{TEXT}}' }),
      'a'
    )
    expect(init.body).toBe('Text: a')
    expect(init.headers['content-type']).toContain('text/plain')
  })

  it('adds no text to a GET request without a placeholder', () => {
    const { url, init } = buildWebhookRequest(
      webhook({ method: 'GET', url: 'https://api.example.com/trigger' }),
      'hello world'
    )
    expect(url).toBe('https://api.example.com/trigger')
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

  it('sends no text for a call without one', () => {
    const get = buildWebhookRequest(
      webhook({ method: 'GET', url: 'https://x.test/run' }),
      null
    )
    expect(get.url).toBe('https://x.test/run')

    const post = buildWebhookRequest(webhook(), null)
    const body = JSON.parse(post.init.body as string)
    expect(body).not.toHaveProperty('text')
    expect(body).toMatchObject({ action: 'My Webhook', source: 'tyco' })
  })

  it('adds the custom headers and the secret Authorization', () => {
    const { init } = buildWebhookRequest(
      webhook({
        id: 'ABC',
        headers: { 'X-Token': 't', ' ': 'skip' },
        isAuthEnabled: true,
        authSecretId: 'webhook.auth.abc',
      }),
      'a'
    )
    expect(init.headers['x-token']).toBe('t')
    expect(init.headers[' ']).toBeUndefined()
    expect(init.headers.authorization).toBe('tyco-secret:webhook.auth.abc')
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

describe('executeWebhook', () => {
  it('resolves with the response body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('answer'))
    await expect(
      executeWebhook(webhook(), 'test', fetchFn as never)
    ).resolves.toBe('answer')
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('fails on an error status and logs only the origin', async () => {
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
      executeWebhook(
        webhook({ url: 'https://x.test/{{TEXT}}', isOutputLogged: true }),
        'private',
        fetchFn as never,
        log
      )
    ).rejects.toThrow('HTTP 500 Internal Server Error')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toContain('Origin: https://x.test')
    expect(log.mock.calls[0][1]).not.toContain('private')
  })
  it('preserves raw text including quotes, newlines and placeholders', () => {
    const text = '"hello"\n\\{{TEXT}}'
    const { init } = buildWebhookRequest(
      webhook({ payloadTemplate: 'Text: {{TEXT}} / {{TEXT}}' }),
      text
    )
    expect(init.body).toBe(`Text: ${text} / ${text}`)
    expect(init.headers['content-type']).toContain('text/plain')
  })

  it('does not let logging failure change a successful result', async () => {
    await expect(
      executeWebhook(
        webhook({ isOutputLogged: true }),
        null,
        vi.fn().mockResolvedValue(okResponse('done')),
        vi.fn().mockRejectedValue(new Error('IPC unavailable'))
      )
    ).resolves.toBe('done')
  })

  it('preserves the request error when logging also fails', async () => {
    await expect(
      executeWebhook(
        webhook(),
        null,
        vi.fn().mockRejectedValue(new Error('Connection refused')),
        vi.fn().mockRejectedValue(new Error('IPC unavailable'))
      )
    ).rejects.toThrow('Connection refused')
  })

  it('omits credentials and response data from automatic failure logs', async () => {
    const log = vi.fn()
    await expect(
      executeWebhook(
        webhook({ url: 'https://user:password@x.test/private-id?key=secret' }),
        null,
        vi
          .fn()
          .mockResolvedValue(new Response('private response', { status: 500 })),
        log
      )
    ).rejects.toThrow('HTTP 500')
    expect(log.mock.calls[0][1]).toBe(
      'Origin: https://x.test\nMethod: POST\nStatus: 500'
    )
  })

  it('does not persist transport errors containing the expanded URL', async () => {
    const log = vi.fn()
    await expect(
      executeWebhook(
        webhook(),
        null,
        vi
          .fn()
          .mockRejectedValue(new Error('Failed https://x.test/private-text')),
        log
      )
    ).rejects.toThrow('Failed')
    expect(log.mock.calls[0][1]).not.toContain('private-text')
  })

  it('bounds explicitly enabled response logging without truncating the result', async () => {
    const body = 'x'.repeat(10000)
    const log = vi.fn()
    await expect(
      executeWebhook(
        webhook({ isOutputLogged: true }),
        null,
        vi.fn().mockResolvedValue(okResponse(body)),
        log
      )
    ).resolves.toBe(body)
    expect(log.mock.calls[0][1].length).toBeLessThan(4300)
    expect(log.mock.calls[0][1]).toContain('[truncated]')
  })
})
