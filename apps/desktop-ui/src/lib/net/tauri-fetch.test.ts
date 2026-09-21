import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { bytes, createFakeNetIpc } from './fake-net-ipc'
import { createTauriFetch } from './tauri-fetch'

const head = (status = 200, headers: [string, string][] = []) => ({
  type: 'head',
  status,
  statusText: status === 200 ? 'OK' : '',
  headers,
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('tauri-fetch', () => {
  it('sends the request through the proxy command', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => {
          emit(head())
          emit({ type: 'end' })
        })
        return 1
      },
    })
    const fetch = createTauriFetch(fake.ipc)

    await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer tyco-secret:deepseek' },
      body: '{"a":1}',
    })

    const [call] = fake.callsOf(DESKTOP_COMMANDS.NET_FETCH)
    const request = (call.args as { request: Record<string, unknown> }).request
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.deepseek.com/chat/completions')
    expect(request.headers).toContainEqual([
      'authorization',
      'Bearer tyco-secret:deepseek',
    ])
    expect(atob(request.body as string)).toBe('{"a":1}')
  })

  it('omits the body of a GET request', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => emit(head(204)))
        return 1
      },
    })

    const response = await createTauriFetch(fake.ipc)('https://example.com/')

    const [call] = fake.callsOf(DESKTOP_COMMANDS.NET_FETCH)
    expect(
      (call.args as { request: { body?: string } }).request.body
    ).toBeUndefined()
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('resolves on the head and streams the body', async () => {
    const fake = createFakeNetIpc({ [DESKTOP_COMMANDS.NET_FETCH]: () => 7 })
    const pending = createTauriFetch(fake.ipc)('https://example.com/')
    await tick()

    fake.emit(head(200, [['content-type', 'text/event-stream']]))
    const response = await pending
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('OK')
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    fake.emit(bytes('data: 1\n\n'))
    fake.emit(bytes('data: 2\n\n'))
    fake.emit({ type: 'end' })

    expect(await response.text()).toBe('data: 1\n\ndata: 2\n\n')
  })

  it('keeps error statuses as responses', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => {
          emit(head(401))
          emit(bytes('{"error":"bad key"}'))
          emit({ type: 'end' })
        })
        return 1
      },
    })

    const response = await createTauriFetch(fake.ipc)('https://example.com/')

    expect(response.ok).toBe(false)
    expect(await response.json()).toEqual({ error: 'bad key' })
  })

  it('rejects with a TypeError when the request fails before a response', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => emit({ type: 'error', message: 'connection refused' }))
        return 1
      },
    })

    await expect(
      createTauriFetch(fake.ipc)('https://example.com/')
    ).rejects.toThrow(new TypeError('connection refused'))
  })

  it('rejects with a TypeError when the proxy refuses the request', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: () => {
        throw 'Secret "google" may not be sent to https://evil.example'
      },
    })

    await expect(
      createTauriFetch(fake.ipc)('https://evil.example/')
    ).rejects.toThrow(TypeError)
  })

  it('errors the body when the connection drops mid-stream', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => {
          emit(head())
          emit(bytes('partial'))
          emit({ type: 'error', message: 'connection reset' })
        })
        return 1
      },
    })

    const response = await createTauriFetch(fake.ipc)('https://example.com/')

    await expect(response.text()).rejects.toThrow('connection reset')
  })

  it('cancels the proxied request on abort before the head', async () => {
    const fake = createFakeNetIpc({ [DESKTOP_COMMANDS.NET_FETCH]: () => 42 })
    const controller = new AbortController()
    const pending = createTauriFetch(fake.ipc)('https://example.com/', {
      signal: controller.signal,
    })
    await tick()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({
      id: 42,
    })
  })

  it('cancels once the id arrives when aborted before it', async () => {
    let resolveId: (id: number) => void = () => undefined
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: () =>
        new Promise<number>((resolve) => {
          resolveId = resolve
        }),
    })
    const controller = new AbortController()
    const pending = createTauriFetch(fake.ipc)('https://example.com/', {
      signal: controller.signal,
    })
    await tick()

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(0)

    resolveId(5)
    await tick()
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 5 })
  })

  it('cancels the proxied request when the reader stops early', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_FETCH]: (_call, emit) => {
        setTimeout(() => emit(head()))
        return 3
      },
    })

    const response = await createTauriFetch(fake.ipc)('https://example.com/')
    await response.body!.cancel()

    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 3 })
  })

  it('rejects at once for an already aborted signal', async () => {
    const fake = createFakeNetIpc()

    await expect(
      createTauriFetch(fake.ipc)('https://example.com/', {
        signal: AbortSignal.abort(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.calls).toHaveLength(0)
  })
})
