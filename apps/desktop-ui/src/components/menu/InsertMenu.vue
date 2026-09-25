<template>
  <ActionOverlayLayout :title="t('menu.insert')">
    <template v-if="props.correcting || props.correctionError" #header-extra>
      <span
        class="correction-status"
        :class="{ 'is-error': !props.correcting }"
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
    </template>

    <template #preview>
      <Diff
        v-if="props.oldText"
        :oldText="props.oldText"
        :newText="props.text"
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
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
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
  }
)

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const actionsMenu = computed(
  () => props.actions || actionMenuStore.getShortcutActions()
)
const { t } = useI18n()

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
</style>
