<template>
  <ActionOverlayLayout
    :title="props.correction ? t('menu.correction') : t('menu.insert')"
  >
    <template v-if="statusVisible || hasDiff" #header-extra>
      <DiffModeToggle v-if="hasDiff" v-model="diffMode" />
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
        v-if="props.correcting"
        correction
        :onCancel="menuModalsStore.back"
      />
      <Diff
        v-else-if="props.oldText"
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
        :altText="props.originalText"
        :altAlwaysVisible="props.correcting"
        :altAction="primaryAction"
        :stopListening="props.stopListening"
        :toEditorVisible="
          !props.correcting &&
          (props.toEditorVisible ?? !routeParamsStore.isEditorPage())
        "
        :escMode="props.correction ? 'back' : 'auto'"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  type DiffViewMode,
  readStoredDiffMode,
  writeStoredDiffMode,
} from '../../lib/diff/diff-model'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
import DiffModeToggle from '../common/DiffModeToggle.vue'
import TextPreview from '../common/TextPreview.vue'
import InProgressMessage from './InProgressMessage.vue'
import { Icon } from '@iconify/vue'

const routeParamsStore = useRouteParams()

const props = withDefaults(
  defineProps<{
    text?: string
    oldText?: string
    actions?: ActionItem[]
    allowInsertButton?: boolean
    stopListening?: boolean
    toEditorVisible?: boolean
    /** A correction step: Esc goes back to the text before it */
    correction?: boolean
    /** The text before correction, still insertable with Shift+Space */
    originalText?: string
    /** A correction of `text` is on its way and will replace it */
    correcting?: boolean
    /** Why the correction failed; `text` is then the uncorrected one */
    correctionError?: string
    /** The correction came back without changes */
    correctionUnchanged?: boolean
  }>(),
  {
    text: '',
    oldText: '',
    actions: undefined,
    allowInsertButton: true,
    stopListening: false,
    toEditorVisible: undefined,
    correction: false,
    originalText: undefined,
    correcting: false,
    correctionError: undefined,
    correctionUnchanged: false,
  }
)

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const menuModalsStore = useMenuModalsStore()
const actionsMenu = computed(
  () => props.actions || actionMenuStore.getShortcutActions()
)
const { t } = useI18n()
const hasDiff = computed(() => Boolean(props.oldText))
const diffMode = ref<DiffViewMode>(readStoredDiffMode())

/** Space was pressed while correcting: insert once the correction is in. */
const insertQueued = ref(false)

const statusVisible = computed(
  () => Boolean(props.correctionError) || props.correctionUnchanged
)

const statusText = computed(() => {
  if (props.correctionError) return t('write.correctionFailed')
  return t('write.nothingToCorrect')
})

watch(diffMode, (mode) => writeStoredDiffMode(mode))

watch(
  () => props.correcting,
  (correcting, wasCorrecting) => {
    if (correcting || !wasCorrecting) return
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
  () => ipcStore.params?.appConfig?.minCorrectionLength ?? 0
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

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  actionsMenu.value.map((item: ActionItem | undefined, index: number) => {
    if (!item) return undefined
    if (props.correcting) return { ...item, disabled: true }
    if (item.id === 'correction' && correctionBlocker.value) {
      return { ...item, disabled: true, hint: correctionBlocker.value }
    }
    return { ...item, disabled: shouldDisablePrimaryAction(index) }
  })
)

const primaryAction = computed<ActionItem | undefined>(() => {
  const [firstItem] = actionsMenu.value

  if (!firstItem) {
    return undefined
  }

  return { ...firstItem, disabled: shouldDisablePrimaryAction(0) }
})

const spaceKey = computed<ActionItem | undefined>(() => {
  const primary = primaryAction.value
  if (!primary || !props.correcting) return primary

  return {
    ...primary,
    labelKey: 'write.insertWhenCorrected',
    action: async () => {
      insertQueued.value = true
    },
  }
})

function needShowInsertButton() {
  return Boolean(
    ipcStore.params?.windowId && props.text && props.allowInsertButton
  )
}

function shouldDisablePrimaryAction(index: number) {
  if (index !== 0) {
    return false
  }

  if (props.actions) {
    return false
  }

  return !needShowInsertButton()
}
</script>

<style scoped>
.correction-status {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 16rem;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.correction-status.is-error {
  color: var(--color-warning);
}
</style>
