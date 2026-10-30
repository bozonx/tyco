<template>
  <ActionOverlayLayout
    :title="props.correction ? t('menu.correction') : t('menu.actions')"
  >
    <template
      v-if="statusVisible || (hasDiff && !props.correctionError)"
      #header-extra
    >
      <ResultViewModeToggle
        preset="diff"
        v-if="hasDiff && !props.correctionError"
        v-model="diffMode"
      />
      <span
        v-if="statusVisible"
        class="correction-status"
        :class="{ 'is-error': Boolean(props.correctionError) }"
        :title="props.correctionError"
      >
        <AppIcon
          v-if="props.correctionError"
          icon="mdi:alert-circle-outline"
          size="sm"
        />
        <AppIcon v-else icon="mdi:check" size="sm" />
        {{ statusText }}
      </span>
    </template>

    <template #preview>
      <InProgressMessage
        v-if="props.isCorrecting"
        correction
        :on-cancel="menuModalsStore.back"
      />
      <div v-else class="preview-area">
        <Diff
          v-if="props.oldText && !props.correctionError"
          :old-text="props.oldText"
          :new-text="props.text"
          :mode="diffMode"
        />
        <TextPreview v-else :text="props.text" />
        <CopyButton
          v-if="activeActionText"
          class="preview-copy-btn"
          :value="activeActionText"
          :label="t('action.copy')"
          size="sm"
        />
      </div>
    </template>

    <template #actions>
      <ShortcutList
        :text="activeActionText"
        :source-text="activeSourceText"
        :editor-button-label="editorButtonLabel"
        :left-letter-keys="leftLetterKeys"
        :space-key="spaceKey"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="
          !props.isCorrecting &&
          !editorTarget &&
          (props.isEditorButtonVisible ?? !editorNavigation.isEditorPage())
        "
        :esc-mode="props.correction ? 'back' : 'auto'"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { usePersistedDiffMode } from '../../composables/use-persisted-view-mode'
import { usePreviewModeShortcut } from '../../composables/use-preview-mode-shortcut'
import type { InsertMenuParams } from '../../lib/modals/menu-modal-params'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useEditorInputStore } from '../../stores/editor-input'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import InProgressMessage from './InProgressMessage.vue'
import ResultViewModeToggle from './ResultViewModeToggle.vue'
import { APP_CONFIG } from '@tyco/shared'

const editorNavigation = useEditorNavigation()

const props = withDefaults(defineProps<InsertMenuParams>(), {
  text: '',
  oldText: '',
  actions: undefined,
  allowInsertButton: true,
  shortcutsDisabled: false,
  isEditorButtonVisible: undefined,
  correction: false,
  originalText: undefined,
  isCorrecting: false,
  correctionError: undefined,
  isCorrectionUnchanged: false,
  insertOnly: false,
})

const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

/**
 * A correction made over the editor goes back where its text came from: the
 * step then only applies it or, with Esc, leaves the text as it was
 */
const editorTarget = computed(
  () => props.correction && editorNavigation.isEditorPage()
)

const applyToEditorAction: ActionItem = {
  id: 'applyToEditor',
  labelKey: 'menu.replaceInEditor',
  icon: 'mdi:pencil-outline',
  action: async (text: string) => {
    if (
      editorNavigation.applyEditorTransfer(text, props.originalText ?? '') ===
      false
    )
      return
    menuModalsStore.closeAll()
    editorInputStore.requestFocus()
  },
}
const actionsMenu = computed(() => {
  if (props.actions) return props.actions
  if (props.insertOnly) {
    return actionMenuStore
      .getDefaultActions()
      .filter((action) => action.id === 'insertIntoWindow')
  }
  const actions = actionMenuStore.getShortcutActions()
  if (!props.allowInsertButton) {
    return actions.filter((action) => action?.id !== 'insertIntoWindow')
  }
  return actions
})
const { t } = useI18n()
const hasDiff = computed(() => Boolean(props.oldText))
const { diffMode, cycleMode } = usePersistedDiffMode()

/** Space was pressed while isCorrecting: insert once the correction is in. */
const insertQueued = ref(false)

const statusVisible = computed(
  () => Boolean(props.correctionError) || props.isCorrectionUnchanged
)

const statusText = computed(() => {
  if (props.correctionError) return t('write.correctionFailed')
  return t('write.nothingToCorrect')
})

watch(
  () => props.isCorrecting,
  (isCorrecting, wasCorrecting) => {
    if (isCorrecting || !wasCorrecting) return
    const queued = insertQueued.value
    insertQueued.value = false
    // after a failure the user decides what to do with the text as typed
    if (!queued || props.correctionError) return
    const primary = primaryAction.value
    if (primary && !primary.disabled) void primary.action(props.text)
  }
)

usePreviewModeShortcut(() => {
  if (hasDiff.value) cycleMode()
})

const isShowingOriginal = computed(
  () => diffMode.value === 'original' && Boolean(props.oldText)
)

const activeActionText = computed(() =>
  isShowingOriginal.value ? props.oldText : props.text
)

const activeSourceText = computed(() =>
  isShowingOriginal.value ? undefined : props.oldText
)

const editorButtonLabel = computed(() =>
  isShowingOriginal.value
    ? t('history.originalToEditor')
    : t('shortcuts.insertIntoEditor')
)

const minCorrectionLength = APP_CONFIG.minCorrectionLength

/** Why the correction action is off for this text, if it is. */
const correctionBlocker = computed(() => {
  if (props.correction && !props.correctionError) {
    return t('write.alreadyCorrected')
  }
  if (activeActionText.value.length < minCorrectionLength) {
    return t('write.textTooShortForCorrection')
  }
  return undefined
})

function shouldDisableAction(item?: ActionItem) {
  if (!item) return false
  if (item.id === 'insertIntoWindow') {
    return !(
      desktopStore.canInsertIntoWindow &&
      activeActionText.value &&
      props.allowInsertButton
    )
  }
  return false
}

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  (props.insertOnly || editorTarget.value ? [] : actionsMenu.value).map(
    (item: ActionItem | undefined) => {
      if (!item) return undefined
      if (props.isCorrecting) return { ...item, disabled: true }
      if (item.id === 'correction' && correctionBlocker.value) {
        return { ...item, disabled: true, hint: correctionBlocker.value }
      }
      if (item.id === 'insertIntoWindow' && !desktopStore.canInsertIntoWindow) {
        return { ...item, disabled: true, hint: t('selection.noTarget') }
      }
      return { ...item, disabled: item.disabled || shouldDisableAction(item) }
    }
  )
)

const primaryAction = computed<ActionItem | undefined>(() => {
  if (editorTarget.value) return applyToEditorAction
  if (!props.allowInsertButton) return undefined
  const [firstItem] = actionsMenu.value

  if (!firstItem) {
    return undefined
  }

  const disabled = firstItem.disabled || shouldDisableAction(firstItem)
  const hint =
    firstItem.id === 'insertIntoWindow' && !desktopStore.canInsertIntoWindow
      ? t('selection.noTarget')
      : firstItem.hint

  return { ...firstItem, disabled, hint }
})

const spaceKey = computed<ActionItem | undefined>(() => {
  if (!props.allowInsertButton && !editorTarget.value) return undefined
  const primary = primaryAction.value
  if (!primary || !props.isCorrecting) return primary

  return {
    ...primary,
    labelKey: 'write.insertWhenCorrected',
    action: async () => {
      insertQueued.value = true
    },
  }
})
</script>

<style scoped>
.correction-status {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 16rem;
  overflow: hidden;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.correction-status.is-error {
  color: var(--color-warning);
}

.preview-area {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}

.preview-copy-btn {
  position: absolute;
  top: var(--space-xs);
  right: var(--space-xs);
  z-index: 5;
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  opacity: 0.85;
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast);
}

.preview-copy-btn:hover {
  opacity: 1;
}
</style>
