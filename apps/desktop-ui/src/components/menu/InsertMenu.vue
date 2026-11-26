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
    <template v-if="hasDiff || hasPages" #header-extra>
      <ActionPagesBar
        v-if="hasPages"
        :page-indexes="pageIndexes"
        :active-index="actionMenuStore.pageIndex"
        @select="selectPage"
      />
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
import { computed, onMounted, ref, watch } from 'vue'

import { useActionPages } from '../../composables/use-action-pages'
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
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useEditorInputStore } from '../../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useToastStore } from '../../stores/toast'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import ActionMenuPositionButton from '../quick/ActionMenuPositionButton.vue'
import ActionPagesBar from './ActionPagesBar.vue'
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
const { pageIndexes, hasPages, motionDirection, selectPage } = useActionPages({
  isDisabled: () => props.shortcutsDisabled,
})
onMounted(() => {
  if (
    menuModalsStore.currentModal === MenuModals.INSERT ||
    props.correction ||
    Boolean(props.oldText)
  ) {
    actionMenuStore.openPage(0)
  }
})

const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

const resolvedEscMode = computed(
  () =>
    props.escMode ??
    (props.correction || desktopStore.desktopState?.actionOrigin === 'dialog'
      ? 'back'
      : 'auto')
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
  if (hasDiff.value) stepMode(step)
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
</script>

<style scoped>
.preview-area {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}
</style>
