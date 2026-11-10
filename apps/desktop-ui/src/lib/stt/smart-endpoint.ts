/** Initial local endpointing parameters, to be tuned on dictation recordings. */
export const SMART_SILENCE_MS = 1500
export const SMART_SOFT_MAX_UTTERANCE_MS = 25_000
export const SMART_MAX_UTTERANCE_MS = 30_000
export const SMART_INTER_WORD_SILENCE_MS = 300
const SPEECH_RMS = 0.008

/**
 * PCM16 mono endpointing; time comes from samples, independent of delivery
 * jitter.
 */
export function createSmartEndpoint(
  sampleRate: number,
  options: { isContinuous?: boolean } = {}
) {
  let durationMs = 0
  let silenceMs = 0
  let active = false
  return {
    push(data: Uint8Array) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const sampleCount = Math.floor(data.length / 2)
      let energy = 0
      for (let i = 0; i < sampleCount; i++) {
        const sample = view.getInt16(i * 2, true) / 32768
        energy += sample * sample
      }
      const duration = (sampleCount / sampleRate) * 1000
      const isSpeech =
        sampleCount > 0 &&
        (options.isContinuous || Math.sqrt(energy / sampleCount) >= SPEECH_RMS)
      if (!active && !isSpeech) return { start: false, end: false, skip: true }
      const start = !active
      active = true
      durationMs += duration
      silenceMs = isSpeech ? 0 : silenceMs + duration
      const end =
        (!options.isContinuous && silenceMs >= SMART_SILENCE_MS) ||
        (durationMs >= SMART_SOFT_MAX_UTTERANCE_MS &&
          silenceMs >= SMART_INTER_WORD_SILENCE_MS) ||
        durationMs >= SMART_MAX_UTTERANCE_MS
      if (end) {
        active = false
        durationMs = 0
        silenceMs = 0
      }
      return { start, end }
    },
    get active() {
      return active
    },
  }
}
