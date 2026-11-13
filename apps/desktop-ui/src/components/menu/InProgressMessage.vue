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

    <Button
      type="button"
      class="in-progress-cancel-btn"
      @click="handleCancel"
      variant="ghost"
      size="sm"
    >
      {{ props.cancelLabel || t('common.cancel') }}
    </Button>

    <div v-if="props.allowBufferedIntent" class="buffered-intent-slot">
      <div v-if="menuModalsStore.bufferedIntent" class="buffered-intent-badge">
        <AppIcon :icon="bufferedBadgeIcon" size="sm" />
        <KeyboardKey v-if="bufferedBadgeKey">{{
          bufferedBadgeKey
        }}</KeyboardKey>
        <span class="buffered-label">{{ bufferedBadgeLabel }}</span>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import useToast from '../../composables/use-toast'
import type { PendingModalParams } from '../../lib/modals/menu-modal-params'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import StateMessage from '../common/StateMessage.vue'

const props = withDefaults(defineProps<PendingModalParams>(), {
  ai: false,
  correction: false,
  transformation: false,
  styling: false,
  allowBufferedIntent: false,
  allowBufferedCopy: true,
})

const { handleCloseAll } = useOverlayNav()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()
const desktopStore = useDesktopStore()
const editorNavigation = useEditorNavigation()
const { toastKey } = useToast()
const { t } = useI18n()

const isEditorTarget = computed(() => editorNavigation.isEditorPage())
const isEditorCorrection = computed(
  () => props.correction && isEditorTarget.value
)
const canBufferInsert = computed(
  () => isEditorTarget.value || desktopStore.canInsertIntoWindow
)
const canBufferCopy = computed(
  () => props.allowBufferedCopy && !isEditorCorrection.value
)
const canBufferEditor = computed(
  () => !isEditorTarget.value && canBufferCopy.value
)

const bufferedBadgeIcon = computed(() => {
  const intent = menuModalsStore.bufferedIntent
  if (!intent) return 'mdi:application-export'
  if (intent === 'insert') {
    return isEditorTarget.value
      ? 'mdi:pencil-outline'
      : 'mdi:application-export'
  }
  if (intent === 'copy') return 'mdi:clipboard-arrow-right-outline'
  if (intent === 'editor') return 'mdi:pencil-outline'
  return intent.icon || 'mdi:lightning-bolt-outline'
})

const bufferedBadgeKey = computed(() => {
  const intent = menuModalsStore.bufferedIntent
  if (typeof intent === 'object' && intent !== null) {
    return intent.key
  }
  return ''
})

const bufferedBadgeLabel = computed(() => {
  const intent = menuModalsStore.bufferedIntent
  if (!intent) return ''
  if (intent === 'insert') {
    return isEditorTarget.value
      ? t('menu.replaceInEditor')
      : t('menu.willInsertOnFinish')
  }
  if (intent === 'copy') return t('menu.willCopyOnFinish')
  if (intent === 'editor') return t('shortcuts.insertIntoEditor')
  return intent.label
})

function getActionLabel(item?: ActionItem) {
  if (!item) return ''
  return item.labelKey ? t(item.labelKey) : item.label || item.name || ''
}

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

function handleKeyDown(event: KeyboardEvent) {
  if ((event.key === 'Escape' || event.code === 'Escape') && event.shiftKey) {
    event.preventDefault()
    event.stopImmediatePropagation()
    handleCloseAll()
    return
  }
  if (!props.allowBufferedIntent) return
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing)
    return

  if (event.code === 'Escape' || event.key === 'Escape') {
    if (menuModalsStore.bufferedIntent) {
      event.preventDefault()
      event.stopImmediatePropagation()
      menuModalsStore.clearBufferedIntent()
    }
    return
  }

  let codeLetter: string | undefined
  if (event.code.length === 4 && event.code.startsWith('Key')) {
    codeLetter = event.code.slice(3).toLowerCase()
  }
  const slotIndex = codeLetter
    ? SHORTCUT_SLOT_KEYS.findIndex((key) => key === codeLetter)
    : -1

  if (event.repeat) {
    if (
      event.code === 'Space' ||
      event.code === 'Enter' ||
      (event.code === 'Tab' && !event.shiftKey && canBufferEditor.value) ||
      (slotIndex >= 0 && canBufferCopy.value)
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault()
    event.stopImmediatePropagation()
    requestBufferedInsert()
    return
  }

  if (event.code === 'Tab' && !event.shiftKey && canBufferEditor.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    menuModalsStore.setBufferedIntent('editor')
    return
  }

  if (slotIndex >= 0 && canBufferCopy.value && codeLetter) {
    const slotAction = actionMenuStore.getShortcutActions()[slotIndex]
    if (slotAction && !slotAction.disabled) {
      if (props.correction && slotAction.id === 'correction') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (slotAction.id === 'insertIntoWindow') {
        requestBufferedInsert()
        return
      }
      if (slotAction.id === 'copyToClipboard') {
        menuModalsStore.setBufferedIntent('copy')
        return
      }
      const label = getActionLabel(slotAction)
      if (!label) return
      menuModalsStore.setBufferedIntent({
        slotIndex,
        key: codeLetter.toUpperCase(),
        label,
        icon: slotAction.icon,
      })
      return
    }
    if (codeLetter === 'c') {
      event.preventDefault()
      event.stopImmediatePropagation()
      menuModalsStore.setBufferedIntent('copy')
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown, true)
})

useDismissibleLayer({
  dismiss: handleCancel,
  isOpen: () => true,
  elements: () => [],
  canDismissOutside: false,
  keydown: (event) => {
    if (event.key !== 'Escape') return
    if (event.shiftKey) handleCloseAll()
    else handleCancel()
  },
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

.buffered-intent-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
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

@keyframes pulse-border {
  from {
    border-color: var(--app-border-subtle);
  }
  to {
    border-color: var(--app-border-strong);
  }
}
</style>
