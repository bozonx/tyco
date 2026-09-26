<template>
  <div
    class="audio-waveform-container"
    :class="{ compact }"
    data-testid="audio-waveform"
  >
    <!-- Transcribing mode -->
    <div v-if="isTranscribing" class="transcribing-state">
      <span class="loading loading-spinner loading-lg text-primary" />
      <p class="transcribing-label">{{ t('menu.transcribing') }}</p>
    </div>

    <!-- Active listening / recording mode -->
    <div v-else class="listening-state">
      <div class="waveform-visualizer" aria-label="Audio waveform">
        <div
          v-for="(barHeight, index) in barHeights"
          :key="index"
          class="waveform-bar"
          :style="{ height: `${barHeight}px`, opacity: barOpacities[index] }"
        />
      </div>

      <div class="waveform-meta">
        <div class="waveform-status">
          <Icon icon="mdi:microphone" class="mic-icon animate-pulse" />
          <span>{{ t('menu.speakNow') }}</span>
        </div>
        <div class="waveform-timer">{{ formattedDuration }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { Icon } from '@iconify/vue'

const BAR_COUNT = 32
const MIN_BAR_HEIGHT = 6
const MAX_BAR_HEIGHT = 72
/** Room left for the recognized text below */
const COMPACT_MAX_BAR_HEIGHT = 28

const props = withDefaults(
  defineProps<{
    level?: number
    peak?: number
    durationMs?: number
    isTranscribing?: boolean
    compact?: boolean
  }>(),
  { level: 0, peak: 0, durationMs: 0, isTranscribing: false, compact: false }
)

const { t } = useI18n()

const barHeights = ref<number[]>(new Array(BAR_COUNT).fill(MIN_BAR_HEIGHT))
const barOpacities = ref<number[]>(new Array(BAR_COUNT).fill(0.45))

// Weights across bars to form a natural vocal bell-curve shape
const weights = Array.from({ length: BAR_COUNT }, (_, i) => {
  const norm = (i - BAR_COUNT / 2) / (BAR_COUNT / 2)
  return Math.exp(-norm * norm * 1.8)
})

let animationFrameId: number | null = null
let phase = 0

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  const clock = `${pad(minutes)}:${pad(seconds)}`
  return hours > 0 ? `${hours}:${clock}` : clock
}

const formattedDuration = computed(() => formatTime(props.durationMs))

function updateAnimation() {
  phase += 0.08
  const currentLevel = Math.max(0, Math.min(1, props.level))
  const currentPeak = Math.max(0, Math.min(1, props.peak))
  const effectiveLevel = Math.max(currentLevel * 1.5, currentPeak * 0.8)
  const maxBarHeight = props.compact ? COMPACT_MAX_BAR_HEIGHT : MAX_BAR_HEIGHT

  const newHeights: number[] = []
  const newOpacities: number[] = []

  for (let i = 0; i < BAR_COUNT; i++) {
    // Ambient breathing wave when silent or low volume
    const ambient = Math.sin(phase + i * 0.35) * 0.5 + 0.5
    const ambientHeight = MIN_BAR_HEIGHT + ambient * 4

    // Dynamic voice response when audio is received
    const voiceModulation =
      Math.sin(phase * 1.5 + i * 0.6) * 0.2 +
      Math.cos(phase * 2.2 + i * 0.4) * 0.2 +
      0.8
    const voiceHeight =
      MIN_BAR_HEIGHT +
      weights[i] *
        voiceModulation *
        effectiveLevel *
        (maxBarHeight - MIN_BAR_HEIGHT)

    const targetHeight = Math.max(ambientHeight, voiceHeight)
    const prevHeight = barHeights.value[i] || MIN_BAR_HEIGHT

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

  barHeights.value = newHeights
  barOpacities.value = newOpacities

  if (!props.isTranscribing) {
    animationFrameId = requestAnimationFrame(updateAnimation)
  }
}

watch(
  () => props.isTranscribing,
  (transcribing) => {
    if (transcribing && animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    } else if (!transcribing && animationFrameId === null) {
      animationFrameId = requestAnimationFrame(updateAnimation)
    }
  }
)

onMounted(() => {
  if (!props.isTranscribing) {
    animationFrameId = requestAnimationFrame(updateAnimation)
  }
})

onUnmounted(() => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
})
</script>

<style scoped>
.audio-waveform-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 140px;
  padding: var(--space-md);
  box-sizing: border-box;
}

.audio-waveform-container.compact {
  flex: 0 0 auto;
  height: auto;
  min-height: 0;
  padding: var(--space-sm) var(--space-lg) 0;
}

.compact .listening-state {
  gap: var(--space-sm);
  max-width: none;
}

.compact .waveform-visualizer {
  height: 32px;
}

.compact .transcribing-state {
  flex-direction: row;
  padding: var(--space-sm);
}

.compact .loading-lg {
  width: 1.25rem;
}

.transcribing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl);
}

.transcribing-label {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--app-text-muted);
  margin: 0;
}

.listening-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  width: 100%;
  max-width: 480px;
}

.waveform-visualizer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 80px;
  width: 100%;
}

.waveform-bar {
  width: 4px;
  min-width: 4px;
  background-color: var(--color-primary);
  border-radius: 999px;
  transition: height 0.05s ease-out;
  transform-origin: center;
}

.waveform-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 0.8125rem;
  color: var(--app-text-muted);
}

.waveform-status {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: 500;
}

.mic-icon {
  font-size: 1.125rem;
  color: var(--color-primary);
}

.waveform-timer {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, monospace);
  color: var(--app-text-faint);
}
</style>
