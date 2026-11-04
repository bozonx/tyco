<template>
  <ActionOverlayLayout
    :title="props.correction ? t('menu.correction') : t('menu.actions')"
  >
    <template v-if="statusVisible || hasDiff" #header-extra>
      <ResultViewModeToggle preset="diff" v-if="hasDiff" v-model="diffMode" />
      <span v-if="statusVisible" class="correction-status">
        <AppIcon icon="mdi:check" size="sm" />
        {{ t('write.nothingToCorrect') }}
      </span>
    </template>

    <template #preview>
      <div
        v-if="actionMenuStore.takesText && (props.oldText || props.text)"
        class="preview-area"
      >
        <Diff
          v-if="props.oldText"
          :old-text="props.oldText"
          :new-text="props.text"
          :mode="diffMode"
        />
        <TextPreview v-else :text="props.text" />
        <div v-if="activeActionText" class="preview-actions">
          <IconButton
            class="preview-action-btn"
            size="sm"
            :label="
              isSavedAsSnippet
                ? t('action.savedAsSnippet')
                : t('action.saveAsSnippet')
            "
            :icon="isSavedAsSnippet ? 'mdi:check' : 'mdi:bookmark-plus-outline'"
            @click="saveAsSnippet"
          />
          <CopyButton
            class="preview-action-btn"
            :value="activeActionText"
            :label="t('action.copy')"
            size="sm"
          />
        </div>
      </div>
    </template>

    <template #actions>
      <div v-if="actionMenuStore.pageCount > 1" class="action-pages-bar">
        <button
          v-for="index in actionMenuStore.pageCount"
          :key="index"
          type="button"
          class="action-page-button"
          :class="{ 'is-active': actionMenuStore.pageIndex === index - 1 }"
          :aria-pressed="actionMenuStore.pageIndex === index - 1"
          @click="actionMenuStore.setPage(index - 1)"
        >
          <KeyboardKey v-if="index <= 10">{{
            index === 10 ? 0 : index
          }}</KeyboardKey>
          <span>{{ t('settings.actionPage', { page: index }) }}</span>
        </button>
      </div>

      <ShortcutList
        :key="actionMenuStore.pageIndex"
        :text="activeActionText"
        :source-text="activeSourceText"
        :editor-button-label="editorButtonLabel"
        :left-letter-keys="leftLetterKeys"
        :space-key="primaryAction"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="
          !editorTarget &&
          (props.isEditorButtonVisible ?? !editorNavigation.isEditorPage())
        "
        :esc-mode="props.correction ? 'back' : 'auto'"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { usePersistedDiffMode } from '../../composables/use-persisted-view-mode'
import useToast from '../../composables/use-toast'
import { useViewModeArrowKeys } from '../../composables/use-view-mode-arrow-keys'
import type { InsertMenuParams } from '../../lib/modals/menu-modal-params'
import {
  addSnippet,
  isDuplicateSnippet,
} from '../../lib/snippets/snippets-model'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useEditorInputStore } from '../../stores/editor-input'
import { useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'
import IconButton from '../common/IconButton.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import ResultViewModeToggle from './ResultViewModeToggle.vue'
import { APP_CONFIG } from '@tyco/shared'

const editorNavigation = useEditorNavigation()
const { toastKey } = useToast()

const isSavedAsSnippet = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null

async function saveAsSnippet() {
  const text = activeActionText.value.trim()
  if (!text) return

  const currentSnippets = desktopStore.userConfig.snippets?.items ?? []
  if (isDuplicateSnippet(currentSnippets, text)) {
    toastKey('toast.snippetAlreadyExists', 'warn')
    return
  }

  const result = addSnippet(currentSnippets, text)
  if (result.success) {
    await desktopStore.updateUserConfig({ snippets: { items: result.items } })
    isSavedAsSnippet.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      isSavedAsSnippet.value = false
    }, 1500)
  }
}

onUnmounted(() => {
  if (savedTimer) clearTimeout(savedTimer)
})

const props = withDefaults(defineProps<InsertMenuParams>(), {
  text: '',
  oldText: '',
  actions: undefined,
  allowInsertButton: true,
  shortcutsDisabled: false,
  isEditorButtonVisible: undefined,
  correction: false,
  originalText: undefined,
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
const { diffMode, stepMode } = usePersistedDiffMode()

const statusVisible = computed(() => props.isCorrectionUnchanged)

useViewModeArrowKeys((step) => {
  if (hasDiff.value) {
    stepMode(step)
  } else if (actionMenuStore.pageCount > 1) {
    if (step === 1) {
      actionMenuStore.nextPage()
    } else if (step === -1) {
      actionMenuStore.prevPage()
    }
  }
})

const isShowingOriginal = computed(
  () => diffMode.value === 'original' && Boolean(props.oldText)
)

const activeActionText = computed(() => {
  if (!actionMenuStore.takesText) return ''
  return isShowingOriginal.value ? props.oldText : props.text
})

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
  if (props.correction) {
    return t('write.alreadyCorrected')
  }
  if (activeActionText.value.trim().length < minCorrectionLength) {
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
  const insertAction =
    actionsMenu.value.find((item) => item?.id === 'insertIntoWindow') ??
    actionMenuStore
      .getDefaultActions()
      .find((action) => action.id === 'insertIntoWindow')

  if (!insertAction) {
    return undefined
  }

  const disabled = insertAction.disabled || shouldDisableAction(insertAction)
  const hint =
    insertAction.id === 'insertIntoWindow' && !desktopStore.canInsertIntoWindow
      ? t('selection.noTarget')
      : insertAction.hint

  return { ...insertAction, disabled, hint }
})

function onKeyDown(event: KeyboardEvent) {
  if (props.shortcutsDisabled || actionMenuStore.pageCount <= 1) return
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return
  }
  if (event.key === 'PageDown') {
    event.preventDefault()
    actionMenuStore.nextPage()
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    actionMenuStore.prevPage()
  } else if (/^[1-9]$/.test(event.key) || event.key === '0') {
    const target = event.key === '0' ? 9 : Number(event.key) - 1
    if (target < actionMenuStore.pageCount) {
      event.preventDefault()
      actionMenuStore.setPage(target)
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.action-pages-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.action-page-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  background: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-page-button:hover {
  background: var(--app-hover);
  color: var(--color-base-content);
}

.action-page-button.is-active {
  color: var(--color-primary);
  background-color: var(--app-surface-raised);
  border-color: var(--color-primary);
  font-weight: 500;
}

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

.preview-area {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}

.preview-actions {
  position: absolute;
  top: var(--space-xs);
  right: var(--space-xs);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.preview-action-btn {
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  opacity: 0.85;
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast);
}

.preview-action-btn:hover {
  opacity: 1;
}
</style>
