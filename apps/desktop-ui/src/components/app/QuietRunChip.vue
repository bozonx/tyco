<template>
  <div v-if="status" ref="containerRef" class="relative" @focusout="onFocusout">
    <button
      ref="triggerRef"
      type="button"
      class="flex max-w-48 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm"
      :aria-expanded="isOpen"
      :title="status.commandName"
      @click="toggle"
    >
      <AppIcon icon="mdi:loading" size="sm" class="animate-spin" />
      <span class="truncate">{{ status.commandName }}</span>
    </button>
    <div
      v-if="isOpen"
      ref="panelRef"
      class="quiet-run-popover absolute right-0 z-20 mt-1 grid w-max max-w-64 gap-2 rounded-lg border p-3 shadow-lg"
    >
      <div>
        {{
          status.state === 'accepted'
            ? t('commandRun.quietAccepted', { name: status.commandName })
            : t('commandRun.quietRunning', { name: status.commandName })
        }}
      </div>
      <time v-if="status.startedAt !== null">{{ elapsed }}</time>
      <Button
        size="sm"
        variant="neutral"
        :loading="cancellingJobId === status.jobId"
        @click="cancel(status.jobId)"
      >
        {{ t('chat.stop') }}
      </Button>
    </div>
  </div>
  <Button
    v-if="completion"
    size="sm"
    variant="ghost"
    :icon="icon"
    :title="t(label, { name: completion.commandName })"
    :aria-label="t('commandRun.openHistory')"
    class="max-w-48"
    @click="$emit('openHistory')"
  >
    <span class="truncate">{{
      t(label, { name: completion.commandName })
    }}</span>
  </Button>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePopover } from '../../composables/use-popover'
import { useQuietRunStore } from '../../stores/quiet-run'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'

defineEmits<{ openHistory: [] }>()
const { t } = useI18n()
const store = useQuietRunStore()
const { status, completion, cancellingJobId } = storeToRefs(store)
const {
  isOpen,
  containerRef,
  panelRef,
  triggerRef,
  toggle,
  close,
  onFocusout,
} = usePopover()
const { cancel } = store
const now = ref(Date.now())
watch(
  () => status.value?.jobId,
  () => close()
)
watch(
  () => status.value?.startedAt,
  (running, _, onCleanup) => {
    if (!running) return
    now.value = Date.now()
    const timer = setInterval(() => (now.value = Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true }
)

const elapsed = computed(() => {
  const seconds = Math.max(
    0,
    Math.floor((now.value - (status.value?.startedAt ?? now.value)) / 1000)
  )
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const icon = computed(() => {
  if (completion.value?.state === 'succeeded') return 'mdi:check'
  if (completion.value?.state === 'cancelled') return 'mdi:cancel'
  return 'mdi:alert-circle-outline'
})
const label = computed(() => {
  if (completion.value?.state === 'succeeded')
    return 'commandRun.quietSucceeded'
  if (completion.value?.state === 'cancelled')
    return 'commandRun.quietCancelled'
  return 'commandRun.quietFailed'
})
</script>

<style scoped>
.quiet-run-popover {
  background: var(--color-surface);
  border-color: var(--color-border);
}
</style>
