<template>
  <div
    v-if="currentMode === 'running' && currentTask"
    class="ai-task-menu-running"
  >
    <AiTaskProgress
      :task="currentTask"
      :state="taskRunState"
      @decide="handleApprovalDecision"
      @cancel="cancelTask"
    />
  </div>

  <AiTaskResult
    v-else-if="currentMode === 'result' && currentTask"
    :task="currentTask"
    :result-text="resultText"
    :source-text="inputText"
    :was-focus-guard-triggered="wasFocusGuardTriggered"
    :was-insert-failed="wasInsertFailed"
    @close="closeResult"
  />

  <ActionOverlayLayout v-else :title="layoutTitle" :on-esc="handleEsc">
    <template #preview>
      <TextPreview :text="displayPreviewText" />
    </template>

    <template #actions>
      <!-- Manual text input when selection was empty -->
      <QueryPanel
        v-if="currentMode === 'manual-input'"
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
        v-model="manualInputText"
        :placeholder="t('input.textPlaceholder')"
        :hints="manualInputHints"
        @submit="submitManualInput"
        @back="currentMode = 'tasks'"
      />

      <!-- Custom prompt mode -->
      <QueryPanel
        v-else-if="currentMode === 'custom-prompt'"
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
        v-model="prompt"
        :placeholder="t('menu.aiPromptPlaceholder')"
        :options="recentOptions"
        :hints="promptHints"
        @submit="submitCustomPrompt"
        @save="savePromptAsTask"
        @back="currentMode = 'tasks'"
      />

      <!-- Tasks list mode -->
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
import { computed, onUnmounted, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import useToast from '../../composables/use-toast'
import { findAiTask, taskSlotList } from '../../lib/ai-tasks/ai-task-library'
import {
  addTaskFromPrompt,
  taskNameFromPrompt,
} from '../../lib/ai-tasks/custom-prompt'
import { createTaskExecution } from '../../lib/ai-tasks/task-execution'
import {
  type TaskApprovalRequest,
  type TaskRunState,
  createTaskRunner,
} from '../../lib/ai-tasks/task-runner'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { clientLogger } from '../../lib/logger'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { AiTaskMenuParams } from '../../lib/modals/menu-modal-params'
import { type ActionItem, useActionMenuStore } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useLlmStore } from '../../stores/llm'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickDismissStore } from '../../stores/quick-dismiss'
import { useToolsStore } from '../../stores/tools'
import { useWindowStore } from '../../stores/window'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import AiTaskProgress from './AiTaskProgress.vue'
import AiTaskResult from './AiTaskResult.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import type { AiTaskConfig } from '@tyco/shared'

const props = withDefaults(defineProps<AiTaskMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  taskId: undefined,
})

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const toolsStore = useToolsStore()
const llmStore = useLlmStore()
const historyStore = useHistoryStore()
const actionMenuStore = useActionMenuStore()
const windowStore = useWindowStore()
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

type ViewMode =
  'tasks' | 'custom-prompt' | 'manual-input' | 'running' | 'result'
const currentMode = ref<ViewMode>('tasks')

const prompt = ref('')
const manualInputText = ref('')
const selectedTask = ref<AiTaskConfig | null>(null)
const currentTask = ref<AiTaskConfig | null>(null)
const inputText = ref('')
const resultText = ref('')
const wasFocusGuardTriggered = ref(false)
const wasInsertFailed = ref(false)

/** A toast shows the start of a long answer; the history keeps all of it */
const NOTIFY_TOAST_MAX_CHARS = 280

const initialRunState = (): TaskRunState => ({
  status: 'running',
  reasoning: '',
  text: '',
  toolCalls: [],
})
const taskRunState = ref<TaskRunState>(initialRunState())

// a running task or its result must not go away with a click elsewhere
const quickDismissStore = useQuickDismissStore()
let releaseDismissHold: (() => void) | null = null
watch(currentMode, (mode) => {
  const keeps = mode === 'running' || mode === 'result'
  if (keeps && !releaseDismissHold)
    releaseDismissHold = quickDismissStore.hold()
  else if (!keeps) {
    releaseDismissHold?.()
    releaseDismissHold = null
  }
})

let abortController: AbortController | null = null
let pendingApprovalResolver: ((approved: boolean) => void) | null = null

const isQuickWindow = isInQuickWindow()

const requestApproval = async (
  _request: TaskApprovalRequest,
  signal: AbortSignal
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    pendingApprovalResolver = resolve
    signal.addEventListener(
      'abort',
      () => {
        resolve(false)
        pendingApprovalResolver = null
      },
      { once: true }
    )
  })
}

function handleApprovalDecision(approved: boolean) {
  pendingApprovalResolver?.(approved)
  pendingApprovalResolver = null
}

const runner = createTaskRunner({
  stream: (task, promptObj, options) =>
    llmStore.client.stream(task, promptObj, options),
  getTool: (toolId) => toolsStore.get(toolId),
  canInsertIntoTarget: () => desktopStore.canInsertIntoWindow,
  requestApproval,
})

const taskExecution = createTaskExecution({
  run: (task, text, options) => runner.run(task, text, options),
  history: historyStore,
  getInsert: () => {
    const insertAction = actionMenuStore
      .getDefaultActions()
      .find((action) => action.id === 'insertIntoWindow')
    return insertAction && desktopStore.canInsertIntoWindow
      ? insertAction.action
      : undefined
  },
  onHistoryError: (error) =>
    clientLogger.error('AI task history write failed', error, 'history'),
})

const layoutTitle = computed(() => {
  if (currentMode.value === 'manual-input' && selectedTask.value) {
    return selectedTask.value.name || t('menu.aiTask')
  }
  return t('menu.aiTask')
})

const displayPreviewText = computed(() => {
  if (currentMode.value === 'manual-input') {
    return manualInputText.value
  }
  return props.text
})

const customPromptAction: ActionItem = {
  labelKey: 'menu.aiCustomPrompt',
  icon: 'mdi:pencil-outline',
  action: async () => {
    prompt.value = ''
    currentMode.value = 'custom-prompt'
  },
}

function handleEsc() {
  if (
    currentMode.value === 'custom-prompt' ||
    currentMode.value === 'manual-input'
  ) {
    currentMode.value = 'tasks'
    return
  }
}

function cancelTask() {
  abortController?.abort()
  pendingApprovalResolver?.(false)
  pendingApprovalResolver = null
  currentMode.value = 'tasks'
}

function closeResult() {
  currentMode.value = 'tasks'
}

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  taskSlotList(desktopStore.userConfig?.aiTasks).map((item) =>
    item && item.name
      ? { name: item.name, action: () => onTaskSelect(item.id) }
      : undefined
  )
)

async function onTaskSelect(taskId: string) {
  const task = findAiTask(desktopStore.userConfig?.aiTasks.items, taskId)
  if (!task || !task.prompt.trim()) {
    toastKey('menu.aiTaskPromptEmpty', 'warn')
    return
  }
  await startTask(task)
}

/** Runs on the given text, or asks for one when nothing was selected */
async function startTask(task: AiTaskConfig) {
  if (props.text.trim()) {
    await executeTask(task, props.text)
  } else {
    selectedTask.value = task
    manualInputText.value = ''
    currentMode.value = 'manual-input'
  }
}

useMenuStartup({
  getValue: () => props.taskId,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) {
      menuModalsStore.updateStep(stepId, MenuModals.AI_TASK, {
        taskId: undefined,
      })
    }
  },
  run: async (taskId) => {
    const task = findAiTask(desktopStore.userConfig?.aiTasks.items, taskId)
    if (task) await startTask(task)
  },
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
    action: () => submitCustomPrompt({ ctrl: false }),
  },
  ...(isQuickWindow || !desktopStore.userConfig.isInDevelopment
    ? []
    : [
        {
          keys: ['Ctrl', 'Enter'],
          label: t('action.askInChat'),
          disabled: !prompt.value.trim(),
          action: () => submitCustomPrompt({ ctrl: true }),
        },
      ]),
  {
    keys: ['Ctrl', 'S'],
    label: t('menu.aiPromptSave'),
    disabled: !prompt.value.trim(),
    action: savePromptAsTask,
  },
  {
    keys: ['Esc'],
    label: t('common.back'),
    action: () => (currentMode.value = 'tasks'),
  },
])

const manualInputHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('menu.aiPromptRun'),
    disabled: !manualInputText.value.trim(),
    action: submitManualInput,
  },
  {
    keys: ['Esc'],
    label: t('common.back'),
    action: () => (currentMode.value = 'tasks'),
  },
])

const rememberPrompt = (value: string) => {
  void desktopStore.patchSessionState({
    recentAiPrompts: pushRecent(recentPrompts.value, value),
  })
}

async function submitManualInput() {
  const text = manualInputText.value.trim()
  if (!text || !selectedTask.value) return
  await executeTask(selectedTask.value, text)
}

async function submitCustomPrompt({ option, ctrl }: QueryPanelSubmit) {
  const value = (option?.label ?? prompt.value).trim()
  if (!value) return

  rememberPrompt(value)

  if (ctrl && !isQuickWindow && desktopStore.userConfig.isInDevelopment) {
    menuModalsStore.closeAll()
    await chatStore.attachToChat(props.text)
    chatInputStore.setValue(value)
    await chatStore.sendInput()
    return
  }

  const customTask: AiTaskConfig = {
    id: 'custom-prompt',
    name: taskNameFromPrompt(value),
    prompt: value,
    allowedTools: [],
    outputAction: 'replace',
    maxSteps: 5,
  }

  await startTask(customTask)
}

async function savePromptAsTask() {
  const value = prompt.value.trim()
  const userConfig = desktopStore.userConfig
  if (!value || !userConfig) return

  const library = addTaskFromPrompt(userConfig.aiTasks, value)
  if (!library) {
    toastKey('menu.aiPromptSlotsFull', 'warn')
    return
  }

  const result = await desktopStore.updateUserConfig({ aiTasks: library })
  if (!result.success) toastKey('toast.desktopCommandFailed', 'error')
}

async function executeTask(task: AiTaskConfig, textToProcess: string) {
  if (!textToProcess.trim()) {
    toastKey('toast.noTextToProcess', 'warn')
    return
  }

  currentTask.value = task
  inputText.value = textToProcess.trim()
  taskRunState.value = initialRunState()
  currentMode.value = 'running'
  const controller = new AbortController()
  abortController = controller

  const outcome = await taskExecution.execute(task, textToProcess, {
    signal: controller.signal,
    onUpdate: (state) => {
      taskRunState.value = state
    },
  })
  // cancelled or replaced meanwhile: this run no longer owns the menu
  if (abortController !== controller || controller.signal.aborted) return
  abortController = null

  switch (outcome.kind) {
    case 'inserted':
      await hideQuickWindow()
      return
    case 'notified':
      toastText(notifyText(outcome.content), 'success')
      await hideQuickWindow()
      return
    case 'show':
      resultText.value = outcome.content
      wasFocusGuardTriggered.value = outcome.wasFocusGuardTriggered
      wasInsertFailed.value = outcome.wasInsertFailed === true
      currentMode.value = 'result'
      return
    case 'failed':
      clientLogger.error('AI task failed', outcome.error, 'ai-tasks')
      toastKey('toast.desktopCommandFailed', 'error')
      currentMode.value = 'tasks'
      return
    default:
      currentMode.value = 'tasks'
  }
}

function notifyText(content: string): string {
  const text = content.trim()
  if (!text) return t('selection.done')
  return text.length > NOTIFY_TOAST_MAX_CHARS
    ? `${text.slice(0, NOTIFY_TOAST_MAX_CHARS).trimEnd()}…`
    : text
}

// the next activation remounts the menu: an old run must not insert there
onUnmounted(() => {
  abortController?.abort()
  abortController = null
  pendingApprovalResolver?.(false)
  pendingApprovalResolver = null
  releaseDismissHold?.()
  releaseDismissHold = null
})

async function hideQuickWindow() {
  if (isQuickWindow) await windowStore.hide()
}
</script>

<style scoped>
.ai-task-menu-running {
  width: 100%;
}
</style>
