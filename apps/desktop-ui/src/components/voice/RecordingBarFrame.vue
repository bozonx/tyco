<template>
  <div
    class="voice-bar"
    :class="{
      'is-collapsed': isCollapsed,
      'can-collapse': Boolean(collapseMode),
    }"
    role="region"
    :aria-label="label"
  >
    <IconButton
      v-if="collapseMode"
      class="recording-collapse-button"
      :icon="isCollapsed ? 'mdi:chevron-up' : 'mdi:chevron-down'"
      :label="
        t(isCollapsed ? 'window.expandRecording' : 'window.collapseRecording')
      "
      :aria-expanded="!isCollapsed"
      :disabled="isSaving"
      size="xs"
      @click="toggleCollapsed"
    />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useDesktopStore } from '../../stores/desktop'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{
  label: string
  collapseMode?: 'voice' | 'listen'
}>()
const desktop = useDesktopStore()
const { t } = useI18n()
const isSaving = ref(false)
const configKey = computed(() =>
  props.collapseMode === 'listen' ? 'isListenCollapsed' : 'isVoiceCollapsed'
)
const isCollapsed = computed(() =>
  Boolean(props.collapseMode && desktop.userConfig.quickWindow[configKey.value])
)
async function toggleCollapsed() {
  if (isSaving.value) return
  isSaving.value = true
  try {
    await desktop.updateUserConfig({
      quickWindow: {
        ...desktop.savedUserConfig.quickWindow,
        [configKey.value]: !isCollapsed.value,
      },
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<style scoped>
.voice-bar {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  padding: var(--space-sm);
  box-sizing: border-box;
  border: 1px solid color-mix(in oklab, var(--color-primary) 45%, transparent);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
}
.recording-collapse-button {
  position: absolute;
  top: var(--space-sm);
  left: var(--space-sm);
}
.voice-bar.can-collapse:not(.is-collapsed) :deep(.voice-bar-header),
.voice-bar.can-collapse:not(.is-collapsed) :deep(.listen-bar-header) {
  padding-left: 2rem;
}
.voice-bar.is-collapsed[class] {
  height: auto;
  min-height: 0;
  max-height: none;
  flex-direction: row;
  align-items: center;
}
.is-collapsed .recording-collapse-button {
  position: static;
  flex-shrink: 0;
}
.is-collapsed :deep(.voice-bar-transcript),
.is-collapsed :deep(.voice-reference-text),
.is-collapsed :deep(.voice-bar-styling-grid),
.is-collapsed :deep(.listen-bar-notice) {
  display: none;
}
.is-collapsed :deep(.voice-bar-header),
.is-collapsed :deep(.listen-bar-header) {
  display: contents;
}
.is-collapsed
  :deep(.voice-bar-header > :not(.overlay-drag-handle):not(.voice-bar-close)),
.is-collapsed
  :deep(
    .listen-bar-header > :not(.overlay-drag-handle):not(.listen-bar-close)
  ) {
  display: none;
}
.is-collapsed :deep(.voice-bar-footer) {
  flex: 1;
  min-width: 0;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  flex-wrap: nowrap;
}
.is-collapsed :deep(.voice-bar-close),
.is-collapsed :deep(.listen-bar-close) {
  order: 2;
}
</style>
