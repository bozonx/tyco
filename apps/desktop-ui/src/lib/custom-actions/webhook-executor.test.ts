import { describe, expect, it, vi } from 'vitest'

import {
  buildWebhookRequest,
  executeWebhook,
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

describe('the JSON body', () => {
  const text = 'say "hi"\nnow \\ {{TEXT}}'
  const body = (payloadTemplate: string) =>
    buildWebhookRequest(webhook({ payloadTemplate }), text).init.body as string

  it('escapes the text inside a JSON string', () => {
    expect(JSON.parse(body('{"text":"{{TEXT}}","n":1}'))).toEqual({
      text,
      n: 1,
    })
  })

  it('escapes the text inside a longer JSON string', () => {
    expect(JSON.parse(body('{"text":"> {{TEXT}} <"}'))).toEqual({
      text: `> ${text} <`,
    })
  })

  it('makes a JSON string of a bare placeholder', () => {
    expect(JSON.parse(body('{"text": {{TEXT}}}'))).toEqual({ text })
  })
})

describe('variables of a webhook', () => {
  const variables = { HOOKS: 'https://hooks.example', TOKEN: 'a "b"' }

  it('fill the URL, a plain header and the body, not a key reference', () => {
    const { url, init } = buildWebhookRequest(
      webhook({
        url: '{{var:HOOKS}}/run?q={{TEXT}}',
        headers: {
          'X-Token': 'Token {{var:TOKEN}}',
          'X-Key': 'tyco-secret:webhook.header.1',
        },
        payloadTemplate: '{"token":"{{var:TOKEN}}","text":{{TEXT}}}',
      }),
      'a b',
      variables
    )
    expect(url).toBe('https://hooks.example/run?q=a%20b')
    expect(init.headers['x-token']).toBe('Token a "b"')
    expect(init.headers['x-key']).toBe('tyco-secret:webhook.header.1')
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'a "b"',
      text: 'a b',
    })
  })

  it('stop the request when one has no value here, naming it', () => {
    expect(() =>
      buildWebhookRequest(webhook({ url: '{{var:HOOKS}}/run' }), null)
    ).toThrow('HOOKS')
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

  it('sends the text alone as it is when the template is the placeholder', () => {
    const { init } = buildWebhookRequest(
      webhook({ payloadTemplate: ' {{TEXT}} ' }),
      'say "hi"'
    )
    expect(init.body).toBe('say "hi"')
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
    const signal = new AbortController().signal
    await expect(
      executeWebhook(webhook(), 'test', fetchFn as never, undefined, signal)
    ).resolves.toBe('answer')
    // no time limit of its own: the request ends with the caller's signal
    expect(fetchFn.mock.calls[0][1].signal).toBe(signal)
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
    ).rejects.toThrow(/^Failed https:\/\/x\.test$/)
    expect(log.mock.calls[0][1]).not.toContain('private-text')
    // the reason stays in the log, only the URL is cut to its origin
    expect(log.mock.calls[0][1]).toContain('Error: Failed https://x.test')
  })

  it('quotes the start of an error response in the failure', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 422,
        statusText: '',
        text: () =>
          Promise.resolve(`{"error":"bad\n input"}${'x'.repeat(500)}`),
      })
    const error: Error = await executeWebhook(
      webhook(),
      null,
      fetchFn as never
    ).then(
      () => new Error('resolved'),
      (caught: unknown) => caught as Error
    )
    expect(error.message).toMatch(/^HTTP 422: \{"error":"bad input"\}x+…$/)
    expect(error.message.length).toBeLessThan(220)
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

describe('selection context in webhook requests', () => {
  it.each(['123', 'true', '{"value":1}', 'ordinary text'])(
    'sends a standalone selection as plain text: %s',
    (selection) => {
      const { init } = buildWebhookRequest(
        webhook({ payloadTemplate: '{{SELECTION}}' }),
        null,
        {},
        selection
      )
      expect(init.body).toBe(selection)
      expect(init.headers['content-type']).toBe('text/plain; charset=utf-8')
    }
  )

  it('escapes selection in JSON and URL templates separately from command text', () => {
    const selection = 'quote " and & slash /'
    const { url, init } = buildWebhookRequest(
      webhook({
        url: 'https://example.com/?selection={{SELECTION}}',
        payloadTemplate: '{"selection":"{{SELECTION}}","text":{{TEXT}}}',
      }),
      'voice argument',
      {},
      selection
    )
    expect(new URL(url).searchParams.get('selection')).toBe(selection)
    expect(JSON.parse(init.body as string)).toEqual({
      selection,
      text: 'voice argument',
    })
    expect(init.headers['content-type']).toBe('application/json; charset=utf-8')
  })
})
