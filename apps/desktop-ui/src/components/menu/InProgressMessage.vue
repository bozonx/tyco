<template>
  <div class="in-progress">
    <StateMessage
      kind="loading"
      :message="
        props.label ||
        (props.correction
          ? t('menu.correction')
          : props.transformation
            ? t('menu.transformation')
            : props.styling
              ? t('menu.styling')
              : props.ai
                ? t('menu.aiRequest')
                : t('common.inProgress'))
      "
      icon="mdi:progress-clock"
    />

    <div
      v-if="props.allowBufferedIntent && menuModalsStore.bufferedIntent"
      class="buffered-intent-badge"
    >
      <AppIcon
        :icon="
          menuModalsStore.bufferedIntent === 'insert'
            ? isEditorTarget
              ? 'mdi:pencil-outline'
              : 'mdi:application-export'
            : 'mdi:clipboard-arrow-right-outline'
        "
        size="sm"
      />
      <span class="buffered-label">{{
        menuModalsStore.bufferedIntent === 'insert'
          ? isEditorTarget
            ? t('menu.replaceInEditor')
            : t('menu.willInsertOnFinish')
          : t('menu.willCopyOnFinish')
      }}</span>
      <span class="buffered-hint">({{ t('menu.cancelIntentHint') }})</span>
      <button
        type="button"
        class="buffered-dismiss"
        :title="t('menu.cancelIntentHint')"
        :aria-label="t('menu.cancelIntentHint')"
        @click="menuModalsStore.clearBufferedIntent"
      >
        <AppIcon icon="mdi:close" size="xs" />
      </button>
    </div>

    <div v-else-if="props.allowBufferedIntent" class="buffered-intent-hints">
      <button
        type="button"
        class="hint-chip"
        :class="{ 'is-disabled': !canBufferInsert }"
        :aria-disabled="!canBufferInsert"
        :title="!canBufferInsert ? t('selection.noTarget') : undefined"
        @click="requestBufferedInsert"
      >
        <span class="hint-kbd">Space</span>
        <span>{{
          isEditorTarget ? t('menu.replaceInEditor') : t('menu.insertOnFinish')
        }}</span>
      </button>
      <button
        v-if="canBufferCopy"
        type="button"
        class="hint-chip"
        @click="menuModalsStore.setBufferedIntent('copy')"
      >
        <span class="hint-kbd">C</span>
        <span>{{ t('menu.copyOnFinish') }}</span>
      </button>
    </div>

    <Button
      type="button"
      class="in-progress-cancel-btn"
      @click="handleCancel"
      variant="ghost"
      size="sm"
    >
      {{ t('common.cancel') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import type { PendingModalParams } from '../../lib/modals/menu-modal-params'
import { createKeyPressTracker } from '../../lib/ui/key-press-tracker'
import { useDesktopStore } from '../../stores/desktop'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import StateMessage from '../common/StateMessage.vue'

const props = withDefaults(defineProps<PendingModalParams>(), {
  ai: false,
  correction: false,
  transformation: false,
  styling: false,
  allowBufferedIntent: false,
  allowBufferedCopy: true,
})

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const editorNavigation = useEditorNavigation()
const { toastKey } = useToast()
const { t } = useI18n()

const isEditorTarget = computed(() => editorNavigation.isEditorPage())
const canBufferInsert = computed(
  () => isEditorTarget.value || desktopStore.canInsertIntoWindow
)
const canBufferCopy = computed(
  () => props.allowBufferedCopy && !(props.correction && isEditorTarget.value)
)

function requestBufferedInsert() {
  if (!canBufferInsert.value) {
    toastKey('selection.noTarget', 'warn')
    return
  }
  menuModalsStore.setBufferedIntent('insert')
}

function handleCancel() {
  if (menuModalsStore.bufferedIntent) {
    menuModalsStore.clearBufferedIntent()
    return
  }
  if (props.onCancel) {
    props.onCancel()
  } else {
    menuModalsStore.cancelPending()
  }
}

const keyPresses = createKeyPressTracker()

function handleKeyDown(event: KeyboardEvent) {
  if (!props.allowBufferedIntent) return
  if (event.ctrlKey || event.altKey || event.metaKey) return

  if (event.code === 'Escape' || event.key === 'Escape') {
    if (menuModalsStore.bufferedIntent) {
      event.preventDefault()
      event.stopImmediatePropagation()
      menuModalsStore.clearBufferedIntent()
    }
    return
  }

  if (event.repeat) {
    if (
      event.code === 'Space' ||
      event.code === 'Enter' ||
      (event.code === 'KeyC' && canBufferCopy.value)
    ) {
      event.preventDefault()
    }
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault()
    keyPresses.press(event.code)
    requestBufferedInsert()
    return
  }

  if (event.code === 'KeyC' && canBufferCopy.value) {
    event.preventDefault()
    keyPresses.press(event.code)
    menuModalsStore.setBufferedIntent('copy')
  }
}

function handleKeyUp(event: KeyboardEvent) {
  keyPresses.release(event.code)
}

function handleBlur() {
  keyPresses.clear()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)
  window.addEventListener('blur', handleBlur)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown, true)
  window.removeEventListener('keyup', handleKeyUp, true)
  window.removeEventListener('blur', handleBlur)
})

useDismissibleLayer({
  isOpen: () => true,
  elements: () => [],
  canDismissOutside: false,
  dismiss: handleCancel,
})
</script>

<style scoped>
.in-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
}

.buffered-intent-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-strong);
  border-radius: var(--radius-full);
  font-size: var(--text-caption);
  color: var(--color-base-content);
  animation: pulse-border 1.5s ease-in-out infinite alternate;
}

.buffered-label {
  font-weight: 500;
}

.buffered-hint {
  color: var(--app-text-muted);
  font-size: var(--text-caption);
}

.buffered-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  margin-left: 0.25rem;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.buffered-dismiss:hover {
  color: var(--color-base-content);
  background-color: var(--app-surface-sunken);
}

.buffered-intent-hints {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
}

.hint-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.25rem 0.625rem;
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-full);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.hint-chip:hover:not(.is-disabled) {
  color: var(--color-base-content);
  border-color: var(--app-border-strong);
  background-color: var(--app-surface-sunken);
}

.hint-chip.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.25;
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-base-content);
}

@keyframes pulse-border {
  from {
    border-color: var(--app-border-subtle);
  }
  to {
    border-color: var(--app-border-strong);
  }
}
</style>
