<template>
  <ActionOverlayLayout :title="t('menu.insert')">
    <template
      v-if="props.correcting || props.correctionError || hasDiff"
      #header-extra
    >
      <DiffModeToggle v-if="hasDiff" v-model="diffMode" />
      <span
        class="correction-status"
        :class="{ 'is-error': !props.correcting }"
        v-if="props.correcting || props.correctionError"
        :title="props.correctionError"
      >
        <span
          v-if="props.correcting"
          class="loading loading-spinner loading-xs"
        ></span>
        <Icon v-else icon="mdi:alert-circle-outline" height="14" />
        {{
          props.correcting ? t('write.correcting') : t('write.correctionFailed')
        }}
      </span>
      <button
        v-if="props.correcting && props.onCancelCorrection"
        type="button"
        class="correction-cancel"
        @click="props.onCancelCorrection"
      >
        {{ t('common.cancel') }}
      </button>
    </template>

    <template #preview>
      <Diff
        v-if="props.oldText"
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
        :stopListening="props.stopListening"
        :toEditorVisible="
          props.toEditorVisible ?? !routeParamsStore.isEditorPage()
        "
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
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
import DiffModeToggle from '../common/DiffModeToggle.vue'
import TextPreview from '../common/TextPreview.vue'
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
    /** The text before correction, still insertable with Shift+Space */
    originalText?: string
    /** A correction of `text` is on its way and will replace it */
    correcting?: boolean
    /** Why the correction failed; `text` is then the uncorrected one */
    correctionError?: string
    onCancelCorrection?: () => void
  }>(),
  {
    text: '',
    oldText: '',
    actions: undefined,
    allowInsertButton: true,
    stopListening: false,
    toEditorVisible: undefined,
    originalText: undefined,
    correcting: false,
    correctionError: undefined,
    onCancelCorrection: undefined,
  }
)

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const actionsMenu = computed(
  () => props.actions || actionMenuStore.getShortcutActions()
)
const { t } = useI18n()
const hasDiff = computed(() => Boolean(props.oldText))
const diffMode = ref<DiffViewMode>(readStoredDiffMode())

watch(diffMode, (mode) => writeStoredDiffMode(mode))

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

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  actionsMenu.value.map((item: ActionItem | undefined, index: number) =>
    item ? { ...item, disabled: shouldDisablePrimaryAction(index) } : undefined
  )
)

const spaceKey = computed<ActionItem | undefined>(() => {
  const [firstItem] = actionsMenu.value

  if (!firstItem) {
    return undefined
  }

  return { ...firstItem, disabled: shouldDisablePrimaryAction(0) }
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

.correction-cancel {
  color: var(--app-text-muted);
  cursor: pointer;
}

.correction-cancel:hover {
  color: var(--color-base-content);
}
</style>
