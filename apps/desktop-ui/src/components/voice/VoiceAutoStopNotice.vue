<template>
  <div v-if="secondsLeft !== undefined" class="auto-stop-notice" role="status">
    <AppIcon icon="mdi:timer-sand" class="auto-stop-icon" aria-hidden="true" />
    <span>{{ t('menu.autoStopCountdown', { seconds: secondsLeft }) }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'

/** How often the countdown is redrawn */
const TICK_MS = 250

const props = defineProps<{
  /** When the recording stops by itself, on the `Date.now()` clock */
  deadlineMs?: number
}>()

const { t } = useI18n()
const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

watch(
  () => props.deadlineMs,
  (deadlineMs) => {
    if (ticker) clearInterval(ticker)
    ticker = undefined
    nowMs.value = Date.now()
    if (deadlineMs === undefined) return
    ticker = setInterval(() => {
      nowMs.value = Date.now()
    }, TICK_MS)
  },
  { immediate: true }
)

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})

const secondsLeft = computed(() =>
  props.deadlineMs === undefined
    ? undefined
    : Math.max(0, Math.ceil((props.deadlineMs - nowMs.value) / 1000))
)
</script>
<style scoped>
.auto-stop-notice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  align-self: center;
  padding: 0.125rem var(--space-sm);
  border-radius: var(--radius-md);
  background-color: color-mix(in oklab, var(--color-warning) 18%, transparent);
  color: var(--app-text);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.auto-stop-icon {
  color: var(--color-warning);
}
</style>
