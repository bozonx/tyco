<template>
  <div
    class="dialog-selection-toolbar"
    role="toolbar"
    :aria-label="t('dialog.selectionToolbarLabel')"
  >
    <div class="dialog-selection-leading">
      <IconButton
        icon="mdi:close"
        size="sm"
        variant="ghost"
        :label="t('dialog.clearSelection')"
        :title="t('dialog.clearSelection')"
        @click="dialog.clearSelection"
      />
      <span class="dialog-selection-count">
        {{ t('dialog.selectionCount', { count: dialog.selectedCount }) }}
      </span>
    </div>

    <div class="dialog-selection-options">
      <FieldCheckbox
        :model-value="dialog.selectionIncludeMe"
        :label="t('dialog.selectionIncludeMe')"
        class="dialog-selection-checkbox"
        @update:model-value="(val) => (dialog.selectionIncludeMe = val)"
      />
      <FieldCheckbox
        :model-value="dialog.selectionUseTranslation"
        :label="t('dialog.selectionUseTranslation')"
        class="dialog-selection-checkbox"
        @update:model-value="(val) => (dialog.selectionUseTranslation = val)"
      />
    </div>

    <div class="dialog-selection-spacer" />

    <div class="dialog-selection-actions">
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:content-copy"
        :disabled="dialog.activeSelectedCount === 0"
        @click="dialog.copySelected"
      >
        {{ t('dialog.copySelected') }}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:chat-outline"
        :disabled="dialog.activeSelectedCount === 0"
        @click="dialog.sendSelectedToChat"
      >
        {{ t('dialog.sendToChat') }}
      </Button>
      <Button
        size="sm"
        variant="neutral"
        icon="mdi:creation-outline"
        :disabled="dialog.activeSelectedCount === 0"
        @click="dialog.promptAiSelected"
      >
        {{ t('dialog.promptAi') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useDialogStore } from '../../stores/dialog'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import IconButton from '../common/IconButton.vue'

const dialog = useDialogStore()
const { t } = useI18n()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && dialog.hasSelection) {
    dialog.clearSelection()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.dialog-selection-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xs) var(--space-md);
  background-color: var(--app-surface-raised);
  border-bottom: 1px solid var(--app-border-subtle);
  animation: selection-toolbar-enter 150ms ease-out;
  overflow-x: auto;
  flex-shrink: 0;
  z-index: 10;
}

@keyframes selection-toolbar-enter {
  from {
    opacity: 0;
    transform: translateY(-0.25rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-selection-toolbar {
    animation: none;
  }
}

.dialog-selection-leading {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.dialog-selection-count {
  font-size: var(--text-small, 0.8125rem);
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
}

.dialog-selection-options {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-shrink: 0;
}

.dialog-selection-checkbox {
  font-size: var(--text-small, 0.8125rem);
  white-space: nowrap;
}

.dialog-selection-spacer {
  flex: 1 1 0%;
  min-width: var(--space-sm);
}

.dialog-selection-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}
</style>
