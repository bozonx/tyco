<template>
  <ActionOverlayLayout :title="t('menu.aiTask')">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :leftLetterKeys="leftLetterKeys"
        :stopListening="props.stopListening"
        :toEditorVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { type ActionItem } from '../../stores/actionMenu'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'

const props = withDefaults(
  defineProps<{ text?: string; stopListening?: boolean }>(),
  { text: '', stopListening: false }
)

const routeParamsStore = useRouteParams()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const { aiTasks } = useCallAi()
const appConfig = computed(() => ipcStore.params.appConfig)
const { toast } = useToast()
const historyStore = useHistoryStore()
const { t } = useI18n()
const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  ipcStore.params.userConfig.aiTasks.map(
    (
      item: (typeof ipcStore.params.userConfig.aiTasks)[number],
      index: number
    ) =>
      item
        ? {
            name: item.name,
            action: async () => {
              await makeDiff(index)
            },
          }
        : undefined
  )
)

async function makeDiff(index: number) {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toast(t('toast.noTextToProcess'), 'warn')

    return
  }

  if (trimmedText.length < appConfig.value.minCorrectionLength) {
    toast(t('toast.textTooShortToProcess'), 'warn')

    return
  }

  const sourceId = await historyStore.saveSource(trimmedText, 'ai-task')

  menuModalsStore.setPendingModal({ ai: true })
  try {
    const newText = await aiTasks(index, trimmedText)
    await historyStore.saveSourceResult(sourceId, newText).catch(() => {
      toast(t('history.operationFailed'), 'error')
    })
    menuModalsStore.nextModal(MenuModals.DIFF, { oldText: props.text, newText })
  } catch {
    // The request layer already reported the actionable error.
  } finally {
    menuModalsStore.clearPendingModal()
  }
}
</script>
