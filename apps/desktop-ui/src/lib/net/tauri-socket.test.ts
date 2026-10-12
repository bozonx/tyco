import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { bytes, createFakeNetIpc } from './fake-net-ipc'
import { SOCKET_ID_HEADER } from './net-ipc'
import { createTauriSocketOpener } from './tauri-socket'

async function collect(messages: AsyncIterable<string>) {
  const result: string[] = []
  for await (const message of messages) result.push(message)
  return result
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('tauri-socket', () => {
  it('opens through the proxy with headers and protocols', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 9
      },
    })

    await createTauriSocketOpener(fake.ipc)(
      'wss://api.deepgram.com/v1/listen',
      {
        headers: { authorization: 'Token tyco-secret:deepgram' },
        protocols: ['token'],
        signal: new AbortController().signal,
      }
    )

    const [call] = fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_OPEN)
    expect((call.args as Record<string, unknown>).request).toEqual({
      url: 'wss://api.deepgram.com/v1/listen',
      headers: [['authorization', 'Token tyco-secret:deepgram']],
      protocols: ['token'],
    })
  })

  it('delivers text and binary frames and ends on a normal close', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        // Frames may arrive before the open command resolves.
        emit({ type: 'open' })
        emit({ type: 'message', data: 'one' })
        return 1
      },
    })
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: new AbortController().signal,
    })

    fake.emit(bytes('two'))
    fake.emit({ type: 'close', code: 1005, reason: '' })

    expect(await collect(session.messages)).toEqual(['one', 'two'])
  })

  it('fails the messages on an abnormal close', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 1
      },
    })
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: new AbortController().signal,
    })

    fake.emit({ type: 'message', data: 'partial' })
    fake.emit({ type: 'close', code: 1006, reason: 'gone' })

    const seen: string[] = []
    await expect(
      (async () => {
        for await (const message of session.messages) seen.push(message)
      })()
    ).rejects.toThrow('closed with 1006: gone')
    expect(seen).toEqual(['partial'])
  })

  it('rejects when the proxy cannot open the socket', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: () => {
        throw 'WebSocket handshake timed out'
      },
    })

    await expect(
      createTauriSocketOpener(fake.ipc)('ws://x/', {
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('WebSocket handshake timed out')
  })

  it('sends frames in order, binary as a raw body', async () => {
    const order: string[] = []
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 4
      },
      [DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY]: async () => {
        // A slow first frame must not be overtaken by the next ones.
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push('binary')
      },
      [DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT]: () => order.push('text'),
      [DESKTOP_COMMANDS.NET_SOCKET_CLOSE]: () => order.push('close'),
    })
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: new AbortController().signal,
    })

    const audio = new Uint8Array([1, 2, 3])
    session.send(audio)
    session.send('{"type":"KeepAlive"}')
    session.close('{"type":"CloseStream"}')
    session.send('ignored after close')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(order).toEqual(['binary', 'text', 'close'])
    const [binary] = fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY)
    expect(binary.args).toBe(audio)
    expect(binary.headers).toEqual({ [SOCKET_ID_HEADER]: '4' })
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_CLOSE)[0].args).toEqual({
      id: 4,
      payload: '{"type":"CloseStream"}',
    })
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT)).toHaveLength(1)
  })

  it('bounds queued audio while an IPC send is stalled', async () => {
    let completeSend!: () => void
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 2
      },
      [DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY]: () =>
        new Promise<void>((resolve) => {
          completeSend = resolve
        }),
    })
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: new AbortController().signal,
    })
    const messages = collect(session.messages)
    const rejected = expect(messages).rejects.toThrow(
      'WebSocket send queue limit exceeded'
    )
    session.send(new Uint8Array(256 * 1024))
    await tick()
    for (let i = 0; i < 5; i += 1) session.send(new Uint8Array(256 * 1024))
    await rejected
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 2 })
    completeSend()
    await tick()
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY)).toHaveLength(
      1
    )
  })

  it('bounds the number of pending zero-length frames', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 2
      },
    })
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: new AbortController().signal,
    })
    const rejected = expect(collect(session.messages)).rejects.toThrow(
      'WebSocket send queue limit exceeded'
    )
    for (let i = 0; i < 129; i += 1) session.send('')
    await rejected
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
  })

  it('closes on abort', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 2
      },
    })
    const controller = new AbortController()
    await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: controller.signal,
    })

    controller.abort()
    await tick()

    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 2 })
  })

  it.each([
    DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY,
    DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT,
    DESKTOP_COMMANDS.NET_SOCKET_CLOSE,
  ])(
    'reports an IPC failure in %s to the transcript reader',
    async (command) => {
      const fake = createFakeNetIpc({
        [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
          emit({ type: 'open' })
          return 2
        },
        [command]: () => {
          throw 'Audio delivery failed'
        },
      })
      const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
        signal: new AbortController().signal,
      })
      const messages = collect(session.messages)
      const rejected = expect(messages).rejects.toThrow('Audio delivery failed')

      if (command === DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY) {
        session.send(new Uint8Array([1, 2]))
        session.send('must not overtake failed audio')
      } else if (command === DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT) {
        session.send('audio control message')
      } else {
        session.close()
      }

      await rejected
      await tick()
      expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_CLOSE)).toHaveLength(1)
      if (command === DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY) {
        expect(
          fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT)
        ).toHaveLength(0)
      }
    }
  )
  it('cancels a handshake before its IPC id arrives and ignores late frames', async () => {
    let resolveId!: (id: number) => void
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: () =>
        new Promise<number>((resolve) => {
          resolveId = resolve
        }),
    })
    const controller = new AbortController()
    const pending = createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolveId(7)
    fake.emit({ type: 'open' })
    fake.emit({ type: 'message', data: 'late' })
    await tick()
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)[0].args).toEqual({ id: 7 })
  })

  it('honors a connection deadline without limiting an established session', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: () => 8,
    })
    const connect = new AbortController()
    const lifetime = new AbortController()
    const pending = createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: lifetime.signal,
      connectSignal: connect.signal,
    })
    connect.abort(new DOMException('Connection timed out', 'TimeoutError'))
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await tick()
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)

    const nextConnect = new AbortController()
    const next = createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: lifetime.signal,
      connectSignal: nextConnect.signal,
    })
    fake.emit({ type: 'open' })
    const session = await next
    nextConnect.abort()
    session.send('audio')
    await tick()
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT)).toHaveLength(1)
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
    fake.emit({ type: 'close', code: 1000, reason: '' })
  })

  it('aborts immediately even while final transcripts are being drained', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.NET_SOCKET_OPEN]: (_call, emit) => {
        emit({ type: 'open' })
        return 2
      },
    })
    const controller = new AbortController()
    const session = await createTauriSocketOpener(fake.ipc)('ws://x/', {
      signal: controller.signal,
    })
    session.close('end-of-stream')
    await tick()
    const messages = collect(session.messages)
    controller.abort()
    await expect(messages).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.callsOf(DESKTOP_COMMANDS.NET_CANCEL)).toHaveLength(1)
  })
})
