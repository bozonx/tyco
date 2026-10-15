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
        <Icon
          v-if="props.correctionError"
          icon="mdi:alert-circle-outline"
          height="14"
        />
        <Icon v-else icon="mdi:check" height="14" />
        {{ statusText }}
      </span>
    </template>

    <template #preview>
      <InProgressMessage
        v-if="props.isCorrecting"
        correction
        :onCancel="menuModalsStore.back"
      />
      <Diff
        v-else-if="props.oldText && !props.correctionError"
        :oldText="props.oldText"
        :newText="props.text"
        :mode="diffMode"
      />
      <TextPreview v-else :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :sourceText="props.oldText"
        :leftLetterKeys="leftLetterKeys"
        :spaceKey="spaceKey"
        :altText="
          props.insertOnly || editorTarget ? undefined : props.originalText
        "
        :altAlwaysVisible="props.isCorrecting"
        :altAction="primaryAction"
        :shortcutsDisabled="props.shortcutsDisabled"
        :isEditorButtonVisible="
          !props.isCorrecting &&
          !editorTarget &&
          (props.isEditorButtonVisible ?? !editorNavigation.isEditorPage())
        "
        :escMode="props.correction ? 'back' : 'auto'"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { type DiffViewMode, resolveDiffMode } from '../../lib/diff/diff-model'
import type { InsertMenuParams } from '../../lib/modals/menu-modal-params'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useEditorInputStore } from '../../stores/editor-input'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menu-modals'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Icon from '../common/AppIcon.vue'
import Diff from '../common/Diff.vue'
import ResultViewModeToggle from '../common/ResultViewModeToggle.vue'
import TextPreview from '../common/TextPreview.vue'
import InProgressMessage from './InProgressMessage.vue'

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

const ipcStore = useIpcStore()
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
const diffMode = ref<DiffViewMode>(
  resolveDiffMode(ipcStore.desktopState.userConfig.diffViewMode)
)

/** Space was pressed while isCorrecting: insert once the correction is in. */
const insertQueued = ref(false)

const statusVisible = computed(
  () => Boolean(props.correctionError) || props.isCorrectionUnchanged
)

const statusText = computed(() => {
  if (props.correctionError) return t('write.correctionFailed')
  return t('write.nothingToCorrect')
})

watch(diffMode, (mode) => {
  void ipcStore.saveUserConfig({
    ...ipcStore.desktopState.userConfig,
    diffViewMode: mode,
  })
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

function handleKeyDown(event: KeyboardEvent) {
  if (
    hasDiff.value &&
    event.key.toLowerCase() === 'd' &&
    (event.ctrlKey || event.altKey) &&
    !event.shiftKey
  ) {
    event.preventDefault()
    const modes: DiffViewMode[] = ['unified', 'split', 'result']
    diffMode.value = modes[(modes.indexOf(diffMode.value) + 1) % modes.length]
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))

const minCorrectionLength = computed(
  () => ipcStore.desktopState?.appConfig?.minCorrectionLength ?? 0
)

/** Why the correction action is off for this text, if it is. */
const correctionBlocker = computed(() => {
  if (props.correction && !props.correctionError) {
    return t('write.alreadyCorrected')
  }
  if (props.text.length < minCorrectionLength.value) {
    return t('write.textTooShortForCorrection')
  }
  return undefined
})

function shouldDisableAction(item?: ActionItem) {
  if (!item) return false
  if (item.id === 'insertIntoWindow') {
    return !(
      ipcStore.desktopState?.windowId &&
      props.text &&
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
      if (item.id === 'insertIntoWindow' && !ipcStore.desktopState?.windowId) {
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
    firstItem.id === 'insertIntoWindow' && !ipcStore.desktopState?.windowId
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
</style>
