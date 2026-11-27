<template>
  <details v-if="status && isRunning" :key="status.jobId" class="relative">
    <summary
      class="flex max-w-48 cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-sm"
      :title="status.commandName"
    >
      <AppIcon :icon="icon" size="sm" class="animate-spin" />
      <span class="truncate">{{ status.commandName }}</span>
    </summary>
    <div
      class="quiet-run-popover absolute right-0 z-20 mt-1 grid w-max max-w-64 gap-2 rounded-lg border p-3 shadow-lg"
    >
      <div>{{ t(label, { name: status.commandName }) }}</div>
      <time>{{ elapsed }}</time>
      <Button size="sm" variant="neutral" @click="cancel(status.jobId)">
        {{ t('chat.stop') }}
      </Button>
    </div>
  </details>
  <Button
    v-else-if="status"
    size="sm"
    variant="ghost"
    :icon="icon"
    :title="t(label, { name: status.commandName })"
    :aria-label="t('commandRun.openHistory')"
    class="max-w-48"
    @click="$emit('openHistory')"
  >
    <span class="truncate">{{ t(label, { name: status.commandName }) }}</span>
  </Button>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useQuietRunStore } from '../../stores/quiet-run'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'

defineEmits<{ openHistory: [] }>()
const { t } = useI18n()
const store = useQuietRunStore()
const { status, startedAt } = storeToRefs(store)
const { cancel } = store
const now = ref(Date.now())
const isRunning = computed(
  () => status.value?.state === 'accepted' || status.value?.state === 'running'
)

watch(
  isRunning,
  (running, _, onCleanup) => {
    if (!running) return
    now.value = Date.now()
    const timer = setInterval(() => (now.value = Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true }
)

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - startedAt.value) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const icon = computed(() => {
  if (isRunning.value) return 'mdi:loading'
  if (status.value?.state === 'succeeded') return 'mdi:check'
  if (status.value?.state === 'cancelled') return 'mdi:cancel'
  return 'mdi:alert-circle-outline'
})
const label = computed(() => {
  if (isRunning.value) return 'commandRun.quietRunning'
  if (status.value?.state === 'succeeded') return 'commandRun.quietSucceeded'
  if (status.value?.state === 'cancelled') return 'commandRun.quietCancelled'
  return 'commandRun.quietFailed'
})
</script>

<style scoped>
.quiet-run-popover {
  background: var(--color-surface);
  border-color: var(--color-border);
}
</style>
