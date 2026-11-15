<template>
  <ActionOverlayLayout
    :title="props.correction ? t('menu.correction') : t('menu.actions')"
    :esc-mode="resolvedEscMode"
  >
    <template
      v-if="
        inQuickWindow && desktopStore.desktopState.mode === 'selectionActions'
      "
      #header-actions
    >
      <ActionMenuPositionButton />
    </template>
    <template v-if="hasDiff || actionMenuStore.pageCount > 1" #header-extra>
      <div
        v-if="actionMenuStore.pageCount > 1"
        ref="pagesBar"
        class="action-pages-bar"
        role="group"
        :aria-label="t('settings.mainActionGroups.actionPages')"
      >
        <span
          class="action-page-highlight"
          :style="highlightStyle"
          aria-hidden="true"
        />
        <KeyboardKey class="action-pages-hint">Tab</KeyboardKey>
        <button
          v-for="index in actionMenuStore.pageCount"
          :key="index"
          type="button"
          tabindex="-1"
          class="action-page-button"
          :class="{ 'is-active': actionMenuStore.pageIndex === index - 1 }"
          :aria-pressed="actionMenuStore.pageIndex === index - 1"
          @pointerdown="handlePagePointerDown"
          @click="handlePageClick($event, index - 1)"
        >
          <KeyboardKey v-if="index <= 10">{{
            index === 10 ? 0 : index
          }}</KeyboardKey>
          <span>{{ t('settings.actionPage', { page: index }) }}</span>
        </button>
      </div>
      <ResultViewModeToggle v-if="hasDiff" v-model="diffMode" preset="diff" />
    </template>

    <template #preview>
      <div v-if="actionMenuStore.takesText" class="preview-area">
        <ContextPreview
          v-model:disabled="isContextDisabled"
          v-model:text="draftText"
          editable
          :old-text="props.oldText"
          :diff-mode="diffMode"
          :allow-disable="props.allowRemoveContext"
        />
      </div>
    </template>

    <template #actions>
      <ShortcutList
        editor-shortcut
        :page-index="actionMenuStore.pageIndex"
        :motion-direction="motionDirection"
        :text="activeActionText"
        :source-text="activeSourceText"
        :editor-button-label="t('shortcuts.insertIntoEditor')"
        :left-letter-keys="leftLetterKeys"
        :space-key="primaryAction"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="
          !editorTarget &&
          (props.isEditorButtonVisible ?? !editorNavigation.isEditorPage())
        "
        :esc-mode="resolvedEscMode"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { usePersistedDiffMode } from '../../composables/use-persisted-view-mode'
import { useViewModeArrowKeys } from '../../composables/use-view-mode-arrow-keys'
import {
  actionRequiresContext,
  validateActionText,
} from '../../lib/action-menu/action-text-requirement'
import { isQuickWindow } from '../../lib/desktop/window'
import { voiceReplyActionParams } from '../../lib/listen/listen-reply-actions'
import type { InsertMenuParams } from '../../lib/modals/menu-modal-params'
import { isTextEntryTarget } from '../../lib/ui/text-entry-target'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useEditorInputStore } from '../../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useToastStore } from '../../stores/toast'
import KeyboardKey from '../common/KeyboardKey.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import ActionMenuPositionButton from '../quick/ActionMenuPositionButton.vue'
import ResultViewModeToggle from './ResultViewModeToggle.vue'
import { APP_CONFIG } from '@tyco/shared'

const editorNavigation = useEditorNavigation()
const isContextDisabled = ref(false)

const props = withDefaults(defineProps<InsertMenuParams>(), {
  text: '',
  oldText: '',
  actions: undefined,
  primaryAction: undefined,
  allowInsertButton: true,
  allowRemoveContext: true,
  shortcutsDisabled: false,
  isEditorButtonVisible: undefined,
  correction: false,
  escMode: undefined,
  originalText: undefined,
  isCorrectionUnchanged: false,
  insertOnly: false,
})

const draftStepId = useMenuModalsStore().currentStepId
const draftText = ref(props.text)
watch(
  () => props.text,
  (text) => {
    draftText.value = text
  }
)
watch(draftText, (text) => {
  const id = draftStepId
  if (id !== undefined)
    menuModalsStore.updateStep(id, MenuModals.INSERT, { text })
})
const inQuickWindow = isQuickWindow()
const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const pagesBar = ref<HTMLElement>()
const highlightStyle = ref<Record<string, string>>({ opacity: '0' })
const motionDirection = ref(1)
function updateHighlight() {
  const active = pagesBar.value?.querySelector<HTMLElement>('.is-active')
  if (!active) return
  highlightStyle.value = {
    width: `${active.offsetWidth}px`,
    height: `${active.offsetHeight}px`,
    transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
  }
}
watch(
  () => actionMenuStore.pageIndex,
  (index, previous) => {
    motionDirection.value = index > previous ? 1 : -1
    void nextTick(updateHighlight)
  },
  { flush: 'sync' }
)
let pagesResizeObserver: ResizeObserver | undefined
onMounted(() => {
  updateHighlight()
  if (typeof ResizeObserver === 'undefined') return
  pagesResizeObserver = new ResizeObserver(updateHighlight)
  if (pagesBar.value) pagesResizeObserver.observe(pagesBar.value)
})
onUnmounted(() => pagesResizeObserver?.disconnect())

const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

const resolvedEscMode = computed(
  () => props.escMode ?? (props.correction ? 'back' : 'auto')
)

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
  const actions = actionMenuStore.getShortcutActions().map((action) => {
    if (!action || !voiceReplyActionParams(action.id, '', props.replyTo))
      return action
    return {
      ...action,
      action: async (text: string) => {
        const params = voiceReplyActionParams(action.id, text, props.replyTo)
        if (params)
          menuModalsStore.nextModal(MenuModals.QUICK_AI_REQUEST, params)
      },
    }
  })
  if (!props.allowInsertButton) {
    return actions.filter((action) => action?.id !== 'insertIntoWindow')
  }
  return actions
})
const { t } = useI18n()
const hasDiff = computed(() => Boolean(props.oldText))
const { diffMode, stepMode } = usePersistedDiffMode()

const { toastKey } = useToastStore()
watch(
  () => props.isCorrectionUnchanged,
  (unchanged) => {
    if (unchanged) toastKey('write.nothingToCorrect')
  },
  { immediate: true }
)

useViewModeArrowKeys((step) => {
  if (hasDiff.value) {
    stepMode(step)
  } else if (actionMenuStore.pageCount > 1) {
    if (step === 1) {
      stepPage(1)
    } else if (step === -1) {
      stepPage(-1)
    }
  }
})

const activeActionText = computed(() => {
  if (isContextDisabled.value) return ''
  if (!actionMenuStore.takesText) return ''
  return draftText.value
})

const activeSourceText = computed(() => {
  if (isContextDisabled.value) return undefined
  return props.oldText
})

const minCorrectionLength = APP_CONFIG.minCorrectionLength

const actionValidation = (actionId?: string) =>
  validateActionText(actionId, activeActionText.value, { minCorrectionLength })

function shouldDisableAction(item?: ActionItem) {
  if (!item) return false
  if (isContextDisabled.value && actionRequiresContext(item.id)) {
    return true
  }
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
      if (isContextDisabled.value && actionRequiresContext(item.id)) {
        return { ...item, disabled: true, hint: t('menu.contextRequired') }
      }
      if (item.id === 'correction' && props.correction) {
        return { ...item, disabled: true, hint: t('write.alreadyCorrected') }
      }
      if (item.id === 'insertIntoWindow' && !desktopStore.canInsertIntoWindow) {
        return { ...item, disabled: true, hint: t('selection.noTarget') }
      }
      const validation = actionValidation(item.id)
      if (!validation.valid && validation.hintKey) {
        return { ...item, disabled: true, hint: t(validation.hintKey) }
      }
      return { ...item, disabled: item.disabled || shouldDisableAction(item) }
    }
  )
)

const primaryAction = computed<ActionItem | undefined>(() => {
  if (editorTarget.value) {
    if (isContextDisabled.value || !activeActionText.value) {
      return {
        ...applyToEditorAction,
        disabled: true,
        hint: t('menu.contextRequired'),
      }
    }
    return applyToEditorAction
  }
  if (props.primaryAction) {
    const custom = props.primaryAction
    const validation = actionValidation(custom.id)
    const disabled =
      custom.disabled || shouldDisableAction(custom) || !validation.valid
    const hint = isContextDisabled.value
      ? t('menu.contextRequired')
      : !validation.valid && validation.hintKey
        ? t(validation.hintKey)
        : custom.hint
    return { ...custom, disabled, hint }
  }
  if (!props.allowInsertButton) return undefined
  const insertAction =
    actionsMenu.value.find((item) => item?.id === 'insertIntoWindow') ??
    actionMenuStore
      .getDefaultActions()
      .find((action) => action.id === 'insertIntoWindow')

  if (!insertAction) {
    return undefined
  }

  const validation = actionValidation(insertAction.id)
  const disabled =
    insertAction.disabled ||
    shouldDisableAction(insertAction) ||
    !validation.valid
  const hint = isContextDisabled.value
    ? t('menu.contextRequired')
    : insertAction.id === 'insertIntoWindow' &&
        !desktopStore.canInsertIntoWindow
      ? t('selection.noTarget')
      : !validation.valid && validation.hintKey
        ? t(validation.hintKey)
        : insertAction.hint

  return { ...insertAction, disabled, hint }
})

function stepPage(direction: number) {
  if (direction > 0) actionMenuStore.nextPage()
  else actionMenuStore.prevPage()
  motionDirection.value = direction
}

function handlePagePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse') {
    event.preventDefault()
  }
}

function handlePageClick(event: MouseEvent, pageIndex: number) {
  ;(event.currentTarget as HTMLElement | null)?.blur()
  actionMenuStore.setPage(pageIndex)
}

function onKeyDown(event: KeyboardEvent) {
  if (props.shortcutsDisabled || actionMenuStore.pageCount <= 1) return
  if (event.isComposing || isTextEntryTarget(event.target)) return

  // Tab cycles the pages: the menu is driven by letter keys, not by focus
  if (
    event.key === 'Tab' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault()
    if (event.shiftKey) {
      stepPage(-1)
    } else {
      stepPage(1)
    }
    return
  }

  if (event.ctrlKey || event.altKey || event.metaKey) {
    return
  }
  if (event.key === 'PageDown') {
    event.preventDefault()
    stepPage(1)
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    stepPage(-1)
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
/* Page tabs: a segmented control with the page number keys */
.action-pages-bar {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--segment-gap);
  padding: var(--segment-padding);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);

  --key-size: var(--quick-kbd-size);
  --key-font-size: var(--quick-kbd-font-size);
}

.action-pages-hint {
  margin-inline: var(--space-xs);
}

.action-page-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm) var(--space-2xs) var(--space-2xs);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.action-page-button:hover {
  color: var(--color-base-content);
}

.action-page-button.is-active {
  color: var(--color-base-content);

  font-weight: 500;
}

.action-page-button:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 1px;
}

.preview-area {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}

.action-page-highlight {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  box-shadow: var(--app-shadow-segment);
  transition:
    transform 170ms cubic-bezier(0.2, 0, 0, 1),
    width 170ms ease-out,
    height 170ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .action-page-highlight {
    transition: none;
  }
}
</style>
