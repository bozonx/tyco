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

describe('executeWebhook', () => {
  it('resolves with the response body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('answer'))
    await expect(
      executeWebhook(webhook(), 'test', fetchFn as never)
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
      executeWebhook(
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
