import type { AudioChunk } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { createFakeNetIpc } from '../net/fake-net-ipc'
import { createVoiceCaptureControl } from './voice-capture'

async function collect(audio: AsyncIterable<AudioChunk>) {
  const result: number[][] = []
  for await (const chunk of audio) result.push([...chunk.data])
  return result
}

const pcm = (...values: number[]) => new Uint8Array(values).buffer

describe('createVoiceCaptureControl', () => {
  it('delivers raw chunks in order and ends with the capture', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.START_VOICE_CAPTURE]: () => ({
        sampleRate: 16_000,
        sessionId: 7,
      }),
    })
    const control = createVoiceCaptureControl(fake.ipc)

    const capture = await control.start()
    fake.emit(pcm(1, 2))
    fake.emit(pcm(3, 4))
    await control.stop()
    fake.emit({ type: 'end' })

    expect(capture.sampleRate).toBe(16_000)
    expect(await collect(capture.audio)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(fake.callsOf(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE)).toEqual([
      expect.objectContaining({ args: { sessionId: 7 } }),
    ])
  })

  it('stops only the capture it started', async () => {
    let nextId = 1
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.START_VOICE_CAPTURE]: () => ({
        sampleRate: 16_000,
        sessionId: nextId++,
      }),
    })
    const control = createVoiceCaptureControl(fake.ipc)

    await control.start()
    await control.start()
    await control.stop()

    expect(
      fake.callsOf(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE).map((call) => call.args)
    ).toEqual([{ sessionId: 2 }])
  })

  it('does not stop a capture it never started', async () => {
    const fake = createFakeNetIpc({})

    await createVoiceCaptureControl(fake.ipc).stop()

    expect(fake.callsOf(DESKTOP_COMMANDS.STOP_VOICE_CAPTURE)).toHaveLength(0)
  })

  it('fails the audio when the microphone fails', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.START_VOICE_CAPTURE]: () => ({
        sampleRate: 16_000,
        sessionId: 7,
      }),
    })

    const capture = await createVoiceCaptureControl(fake.ipc).start()
    fake.emit(pcm(1, 2))
    fake.emit({ type: 'error', message: 'Audio input stream failed' })

    await expect(collect(capture.audio)).rejects.toThrow(
      'Audio input stream failed'
    )
  })

  it('reports a microphone that cannot be opened', async () => {
    const fake = createFakeNetIpc({
      [DESKTOP_COMMANDS.START_VOICE_CAPTURE]: () => {
        throw 'No default input device found'
      },
    })

    await expect(createVoiceCaptureControl(fake.ipc).start()).rejects.toThrow(
      'No default input device found'
    )
  })
})
