<template>
  <ActionOverlayLayout
    :title="t('menu.aiTask')"
    :on-esc="promptMode ? closePromptMode : undefined"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-if="promptMode"
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
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
        :space-key="customPromptAction"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="!editorNavigation.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { addTaskFromPrompt } from '../../lib/ai-tasks/custom-prompt'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { AiTaskMenuParams } from '../../lib/modals/menu-modal-params'
import { type ActionItem } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'

const props = withDefaults(defineProps<AiTaskMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  taskId: undefined,
})

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const appConfig = computed(() => desktopStore.appConfig)
const { toastKey } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

/** The own request mode: an input instead of the task keys */
const promptMode = ref(false)
const prompt = ref('')

const isQuickWindow = isInQuickWindow()

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
  (desktopStore.userConfig?.aiTasks ?? []).map(
    (item: (typeof desktopStore.userConfig.aiTasks)[number], index: number) =>
      item && item.name
        ? { name: item.name, action: () => runTask(index) }
        : undefined
  )
)

async function runTask(index: number) {
  const task = desktopStore.userConfig?.aiTasks?.[index]
  if (!task || !task.rule?.trim()) {
    toastKey('toast.desktopCommandFailed', 'error')
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
    menuModalsStore.updateStep(stepId, MenuModals.AI_TASK, {
      taskId: undefined,
    })
  }
  const index = (desktopStore.userConfig?.aiTasks ?? []).findIndex(
    (task) => task?.id === taskId
  )
  if (index < 0) {
    toastKey('toast.desktopCommandFailed', 'error')
    return
  }
  void runTask(index)
})

const recentPrompts = computed(
  () => desktopStore.sessionState?.recentAiPrompts ?? []
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
  void desktopStore.patchSessionState({
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
  const userConfig = desktopStore.userConfig
  if (!value || !userConfig) return

  const aiTasks = addTaskFromPrompt(
    userConfig.aiTasks ?? [],
    value,
    SHORTCUT_SLOT_KEYS.length
  )
  if (!aiTasks) {
    toastKey('menu.aiPromptSlotsFull', 'warn')
    return
  }

  const result = await desktopStore.updateUserConfig({ aiTasks })
  if (!result.success) toastKey('toast.desktopCommandFailed', 'error')
}

/** Applies `prompt` to the text with the `core.aiTask` tool, then the diff */
async function makeDiff(prompt: string) {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toastKey('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < appConfig.value.minAiTaskLength) {
    toastKey('toast.textTooShortToProcess', 'warn')
    return
  }

  await runStep({
    text: trimmedText,
    operation: 'ai-task',
    pending: { ai: true },
    invoke: (signal) =>
      invocations.call('core.aiTask', trimmedText, {
        signal,
        toolConfig: { prompt },
      }),
    read: (result) => {
      const newText = result.content ?? ''
      if (newText.trim()) return newText
      toastKey('toast.desktopCommandFailed', 'error')
      return null
    },
    show: (newText) =>
      menuModalsStore.nextModal(MenuModals.DIFF, {
        oldText: props.text,
        newText,
      }),
  })
}
</script>
