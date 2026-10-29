import { expect } from '@playwright/test'
import type { DesktopChannel } from '@tyco/shared'

import type { FakeDesktop } from './fake-desktop'

/** Native microphone and sherpa socket controlled independently by the test. */
export function installVoice(desktop: FakeDesktop) {
  desktop.userConfig.stt = {
    provider: 'sherpaOnnx',
    isVoiceCorrectionEnabled: false,
    isStylingBarEnabled: false,
    isStylingBarDirectInsertEnabled: false,
    providers: {
      deepgram: { modelId: 'nova-3', language: 'auto' },
      sherpaOnnx: { baseUrl: 'ws://speech.invalid:6006' },
    },
  }
  let audio: DesktopChannel | undefined
  let socket: DesktopChannel | undefined
  desktop.handle('start_voice_capture', ({ onAudio }) => {
    audio = onAudio
    return { sampleRate: 16000, sessionId: 7 }
  })
  desktop.handle('stop_voice_capture', async () => {
    if (audio) await desktop.sendChannel(audio, { type: 'end' })
  })
  desktop.handle('open_socket', async ({ request, onEvent }) => {
    expect(request.url).toBe('ws://speech.invalid:6006')
    socket = onEvent
    await desktop.sendChannel(socket, { type: 'open' })
    return 8
  })
  desktop.handle('send_socket_binary', () => undefined)
  desktop.handle('send_socket_text', () => undefined)
  desktop.handle('close_socket', () => undefined)
  desktop.handle('cancel_net_task', () => undefined)
  const connected = async () => {
    await expect.poll(() => Boolean(audio && socket)).toBe(true)
    return socket!
  }
  return {
    async partial(text: string) {
      const channel = await connected()
      await desktop.sendChannel(audio!, new Uint8Array(320))
      await desktop.sendChannel(channel, {
        type: 'message',
        data: JSON.stringify({ text, is_final: false }),
      })
    },
    async finish(text: string) {
      const channel = await connected()
      await expect
        .poll(() => desktop.callsOf('stop_voice_capture'))
        .toContainEqual({ sessionId: 7 })
      await desktop.sendChannel(channel, {
        type: 'message',
        data: JSON.stringify({ text, is_final: true }),
      })
      await desktop.sendChannel(channel, { type: 'message', data: 'Done!' })
    },
    async fail() {
      const channel = await connected()
      await desktop.sendChannel(channel, {
        type: 'error',
        message: 'Speech server disconnected',
      })
    },
  }
}
