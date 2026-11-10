import type { AudioChunk } from '@bozonx/ai-kit'
import type { ProviderStreamRequest, SttStreamEvent } from '@bozonx/ai-kit/stt'

/**
 * Ends each connection gracefully before its lifetime expires. Capture keeps
 * running into its bounded queue while the old connection drains and the new
 * one opens. Each audio chunk is consumed once; no transcript is replayed.
 */
export async function createRotatingSttStream(
  request: ProviderStreamRequest,
  open: (
    request: ProviderStreamRequest,
    requestRotation: () => void
  ) => Promise<AsyncIterable<SttStreamEvent>>,
  maxConnectionMs: number
): Promise<AsyncIterable<SttStreamEvent>> {
  const input = request.audio[Symbol.asyncIterator]()
  let inputEnded = false
  let totalBytes = 0
  let rotate = false
  let carry: AudioChunk | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const openConnection = async (
    first?: IteratorResult<{ data: Uint8Array }>
  ) => {
    rotate = false
    const beganAtBytes = totalBytes
    const audio = {
      async *[Symbol.asyncIterator]() {
        let pending = first
        while (!request.signal.aborted && !rotate) {
          const next = pending ?? (await input.next())
          pending = undefined
          if (next.done) {
            inputEnded = true
            return
          }
          if (rotate) {
            carry = next.value
            return
          }
          totalBytes += next.value.data.byteLength
          yield next.value
          if (
            ((totalBytes - beganAtBytes) * 1000) / (request.sampleRate * 2) >=
            maxConnectionMs
          )
            rotate = true
        }
      },
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      rotate = true
    }, maxConnectionMs)
    try {
      return await open({ ...request, audio }, () => {
        rotate = true
      })
    } catch (error) {
      clearTimeout(timer)
      throw error
    }
  }

  let connection = await openConnection()
  return {
    async *[Symbol.asyncIterator]() {
      let offsetMs = 0
      try {
        for (;;) {
          let draft: { text: string; startMs: number } | undefined
          for await (const event of connection) {
            if (event.type === 'partial') draft = event
            else if (event.type === 'final') draft = undefined
            if (event.type === 'partial')
              yield { ...event, startMs: event.startMs + offsetMs }
            else if (event.type === 'final')
              yield {
                ...event,
                segment: {
                  ...event.segment,
                  startMs: event.segment.startMs + offsetMs,
                  endMs: event.segment.endMs + offsetMs,
                },
              }
            else yield event
          }
          clearTimeout(timer)
          if (rotate && draft?.text.trim()) {
            yield {
              type: 'final',
              segment: {
                text: draft.text,
                startMs: draft.startMs + offsetMs,
                endMs: Math.max(
                  draft.startMs + offsetMs,
                  (totalBytes * 1000) / (request.sampleRate * 2)
                ),
              },
            }
          }
          if (!rotate || inputEnded || request.signal.aborted) return
          // Do not open an empty connection when Stop coincides with rotation.
          const first = carry
            ? { done: false as const, value: carry }
            : await input.next()
          carry = undefined
          if (first.done) return
          offsetMs = (totalBytes * 1000) / (request.sampleRate * 2)
          connection = await openConnection(first)
        }
      } finally {
        clearTimeout(timer)
        // Capture's owner stops it on failure/cancellation. Do not wait for a
        // pending next() here: that would prevent the owner seeing the failure.
        void input.return?.().catch(() => undefined)
      }
    },
  }
}
