import type { AudioChunk } from '@bozonx/ai-kit'
import type { CaptureSource } from '@tyco/shared'

import type { DialogSide, DialogTranscriptPart } from './dialog-transcript'

/** Bytes of one PCM16 sample */
const SAMPLE_BYTES = 2
/** How long a channel may wait for its provider before old audio is dropped */
const MAX_BUFFERED_MS = 30_000
/** The waits between reconnections of a channel, the last one repeated */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]
/** Failures in a row, without any speech in between, before a channel gives up */
const MAX_FAILURES_IN_ROW = 6
/** How long the providers may take for their last words once the audio ends */
const FINISH_TIMEOUT_MS = 10_000

/** What the dialog records, as `start_voice_capture` delivers it */
export interface DialogCapture {
  sampleRate: number
  /** 2: the microphone, then the computer sound; 1: the computer sound */
  channels: number
  audio: AsyncIterable<AudioChunk>
  /** Whether `audio` ended because another dialog took the sound over */
  isSuperseded: () => boolean
}

export interface DialogCaptureControl {
  start: (
    source: CaptureSource,
    isMicrophoneMuted?: boolean
  ) => Promise<DialogCapture>
  stop: () => Promise<void>
}

/** A live transcription of one channel */
export type DialogTranscribe = (request: {
  side: DialogSide
  audio: AsyncIterable<AudioChunk>
  sampleRate: number
  signal: AbortSignal
}) => AsyncIterable<
  DialogTranscriptPart | { type: 'error'; message: string } | { type: string }
>

export type DialogSessionStatus =
  'idle' | 'starting' | 'running' | 'stopping' | 'failed'

/**
 * - `connecting`: the provider of the channel is reached for the first time;
 * - `live`: it transcribes;
 * - `reconnecting`: its connection broke, another one follows;
 * - `failed`: it gave up; the other channel goes on;
 * - `muted`: the channel is muted by the user and not connected.
 */
export type DialogChannelStatus =
  'connecting' | 'live' | 'reconnecting' | 'failed' | 'muted'

export interface DialogSessionDependencies {
  capture: DialogCaptureControl
  transcribe: DialogTranscribe
  onStatus: (status: DialogSessionStatus) => void
  onChannelStatus: (side: DialogSide, status: DialogChannelStatus) => void
  /** What a channel recognized; `offsetMs` is where its connection began */
  onPart: (
    side: DialogSide,
    part: DialogTranscriptPart,
    offsetMs: number
  ) => void
  /** A channel's connection is gone: its guess will not be settled */
  onDraftLost: (side: DialogSide) => void
  /**
   * A channel's provider fell so far behind that its oldest audio was dropped:
   * the call recording holds audio the provider never got.
   */
  onAudioDropped?: (side: DialogSide, droppedMs: number) => void
  /**
   * The dialog or one channel of it failed. `isFatal`: the dialog is over;
   * otherwise only `side` stopped.
   */
  onError: (
    error: unknown,
    failure: { isFatal: boolean; side?: DialogSide }
  ) => void
  /**
   * The dialog was stopped while its capture started: the capture is stopped
   * again, and nothing of it reaches `onStatus('running')`
   */
  onCaptureAbandoned?: () => void
  /** Whether a provider error is not worth another connection, e.g. a bad key */
  isPermanentError?: (error: unknown) => boolean
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  reconnectDelaysMs?: readonly number[]
  finishTimeoutMs?: number
}

export interface DialogSession {
  readonly status: DialogSessionStatus
  readonly isMicrophoneMuted: boolean
  /** Resolves once the sound is recorded; the providers connect meanwhile */
  start: (options: {
    isMicrophoneEnabled: boolean
    isMicrophoneMuted?: boolean
  }) => Promise<void>
  /** Stops recording and waits for the providers' last words */
  stop: () => Promise<void>
  /** Sets whether the microphone channel is muted on the fly */
  setMicrophoneMuted: (isMuted: boolean) => void
}

/** The sides of the channels of a capture, in their order */
export function dialogSides(channels: number): DialogSide[] {
  return channels >= 2 ? ['me', 'remote'] : ['remote']
}

/**
 * Splits interleaved PCM16 into one buffer per channel. A chunk holds whole
 * frames; a trailing partial frame is dropped.
 */
export function splitPcm16Channels(
  data: Uint8Array,
  channels: number
): Uint8Array[] {
  if (channels <= 1) return [data]
  const frameBytes = SAMPLE_BYTES * channels
  const frames = Math.floor(data.byteLength / frameBytes)
  const outputs = Array.from(
    { length: channels },
    () => new Uint8Array(frames * SAMPLE_BYTES)
  )
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const from = frame * frameBytes + channel * SAMPLE_BYTES
      const to = frame * SAMPLE_BYTES
      outputs[channel][to] = data[from]
      outputs[channel][to + 1] = data[from + 1]
    }
  }
  return outputs
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

/**
 * The audio of one channel, read by one connection after another. A reader that
 * a provider abandons leaves the rest for the next connection; audio that waits
 * too long while no connection reads is dropped from the front.
 */
export interface ChannelPipe {
  push: (data: Uint8Array) => void
  /** Drops all currently queued unread bytes, advancing the clock */
  drain: () => void
  end: () => void
  /** Audio read or dropped so far, in bytes: the channel's clock */
  readonly positionBytes: number
  readonly isEnded: boolean
  /** One connection's audio; ends when the pipe does or `signal` aborts */
  reader: (signal: AbortSignal) => AsyncIterable<AudioChunk>
}

export function createChannelPipe(
  maxBufferedBytes: number,
  onDrop?: (droppedBytes: number) => void
): ChannelPipe {
  const queue: Uint8Array[] = []
  let queuedBytes = 0
  let positionBytes = 0
  let isEnded = false
  let wake: (() => void) | undefined

  const notify = () => {
    wake?.()
    wake = undefined
  }

  return {
    push(data) {
      if (isEnded || data.byteLength === 0) return
      queue.push(data)
      queuedBytes += data.byteLength
      let droppedBytes = 0
      while (queuedBytes > maxBufferedBytes && queue.length > 1) {
        const dropped = queue.shift()!
        queuedBytes -= dropped.byteLength
        positionBytes += dropped.byteLength
        droppedBytes += dropped.byteLength
      }
      if (droppedBytes > 0) onDrop?.(droppedBytes)
      notify()
    },
    drain() {
      while (queue.length > 0) {
        const dropped = queue.shift()!
        queuedBytes -= dropped.byteLength
        positionBytes += dropped.byteLength
      }
    },
    end() {
      isEnded = true
      notify()
    },
    get positionBytes() {
      return positionBytes
    },
    get isEnded() {
      return isEnded
    },
    reader(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          const onAbort = () => notify()
          signal.addEventListener('abort', onAbort)
          try {
            for (;;) {
              if (signal.aborted) return
              const next = queue.shift()
              if (next) {
                queuedBytes -= next.byteLength
                positionBytes += next.byteLength
                yield { data: next }
                continue
              }
              if (isEnded) return
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
          } finally {
            signal.removeEventListener('abort', onAbort)
          }
        },
      }
    },
  }
}

/**
 * The lifecycle of a dialog: one capture of both sides, split into a channel
 * per side, each transcribed by a connection of its own. A broken connection is
 * replaced without losing what was recognized; the dialog runs until it is
 * stopped.
 */
export function createDialogSession(
  deps: DialogSessionDependencies
): DialogSession {
  const sleep = deps.sleep ?? defaultSleep
  const delays = deps.reconnectDelaysMs ?? RECONNECT_DELAYS_MS
  let status: DialogSessionStatus = 'idle'
  let controller: AbortController | undefined
  let isMicrophoneMuted = false
  let meConnection: AbortController | undefined
  let meWake: (() => void) | undefined
  let pipes: ChannelPipe[] = []
  let channels: Promise<void>[] = []
  let pump: Promise<void> | undefined
  let isStopping = false

  const setStatus = (next: DialogSessionStatus) => {
    if (status === next) return
    status = next
    deps.onStatus(next)
  }

  const setMicrophoneMuted = (muted: boolean) => {
    if (isMicrophoneMuted === muted) return
    isMicrophoneMuted = muted
    if (muted) {
      meConnection?.abort()
    } else {
      const wake = meWake
      meWake = undefined
      wake?.()
    }
  }

  const runChannel = async (
    side: DialogSide,
    pipe: ChannelPipe,
    sampleRate: number,
    signal: AbortSignal
  ) => {
    const bytesPerMs = (sampleRate * SAMPLE_BYTES) / 1000
    let failures = 0
    while (!signal.aborted) {
      if (side === 'me' && isMicrophoneMuted) {
        deps.onChannelStatus(side, 'muted')
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
          signal.addEventListener('abort', onAbort)
          meWake = () => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
        })
        if (signal.aborted) return
        pipe.drain()
      }
      deps.onChannelStatus(side, 'connecting')

      const connection = new AbortController()
      if (side === 'me') {
        meConnection = connection
      }
      const abortConnection = () => connection.abort()
      signal.addEventListener('abort', abortConnection)
      const offsetMs = pipe.positionBytes / bytesPerMs
      let failure: unknown
      try {
        const parts = deps.transcribe({
          side,
          audio: pipe.reader(connection.signal),
          sampleRate,
          signal: connection.signal,
        })
        for await (const part of parts) {
          if (part.type === 'error')
            throw new Error((part as { message: string }).message)
          if (part.type !== 'partial' && part.type !== 'final') continue
          failures = 0
          deps.onChannelStatus(side, 'live')
          deps.onPart(side, part as DialogTranscriptPart, offsetMs)
        }
      } catch (error) {
        failure = error
      } finally {
        signal.removeEventListener('abort', abortConnection)
        connection.abort()
        if (side === 'me' && meConnection === connection) {
          meConnection = undefined
        }
      }
      deps.onDraftLost(side)
      // the audio is over: the dialog was stopped
      if (pipe.isEnded || signal.aborted) return

      // If muted, this disconnection was expected and should not count as failure
      if (side === 'me' && isMicrophoneMuted) {
        failures = 0
        continue
      }

      failures += 1
      if (
        failures >= MAX_FAILURES_IN_ROW ||
        (failure !== undefined && deps.isPermanentError?.(failure))
      ) {
        deps.onChannelStatus(side, 'failed')
        deps.onError(
          failure ?? new Error('The speech recognition session keeps closing'),
          { isFatal: false, side }
        )
        return
      }
      deps.onChannelStatus(side, 'reconnecting')
      await sleep(delays[Math.min(failures - 1, delays.length - 1)], signal)
    }
  }

  const finish = async (error?: unknown) => {
    if (isStopping) return
    isStopping = true
    setStatus('stopping')
    const wake = meWake
    meWake = undefined
    wake?.()
    await deps.capture.stop().catch(() => undefined)
    for (const pipe of pipes) pipe.end()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(channels),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deps.finishTimeoutMs ?? FINISH_TIMEOUT_MS)
      }),
    ])
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    pipes = []
    channels = []
    if (error !== undefined) {
      setStatus('failed')
      deps.onError(error, { isFatal: true })
    } else setStatus('idle')
  }

  return {
    get status() {
      return status
    },
    get isMicrophoneMuted() {
      return isMicrophoneMuted
    },

    async start({
      isMicrophoneEnabled,
      isMicrophoneMuted: initialMuted = false,
    }) {
      if (status === 'starting' || status === 'running') return
      if (status === 'stopping') await pump
      isStopping = false
      isMicrophoneMuted = initialMuted
      setStatus('starting')
      const current = new AbortController()
      controller = current
      let capture: DialogCapture
      try {
        capture = await deps.capture.start(
          { kind: 'dialog', isMicrophoneEnabled },
          isMicrophoneMuted
        )
      } catch (error) {
        controller = undefined
        setStatus('failed')
        throw error
      }
      if (current.signal.aborted) {
        await deps.capture.stop().catch(() => undefined)
        deps.onCaptureAbandoned?.()
        return
      }
      const sides = dialogSides(capture.channels)
      const maxBufferedBytes =
        (capture.sampleRate * SAMPLE_BYTES * MAX_BUFFERED_MS) / 1000
      const bytesPerMs = (capture.sampleRate * SAMPLE_BYTES) / 1000
      pipes = sides.map((side) =>
        createChannelPipe(maxBufferedBytes, (droppedBytes) =>
          deps.onAudioDropped?.(side, droppedBytes / bytesPerMs)
        )
      )
      channels = sides.map((side, index) =>
        runChannel(side, pipes[index], capture.sampleRate, current.signal)
      )
      setStatus('running')
      const ownPipes = pipes
      pump = (async () => {
        let failure: unknown
        try {
          for await (const chunk of capture.audio) {
            const parts = splitPcm16Channels(chunk.data, sides.length)
            parts.forEach((part, index) => ownPipes[index].push(part))
          }
          if (!isStopping && !capture.isSuperseded())
            failure = new Error('The sound capture of the dialog ended')
        } catch (error) {
          failure = error
        }
        if (controller !== current) return
        await finish(isStopping ? undefined : failure)
      })()
    },

    async stop() {
      if (status === 'idle' || status === 'failed') return
      if (status === 'starting') controller?.abort()
      await finish()
      await pump
    },

    setMicrophoneMuted,
  }
}
