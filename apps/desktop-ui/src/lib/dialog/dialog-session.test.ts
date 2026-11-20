import type { AudioChunk } from '@bozonx/ai-kit'
import type { CaptureSource } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { createAsyncQueue } from '../net/async-queue'
import {
  createChannelPipe,
  createDialogSession,
  dialogSides,
  splitPcm16Channels,
  type DialogSessionDependencies,
  type DialogTranscribe,
} from './dialog-session'
import type { DialogSide, DialogTranscriptPart } from './dialog-transcript'

/** Interleaved PCM16 frames of `[microphone, computer]` sample pairs */
function stereo(frames: [number, number][]): Uint8Array {
  const view = new DataView(new ArrayBuffer(frames.length * 4))
  frames.forEach(([left, right], index) => {
    view.setInt16(index * 4, left, true)
    view.setInt16(index * 4 + 2, right, true)
  })
  return new Uint8Array(view.buffer)
}

function samples(data: Uint8Array): number[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return Array.from({ length: data.byteLength / 2 }, (_, index) =>
    view.getInt16(index * 2, true)
  )
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A capture whose audio the test writes and a transcribe it scripts */
function harness(
  options: {
    channels?: number
    transcribe?: DialogTranscribe
    startError?: unknown
  } = {}
) {
  const audio = createAsyncQueue<AudioChunk>()
  const sources: CaptureSource[] = []
  const events: string[] = []
  const parts: [DialogSide, DialogTranscriptPart, number][] = []
  const errors: [unknown, { isFatal: boolean; side?: DialogSide }][] = []
  const heard = new Map<DialogSide, number[]>()
  const defaultTranscribe: DialogTranscribe = async function* ({
    side,
    audio: channelAudio,
  }) {
    for await (const chunk of channelAudio) {
      heard.set(side, [...(heard.get(side) ?? []), ...samples(chunk.data)])
      yield {
        type: 'final',
        segment: { text: `${side}`, startMs: 0, endMs: 10 },
      }
    }
  }
  const deps: DialogSessionDependencies = {
    capture: {
      async start(source) {
        sources.push(source)
        if (options.startError) throw options.startError
        return {
          sampleRate: 1000,
          channels: options.channels ?? 2,
          audio: audio.values,
          isSuperseded: () => false,
        }
      },
      async stop() {
        events.push('stop-capture')
        audio.end()
      },
    },
    transcribe: options.transcribe ?? defaultTranscribe,
    onStatus: (status) => events.push(`status:${status}`),
    onChannelStatus: (side, status) => events.push(`${side}:${status}`),
    onPart: (side, part, offsetMs) => parts.push([side, part, offsetMs]),
    onDraftLost: (side) => events.push(`${side}:draft-lost`),
    onError: (error, failure) => errors.push([error, failure]),
    sleep: async () => undefined,
    finishTimeoutMs: 1000,
  }
  return {
    session: createDialogSession(deps),
    audio,
    sources,
    events,
    parts,
    errors,
    heard,
  }
}

describe('splitPcm16Channels', () => {
  it('splits interleaved frames into a buffer per channel', () => {
    const [microphone, computer] = splitPcm16Channels(
      stereo([
        [1, -1],
        [2, -2],
      ]),
      2
    )
    expect(samples(microphone)).toEqual([1, 2])
    expect(samples(computer)).toEqual([-1, -2])
  })

  it('passes mono through and drops a partial frame', () => {
    const mono = new Uint8Array([1, 0, 2, 0])
    expect(splitPcm16Channels(mono, 1)).toEqual([mono])
    const [left] = splitPcm16Channels(new Uint8Array([1, 0, 2, 0, 3, 0]), 2)
    expect(samples(left)).toEqual([1])
  })

  it('names the sides of the channels', () => {
    expect(dialogSides(2)).toEqual(['me', 'remote'])
    expect(dialogSides(1)).toEqual(['remote'])
  })
})

describe('createChannelPipe', () => {
  it('keeps the rest for the next reader and counts what it dropped', async () => {
    const pipe = createChannelPipe(4)
    pipe.push(new Uint8Array([1, 1]))
    pipe.push(new Uint8Array([2, 2]))
    pipe.push(new Uint8Array([3, 3]))
    // the oldest chunk went over the limit
    expect(pipe.positionBytes).toBe(2)
    const first = new AbortController()
    for await (const chunk of pipe.reader(first.signal)) {
      expect(Array.from(chunk.data)).toEqual([2, 2])
      break
    }
    expect(pipe.positionBytes).toBe(4)
    pipe.end()
    const rest: number[][] = []
    for await (const chunk of pipe.reader(new AbortController().signal))
      rest.push(Array.from(chunk.data))
    expect(rest).toEqual([[3, 3]])
  })
})

describe('createDialogSession', () => {
  it('records the dialog and hands each side its own channel', async () => {
    const test = harness()
    await test.session.start({ isMicrophoneEnabled: true })
    expect(test.sources).toEqual([
      { kind: 'dialog', isMicrophoneEnabled: true },
    ])
    expect(test.session.status).toBe('running')
    test.audio.push({
      data: stereo([
        [5, 7],
        [6, 8],
      ]),
    })
    await flush()
    expect(test.heard.get('me')).toEqual([5, 6])
    expect(test.heard.get('remote')).toEqual([7, 8])
    expect(test.parts.map(([side]) => side).sort()).toEqual(['me', 'remote'])
    await test.session.stop()
    expect(test.session.status).toBe('idle')
    expect(test.events).toContain('stop-capture')
    expect(test.errors).toEqual([])
  })

  it('transcribes the computer alone into the other side', async () => {
    const test = harness({ channels: 1 })
    await test.session.start({ isMicrophoneEnabled: false })
    test.audio.push({ data: new Uint8Array([9, 0]) })
    await flush()
    expect(test.heard.get('remote')).toEqual([9])
    expect(test.heard.has('me')).toBe(false)
    await test.session.stop()
  })

  it('reconnects a broken channel and shifts its times by the audio before', async () => {
    let connections = 0
    const test = harness({
      channels: 1,
      transcribe: async function* ({ audio }) {
        connections += 1
        const connection = connections
        for await (const chunk of audio) {
          void chunk
          yield {
            type: 'final',
            segment: { text: `c${connection}`, startMs: 0, endMs: 1 },
          }
          if (connection === 1) throw new Error('socket closed')
        }
      },
    })
    await test.session.start({ isMicrophoneEnabled: false })
    // a second of audio at 1 kHz
    test.audio.push({ data: new Uint8Array(2000) })
    await flush()
    test.audio.push({ data: new Uint8Array(2) })
    await flush()
    expect(connections).toBe(2)
    expect(test.parts.map(([, part, offset]) => [part.type, offset])).toEqual([
      ['final', 0],
      ['final', 1000],
    ])
    expect(test.events).toContain('remote:reconnecting')
    expect(test.events).toContain('remote:draft-lost')
    expect(test.session.status).toBe('running')
    await test.session.stop()
    expect(test.errors).toEqual([])
  })

  it('gives a channel up after failures in a row and keeps the other', async () => {
    const test = harness({
      // eslint-disable-next-line require-yield
      transcribe: async function* ({ side, audio }) {
        if (side === 'me') throw new Error('401 unauthorized')
        for await (const chunk of audio) void chunk
      },
    })
    await test.session.start({ isMicrophoneEnabled: true })
    for (let index = 0; index < 10; index += 1) await flush()
    expect(test.events).toContain('me:failed')
    expect(test.errors[0][1]).toEqual({ isFatal: false, side: 'me' })
    expect(test.session.status).toBe('running')
    await test.session.stop()
  })

  it('ends with a fatal error when the capture fails', async () => {
    const test = harness()
    await test.session.start({ isMicrophoneEnabled: true })
    test.audio.fail(new Error('microphone unplugged'))
    for (let index = 0; index < 5; index += 1) await flush()
    expect(test.session.status).toBe('failed')
    expect(test.errors).toEqual([
      [new Error('microphone unplugged'), { isFatal: true }],
    ])
  })

  it('reports a capture that could not start', async () => {
    const refusal = { code: 'captureBusy', message: 'busy' }
    const test = harness({ startError: refusal })
    await expect(
      test.session.start({ isMicrophoneEnabled: true })
    ).rejects.toBe(refusal)
    expect(test.session.status).toBe('failed')
  })
})
