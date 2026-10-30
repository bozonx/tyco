const BAR_COUNT = 32
const MIN_BAR_HEIGHT_PX = 4
const MAX_BAR_HEIGHT_PX = 72
/** Room left for the recognized text below */
const COMPACT_MAX_BAR_HEIGHT_PX = 28

// Weights across bars to form a natural vocal bell-curve shape
const weights = Array.from({ length: BAR_COUNT }, (_, i) => {
  const norm = (i - BAR_COUNT / 2) / (BAR_COUNT / 2)
  return Math.exp(-norm * norm * 1.8)
})

export function formatWaveformDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  const clock = `${pad(minutes)}:${pad(seconds)}`
  return hours > 0 ? `${hours}:${clock}` : clock
}

export function createAudioWaveformModel() {
  let phase = 0
  let heights = new Array<number>(BAR_COUNT).fill(MIN_BAR_HEIGHT_PX)
  function step(input: { level: number; peak: number; isCompact: boolean }) {
    phase += 0.08
    const currentLevel = Math.max(0, Math.min(1, input.level))
    const currentPeak = Math.max(0, Math.min(1, input.peak))
    const effectiveLevel = Math.max(currentLevel * 1.5, currentPeak * 0.8)
    const maxBarHeight = input.isCompact
      ? COMPACT_MAX_BAR_HEIGHT_PX
      : MAX_BAR_HEIGHT_PX

    const newHeights: number[] = []
    const newOpacities: number[] = []

    for (let i = 0; i < BAR_COUNT; i++) {
      // Ambient breathing wave when silent or low volume
      const ambient = Math.sin(phase + i * 0.35) * 0.5 + 0.5
      const ambientHeight = MIN_BAR_HEIGHT_PX + ambient * 4

      // Dynamic voice response when audio is received
      const voiceModulation =
        Math.sin(phase * 1.5 + i * 0.6) * 0.2 +
        Math.cos(phase * 2.2 + i * 0.4) * 0.2 +
        0.8
      const voiceHeight =
        MIN_BAR_HEIGHT_PX +
        weights[i] *
          voiceModulation *
          effectiveLevel *
          (maxBarHeight - MIN_BAR_HEIGHT_PX)

      const targetHeight = Math.max(ambientHeight, voiceHeight)
      const prevHeight = heights[i] || MIN_BAR_HEIGHT_PX

      // Fast attack, smooth decay
      const smoothedHeight =
        targetHeight > prevHeight
          ? prevHeight + (targetHeight - prevHeight) * 0.55
          : prevHeight + (targetHeight - prevHeight) * 0.2

      newHeights.push(Math.round(smoothedHeight * 10) / 10)

      const opacity =
        effectiveLevel > 0.03
          ? 0.45 + (smoothedHeight / maxBarHeight) * 0.55
          : 0.35 + ambient * 0.25
      newOpacities.push(Math.min(1, Math.max(0.2, opacity)))
    }

    heights = newHeights
    return { heights: newHeights, opacities: newOpacities }
  }

  function staticFrame(input: {
    level: number
    peak?: number
    isCompact: boolean
  }) {
    const currentLevel = Math.max(0, Math.min(1, input.level))
    const currentPeak = Math.max(0, Math.min(1, input.peak ?? 0))
    const effectiveLevel = Math.max(currentLevel * 1.5, currentPeak * 0.8)
    const maxBarHeight = input.isCompact
      ? COMPACT_MAX_BAR_HEIGHT_PX
      : MAX_BAR_HEIGHT_PX

    const height = Math.round(
      MIN_BAR_HEIGHT_PX +
        Math.min(1, effectiveLevel) * (maxBarHeight - MIN_BAR_HEIGHT_PX)
    )
    const opacity = effectiveLevel > 0.03 ? 0.8 : 0.4
    return {
      heights: new Array<number>(BAR_COUNT).fill(height),
      opacities: new Array<number>(BAR_COUNT).fill(opacity),
    }
  }

  return { step, staticFrame }
}
