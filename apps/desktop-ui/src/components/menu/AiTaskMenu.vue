<template>
  <ActionOverlayLayout
    :title="t('menu.aiTask')"
    :onEsc="promptMode ? closePromptMode : undefined"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-if="promptMode"
        v-model="prompt"
        :placeholder="t('menu.aiPromptPlaceholder')"
        :options="recentOptions"
        :hints="promptHints"
        @submit="submitPrompt"
        @save="savePromptAsTask"
        @back="closePromptMode"
      />
      <ShortcutList
        v-else
        :text="props.text"
        :spaceKey="customPromptAction"
        :altText="props.text"
        altAlwaysVisible
        :altAction="chatAction"
        :altLabel="t('action.askInChat')"
        altIcon="mdi:chat-outline"
        :leftLetterKeys="leftLetterKeys"
        :stopListening="props.stopListening"
        :toEditorVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { addTaskFromPrompt } from '../../lib/ai-tasks/custom-prompt'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import { type ActionItem } from '../../stores/actionMenu'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chatInput'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import { PRESETS_KEYS } from '../../types'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

const props = withDefaults(
  defineProps<{ text?: string; stopListening?: boolean }>(),
  { text: '', stopListening: false }
)

const routeParamsStore = useRouteParams()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const { aiTasks, aiCustomPrompt } = useCallAi()
const appConfig = computed(() => ipcStore.params.appConfig)
const { toast, toastText } = useToast()
const historyStore = useHistoryStore()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

/** The own request mode: an input instead of the task keys */
const promptMode = ref(false)
const prompt = ref('')

const isQuickWindow = (() => {
  try {
    return getCurrentWindow().label === 'quick'
  } catch {
    return false
  }
})()

const chatAction: ActionItem = {
  labelKey: 'action.askInChat',
  icon: 'mdi:chat-outline',
  action: async (text) => {
    menuModalsStore.closeAll()
    await chatStore.attachToChat(text)
  },
}

const customPromptAction: ActionItem = {
  labelKey: 'menu.aiCustomPrompt',
  icon: 'mdi:pencil-outline',
  action: async () => {
    prompt.value = ''
    promptMode.value = true
  },
}

const closePromptMode = () => {
  promptMode.value = false
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
              const task = ipcStore.params.userConfig?.aiTasks?.[index]
              if (!task || !task.rule?.trim()) {
                toast('toast.desktopCommandFailed', 'error')
                return
              }
              await makeDiff((text, signal) => aiTasks(index, text, { signal }))
            },
          }
        : undefined
  )
)

const recentPrompts = computed(
  () => ipcStore.params.localState?.recentAiPrompts ?? []
)

const recentOptions = computed<QueryPanelOption[]>(() =>
  filterOptions(
    recentPrompts.value.map((entry) => ({ id: entry, label: entry })),
    prompt.value
  ).filter((option) => option.label !== prompt.value.trim())
)

const promptHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('menu.aiPromptRun'),
    disabled: !prompt.value.trim(),
    action: () => submitPrompt({ ctrl: false }),
  },
  // the quick window hands the text to the main one, and the request would
  // be lost on the way
  ...(isQuickWindow
    ? []
    : [
        {
          keys: ['Ctrl', 'Enter'],
          label: t('action.askInChat'),
          disabled: !prompt.value.trim(),
          action: () => submitPrompt({ ctrl: true }),
        },
      ]),
  {
    keys: ['Ctrl', 'S'],
    label: t('menu.aiPromptSave'),
    disabled: !prompt.value.trim(),
    action: savePromptAsTask,
  },
  { keys: ['Esc'], label: t('common.back'), action: closePromptMode },
])

const rememberPrompt = (value: string) => {
  void ipcStore.patchLocalState({
    recentAiPrompts: pushRecent(recentPrompts.value, value),
  })
}

async function submitPrompt({ option, ctrl }: QueryPanelSubmit) {
  const value = (option?.label ?? prompt.value).trim()
  if (!value) return

  rememberPrompt(value)

  if (ctrl && !isQuickWindow) {
    menuModalsStore.closeAll()
    await chatStore.attachToChat(props.text)
    chatInputStore.setValue(value)
    await chatStore.sendInput()
    return
  }

  await makeDiff((text, signal) => aiCustomPrompt(value, text, { signal }))
}

async function savePromptAsTask() {
  const value = prompt.value.trim()
  const userConfig = ipcStore.params.userConfig
  if (!value || !userConfig) return

  const aiTasks = addTaskFromPrompt(
    userConfig.aiTasks ?? [],
    value,
    PRESETS_KEYS.length
  )
  if (!aiTasks) {
    toast('menu.aiPromptSlotsFull', 'warn')
    return
  }

  const result = await ipcStore.saveUserConfig({ ...userConfig, aiTasks })
  if (!result.success) toast('toast.desktopCommandFailed', 'error')
}

async function makeDiff(
  run: (text: string, signal: AbortSignal) => Promise<string>
) {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toast('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < appConfig.value.minAiTaskLength) {
    toast('toast.textTooShortToProcess', 'warn')
    return
  }

  const sourceId = await historyStore.saveSource(trimmedText, 'ai-task')

  // the menu step, when the menu is one: closing it hides the result
  const stepId = menuModalsStore.currentStepId
  const controller = new AbortController()
  menuModalsStore.setPendingModal({
    ai: true,
    onCancel: () => controller.abort(),
  })
  try {
    const newText = await run(trimmedText, controller.signal)
    if (controller.signal.aborted) return
    if (!newText || !newText.trim()) {
      toast('toast.desktopCommandFailed', 'error')
      return
    }
    await historyStore.saveSourceResult(sourceId, newText).catch(() => {
      toast('history.operationFailed', 'error')
    })
    // closed meanwhile: the result is in the history, not on the screen
    if (stepId !== undefined && !menuModalsStore.hasStep(stepId)) return
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
