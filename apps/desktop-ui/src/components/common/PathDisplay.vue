<template>
  <div class="path-display" :class="{ 'is-wrap': wrap }">
    <code
      class="path-display-text"
      :class="{ 'path-display-placeholder': !path && placeholder }"
      :title="path || placeholder"
    >
      <slot>{{ path || placeholder }}</slot>
    </code>

    <div v-if="hasActions" class="path-display-actions">
      <CopyButton
        v-if="path && canCopy"
        class="path-display-copy-btn"
        :value="path"
        :size="size"
        :label="copyLabel ?? t('settings.storageCopyPath')"
        :copied-label="copiedLabel ?? t('settings.storagePathCopied')"
      />
      <IconButton
        v-if="canOpen"
        class="path-display-open-btn"
        :size="size"
        variant="ghost"
        icon="mdi:folder-open-outline"
        :label="openLabel ?? t('settings.storageOpenFolder')"
        :title="openLabel ?? t('settings.storageOpenFolder')"
        @click="emit('open')"
      />
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ControlSize } from '../../lib/ui/control-types'
import CopyButton from './CopyButton.vue'
import IconButton from './IconButton.vue'

const props = withDefaults(
  defineProps<{
    path?: string
    placeholder?: string
    canCopy?: boolean
    canOpen?: boolean
    openLabel?: string
    copyLabel?: string
    copiedLabel?: string
    wrap?: boolean
    size?: ControlSize
  }>(),
  {
    path: '',
    placeholder: '',
    canCopy: true,
    canOpen: false,
    openLabel: undefined,
    copyLabel: undefined,
    copiedLabel: undefined,
    wrap: false,
    size: 'sm',
  }
)

const emit = defineEmits<{ open: [] }>()

const slots = useSlots()
const { t } = useI18n()

const hasActions = computed(() =>
  Boolean((props.path && props.canCopy) || props.canOpen || slots.actions)
)
</script>

<style scoped>
.path-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0.375rem 0.5rem 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  min-width: 0;
  width: 100%;
}

.path-display-text {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  color: var(--color-base-content);
  user-select: all;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-display.is-wrap .path-display-text {
  overflow: visible;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.path-display-placeholder {
  color: var(--app-text-muted);
  user-select: none;
}

.path-display-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}
</style>
