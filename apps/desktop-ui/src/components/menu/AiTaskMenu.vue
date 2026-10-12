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
        :leftLetterKeys="leftLetterKeys"
        :stopListening="props.stopListening"
        :toEditorVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { addTaskFromPrompt } from '../../lib/ai-tasks/custom-prompt'
import { getDesktopWindow as getCurrentWindow } from '../../lib/desktop/window'
import { toolResultMessage } from '../../lib/invocation/invocation-result'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import { type ActionItem } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useHistoryStore } from '../../stores/history'
import { useInvocationsStore } from '../../stores/invocations'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { PRESETS_KEYS } from '../../types'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'

const props = withDefaults(
  defineProps<{
    text?: string
    stopListening?: boolean
    /** An AI task to run at once, by its id: the main menu item of the task */
    taskId?: string
  }>(),
  { text: '', stopListening: false, taskId: undefined }
)

const routeParamsStore = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const invocations = useInvocationsStore()
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
        ? { name: item.name, action: () => runTask(index) }
        : undefined
  )
)

async function runTask(index: number) {
  const task = ipcStore.params.userConfig?.aiTasks?.[index]
  if (!task || !task.rule?.trim()) {
    toast('toast.desktopCommandFailed', 'error')
    return
  }
  await makeDiff(task.rule)
}

// once: back on this step from the result, the menu waits for a choice
onMounted(() => {
  const taskId = props.taskId
  if (!taskId) return
  const stepId = menuModalsStore.currentStepId
  if (stepId !== undefined) {
    menuModalsStore.updateStep(stepId, { taskId: undefined })
  }
  const index = (ipcStore.params.userConfig?.aiTasks ?? []).findIndex(
    (task) => task?.id === taskId
  )
  if (index < 0) {
    toast('toast.desktopCommandFailed', 'error')
    return
  }
  void runTask(index)
})

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

  await makeDiff(value)
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

/** Applies `prompt` to the text with the `core.aiTask` tool, then the diff */
async function makeDiff(prompt: string) {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toast('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < appConfig.value.minAiTaskLength) {
    toast('toast.textTooShortToProcess', 'warn')
    return
  }

  // the menu step, when the menu is one: closing it hides the result
  const stepId = menuModalsStore.currentStepId
  const controller = new AbortController()
  const owner = menuModalsStore.setPendingModal({
    ai: true,
    onCancel: () => controller.abort(),
  })
  try {
    const sourceId = await historyStore.saveSource(trimmedText, 'ai-task')
    if (controller.signal.aborted) return
    const result = await invocations.call('core.aiTask', trimmedText, {
      signal: controller.signal,
      toolConfig: { prompt },
    })
    if (result.cancelled || controller.signal.aborted) return
    if (!result.ok) {
      toastText(toolResultMessage(result, t), 'error')
      return
    }
    const newText = result.content ?? ''
    if (!newText.trim()) {
      toast('toast.desktopCommandFailed', 'error')
      return
    }
    await historyStore.saveSourceResult(sourceId, newText).catch(() => {
      toast('history.operationFailed', 'error')
    })
    // closed meanwhile: the result is in the history, not on the screen
    if (controller.signal.aborted) return
    if (stepId !== undefined && !menuModalsStore.hasStep(stepId)) return
    menuModalsStore.nextModal(MenuModals.DIFF, { oldText: props.text, newText })
  } catch (error) {
    if (controller.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    toastText(message, 'error')
  } finally {
    menuModalsStore.clearPendingModal(owner)
  }
}
</script>
