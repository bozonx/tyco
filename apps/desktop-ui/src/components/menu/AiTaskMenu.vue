<template>
  <ActionOverlayLayout :title="t('menu.aiTask')">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :spaceKey="chatAction"
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
import { useChatStore } from '../../stores/chat'
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
const { toast, toastText } = useToast()
const historyStore = useHistoryStore()
const { t } = useI18n()
const chatStore = useChatStore()
const chatAction: ActionItem = {
  labelKey: 'action.askInChat',
  icon: 'mdi:chat-outline',
  action: async (text) => {
    menuModalsStore.closeAll()
    await chatStore.attachToChat(text)
  },
}
const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  (ipcStore.params.userConfig?.aiTasks ?? []).map(
    (
      item: (typeof ipcStore.params.userConfig.aiTasks)[number],
      index: number
    ) =>
      item && item.name
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
    toast('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < appConfig.value.minCorrectionLength) {
    toast('toast.textTooShortToProcess', 'warn')
    return
  }

  const task = ipcStore.params.userConfig?.aiTasks?.[index]
  if (!task || !task.rule?.trim()) {
    toast('toast.desktopCommandFailed', 'error')
    return
  }

  const sourceId = await historyStore.saveSource(trimmedText, 'ai-task')

  const controller = new AbortController()
  menuModalsStore.setPendingModal({
    ai: true,
    onCancel: () => controller.abort(),
  })
  try {
    const newText = await aiTasks(index, trimmedText, {
      signal: controller.signal,
    })
    if (controller.signal.aborted) return
    if (!newText || !newText.trim()) {
      toast('toast.desktopCommandFailed', 'error')
      return
    }
    await historyStore.saveSourceResult(sourceId, newText).catch(() => {
      toast('history.operationFailed', 'error')
    })
    menuModalsStore.nextModal(MenuModals.DIFF, { oldText: props.text, newText })
  } catch (error) {
    if (controller.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    toastText(message, 'error')
  } finally {
    menuModalsStore.clearPendingModal()
  }
}
</script>
