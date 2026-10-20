<template>
  <div
    class="audio-waveform-container"
    :class="{ compact, 'is-inline': layout === 'inline' }"
    data-testid="audio-waveform"
  >
    <!-- Transcribing mode -->
    <div v-if="isTranscribing" class="transcribing-state">
      <span class="loading loading-spinner loading-lg text-primary" />
      <p class="transcribing-label">{{ t('menu.transcribing') }}</p>
    </div>

    <!-- Active listening / recording mode -->
    <div v-else class="listening-state">
      <div class="waveform-visualizer" aria-hidden="true">
        <div
          v-for="(barHeight, index) in barHeights"
          :key="index"
          class="waveform-bar"
          :style="{ height: `${barHeight}px`, opacity: barOpacities[index] }"
        />
      </div>

      <div class="waveform-meta">
        <div class="waveform-status">
          <AppIcon icon="mdi:microphone" class="mic-icon animate-pulse" />
          <span>{{ t('menu.listening') }}</span>
        </div>
        <div class="waveform-timer">{{ formattedDuration }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  createAudioWaveformModel,
  formatWaveformDuration,
} from '../../lib/voice/audio-waveform-model'
import AppIcon from '../common/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    level?: number
    peak?: number
    durationMs?: number
    isTranscribing?: boolean
    layout?: 'stacked' | 'inline'
    compact?: boolean
  }>(),
  { level: 0, peak: 0, durationMs: 0, isTranscribing: false, compact: true }
)

const { t } = useI18n()

const model = createAudioWaveformModel()
const initial = model.step({ level: 0, peak: 0, isCompact: props.compact })
const barHeights = ref(initial.heights)
const barOpacities = ref(initial.opacities)
const formattedDuration = computed(() =>
  formatWaveformDuration(props.durationMs)
)
const isReducedMotion = ref(false)
let animationFrameId: number | null = null
let motionQuery: MediaQueryList | undefined

function updateAnimation() {
  animationFrameId = null
  if (props.isTranscribing || isReducedMotion.value) return
  const frame = model.step({
    level: props.level,
    peak: props.peak,
    isCompact: props.compact,
  })
  barHeights.value = frame.heights
  barOpacities.value = frame.opacities
  animationFrameId = requestAnimationFrame(updateAnimation)
}

function syncAnimation() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  if (!props.isTranscribing && !isReducedMotion.value)
    animationFrameId = requestAnimationFrame(updateAnimation)
}

function syncMotionPreference() {
  isReducedMotion.value = motionQuery?.matches ?? false
  syncAnimation()
}

watch(() => props.isTranscribing, syncAnimation)
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener('change', syncMotionPreference)
  syncMotionPreference()
})
onUnmounted(() => {
  motionQuery?.removeEventListener('change', syncMotionPreference)
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
})
</script>

<style scoped>
.audio-waveform-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  flex: 0 0 auto;
  box-sizing: border-box;
  background-color: var(--app-surface-raised);
  border-bottom: 1px solid var(--app-border-subtle);
  padding: var(--space-sm) var(--space-lg);
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
}

.listening-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  width: 100%;
}

.waveform-visualizer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  width: 100%;
  overflow: hidden;
}

/* Bars narrow down instead of spilling out of a narrow container */
.waveform-bar {
  flex: 0 1 4px;
  min-width: 1px;
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
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.waveform-status {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: 500;
}

.mic-icon {
  font-size: var(--text-lead);
  color: var(--color-primary);
}

.waveform-timer {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, monospace);
  color: var(--app-text-faint);
}

.transcribing-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  min-height: 48px;
  box-sizing: border-box;
}

.transcribing-label {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--app-text-muted);
  margin: 0;
}

/* Explicit full-size mode when compact is set to false */
.audio-waveform-container:not(.compact) {
  flex: 1 1 0%;
  height: 100%;
  min-height: 140px;
  padding: var(--space-md);
  border-bottom: none;
  background-color: transparent;
}

.audio-waveform-container:not(.compact) .listening-state {
  gap: var(--space-lg);
  max-width: 480px;
}

.audio-waveform-container:not(.compact) .waveform-visualizer {
  height: 80px;
}

.audio-waveform-container:not(.compact) .transcribing-state {
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-xl);
  min-height: 140px;
}

.audio-waveform-container:not(.compact) .transcribing-label {
  font-size: var(--text-title);
}

.audio-waveform-container.is-inline {
  padding: 0;
  border-bottom: none;
  background-color: transparent;
}
.is-inline .listening-state {
  flex-direction: row;
  gap: var(--space-sm);
}
.is-inline .waveform-visualizer {
  flex: 1 1 0%;
  min-width: 0;
  height: 28px;
  gap: 2px;
}
.is-inline .waveform-meta {
  width: auto;
  flex-shrink: 0;
  gap: var(--space-sm);
}
.is-inline .transcribing-state {
  min-height: 0;
  padding: 0;
}
@media (prefers-reduced-motion: reduce) {
  .waveform-bar {
    transition: none;
  }
  .mic-icon {
    animation: none;
  }
}
</style>
