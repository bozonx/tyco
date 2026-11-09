<template>
  <ActionOverlayLayout :title="t('action.quickAiRequest')" :on-esc="handleEsc">
    <template #preview>
      <ContextPreview
        v-if="props.text"
        :text="props.text"
        :disabled="model.isSourceTextDisabled.value"
        :allow-disable="!model.isSourceTextLocked.value"
        @update:disabled="(disabled) => model.setSourceTextDisabled(disabled)"
      />
      <div v-if="props.screenshotMode" class="screenshot-preview">
        <ChatImageAttachment
          v-for="img in model.sourceImages.value"
          :key="img.id"
          :image="img"
          :removable="!model.isSourceImageLocked.value && !isCapturing"
          compact
          @remove="removeScreenshot(img.id)"
        />
        <IconButton
          icon="mdi:selection-drag"
          :label="t('screenshot.addArea')"
          :title="t('screenshot.addArea')"
          :disabled="isCapturing || model.isSourceImageLocked.value"
          @click="addScreenshot"
        />
      </div>

      <QuickAiRequestTurns
        :turns="model.turns.value"
        :source-text="model.sourceText.value"
        :pending-approvals="runtime.pendingApprovals.value"
        @apply-reply-block="
          (block, target) => model.applyReplyBlock(block, target)
        "
        @answer-tool-approval="
          (approvalId, decision) =>
            model.answerToolApproval(approvalId, decision)
        "
      />

      <!-- Model problems are told at once; request errors after a send -->
      <div v-if="bannerText" class="quick-error-banner" role="alert">
        <AppIcon icon="mdi:alert-circle-outline" size="md" />
        <span class="quick-error-text">{{ bannerText }}</span>
        <button type="button" class="quick-error-link" @click="goToSettings">
          {{ t('chat.configureModels') }}
        </button>
      </div>
    </template>

    <template #actions>
      <VoiceRecognitionMenu
        v-if="isListening"
        variant="bar"
        chat
        target="chat"
        finish-behavior="confirm"
        :activation-mode="voiceActivationMode"
        :prefix="voiceRange.prefix"
        :suffix="voiceRange.suffix"
        @cancelled="handleVoiceCancelled"
        @corrected="handleVoiceCorrected"
      />
      <QueryPanel
        v-else
        ref="queryPanelRef"
        v-model="input.value.value"
        :disabled="isInputBlocked || model.isGenerating.value"
        :placeholder="promptPlaceholder"
        :options="recentOptions"
        :hints="promptHints"
        @blur="handleInputBlur"
        @submit="handleQuerySubmit"
        @back="handleEsc"
      >
        <template #after-input>
          <IconButton
            icon="mdi:microphone-outline"
            size="md"
            variant="ghost"
            class="mic-action-btn"
            :disabled="isInputBlocked || model.isGenerating.value"
            :label="t('chat.voiceInput')"
            :title="t('chat.voiceInput')"
            @click="startVoice"
          />
          <IconButton
            v-if="!model.isGenerating.value"
            icon="mdi:arrow-up"
            size="md"
            variant="primary"
            class="send-action-btn"
            :disabled="!canSend"
            :label="t('chat.sendMessage')"
            :title="t('chat.sendMessage')"
            @click="handleQuerySubmit({ ctrl: false })"
          />
          <IconButton
            v-else
            icon="mdi:stop"
            size="md"
            class="stop-action-btn"
            :label="t('chat.stop')"
            :title="t('chat.stop')"
            @click="model.stopGeneration()"
          />
        </template>
        <template #footer-end>
          <QuickAiModelBar
            :profile-id="model.profileId.value"
            :model-id="model.modelId.value"
            :models="model.modelOptions.value"
            :is-profile-locked="model.isProfileLocked.value"
            :is-model-disabled="model.isGenerating.value"
            @update:profile-id="model.setProfileId"
            @update:model-id="(id) => void model.setModelId(id)"
          />
        </template>
      </QueryPanel>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import useToast from '../../composables/use-toast'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { createChatInputModel } from '../../lib/chat/chat-input-model'
import { invokeDesktop } from '../../lib/desktop/invoke'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { clientLogger } from '../../lib/logger'
import { filterOptions } from '../../lib/menu-query/menu-query'
import type { QuickAiRequestMenuParams } from '../../lib/modals/menu-modal-params'
import { createQuickAiRequestRuntime } from '../../lib/quick-ai-request/quick-ai-request-runtime'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { useActionMenuStore } from '../../stores/action-menu'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useSecretsStore } from '../../stores/secrets'
import { useToolsStore } from '../../stores/tools'
import ChatImageAttachment from '../chat/ChatImageAttachment.vue'
import AppIcon from '../common/AppIcon.vue'
import IconButton from '../common/IconButton.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import QuickAiModelBar from './QuickAiModelBar.vue'
import QuickAiRequestTurns from './QuickAiRequestTurns.vue'
import VoiceRecognitionMenu from './VoiceRecognitionMenu.vue'

const props = withDefaults(defineProps<QuickAiRequestMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  inputMode: 'text',
  profileId: null,
  prompt: '',
  isPromptSent: false,
})

const actionMenuStore = useActionMenuStore()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()
const aiProfilesStore = useAiProfilesStore()
const secretsStore = useSecretsStore()
const editorNavigation = useEditorNavigation()
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const { handleEsc: defaultHandleEsc } = useOverlayNav()

const isQuickWindow = isInQuickWindow()
/** The prompt and its caret, kept as the main chat keeps its input */
const input = createChatInputModel()
input.setValue(props.prompt)
const isCapturing = ref(false)
const queryPanelRef = ref<InstanceType<typeof QueryPanel>>()
let disposed = false
const isListening = ref(props.inputMode === 'voice')
const lastInputKind = ref<'text' | 'voice'>(
  props.inputMode === 'voice' ? 'voice' : 'text'
)
/** What stays around the dictated text in the live preview */
const voiceRange = ref({ prefix: '', suffix: '' })

const voiceActivationMode = computed(() => {
  if (!isQuickWindow) return undefined
  const mode = desktopStore.desktopState?.mode
  if (
    mode === 'voiceQuickAiRequest' ||
    mode === 'voiceScreenshotQuickAiRequest'
  ) {
    return mode
  }
  return undefined
})

const runtime = createQuickAiRequestRuntime({
  context: props.screenshotMode
    ? { kind: 'screenshot', images: props.screenshots }
    : { kind: 'selection', text: props.text },
  initialInputMode: props.inputMode,
  initialProfileId: props.profileId,
  invoke: invokeDesktop,
  call: ipcStore.call,
  callOrNotify: ipcStore.callOrNotify,
  llmActions: llmStore.actions,
  loadImage: (id) => getChatImage(id),
  getUserConfig: () => desktopStore.userConfig,
  updateUserConfig: (patch) => desktopStore.updateUserConfig(patch),
  getSecrets: () => secretsStore.secrets,
  getProfile: (id) => aiProfilesStore.getProfile(id),
  updateProfile: (id, patch) => aiProfilesStore.updateProfile(id, patch),
  refreshProfile: (id) => aiProfilesStore.refreshProfile(id),
  readSoul: (id) => aiProfilesStore.readSoul(id),
  readMemory: (id, file) => aiProfilesStore.readMemory(id, file),
  listMemoryTopics: (id) => aiProfilesStore.listMemoryTopics(id),
  tools: toolsStore,
  environment: toolsStore.environment,
  saveOutput: (text) => void historyStore.saveOutput(text, 'quickAiRequest'),
  toEditor: (text, sourceText) => editorNavigation.toEditor(text, sourceText),
  closeOverlay: () => menuModalsStore.closeAll(),
  translate: t,
  toastError: (message) => toastText(message, 'error'),
  warn: (message, scope) => clientLogger.warn(message, scope),
  createId: () => crypto.randomUUID(),
})
const { model } = runtime

/** Tells what this request is about: the screenshot, the selection or nothing */
const promptPlaceholder = computed(() => {
  if (model.turns.value.length > 0)
    return t('quickAiRequest.placeholder.followUp')
  if (props.screenshotMode) return t('quickAiRequest.placeholder.screenshot')
  if (model.sourceText.value) return t('quickAiRequest.placeholder.selection')
  return t('quickAiRequest.placeholder.empty')
})

/** Shown at once: the user learns before asking that the model will not do */
const modelIssueText = computed(() =>
  model.modelIssue.value ? model.describeModelIssue(model.modelIssue.value) : ''
)

/** A failed turn shows its error itself, under the question */
const bannerText = computed(
  () =>
    modelIssueText.value ||
    (model.turns.value.at(-1)?.status === 'error' ? '' : model.error.value)
)

// the activation keeps the list: screenshots added or removed show up here
watch(
  () => props.screenshots,
  (images) => {
    if (images) model.setSourceImages(images)
  }
)

async function removeScreenshot(imageId: string) {
  if (model.isSourceImageLocked.value) return
  const result = await ipcStore.callOrNotify('remove_screenshot', { imageId })
  if (result.success) model.removeSourceImage(imageId)
}

async function addScreenshot() {
  if (isCapturing.value || model.isSourceImageLocked.value) return
  isCapturing.value = true
  try {
    isListening.value = false
    const result = await ipcStore.call('add_screenshot')
    if (disposed) return
    if (result.success) {
      if (result.result) model.addSourceImage(result.result)
    } else toastKey('screenshot.failed', 'error')
  } finally {
    isCapturing.value = false
    await nextTick()
    if (!disposed) queryPanelRef.value?.focus()
  }
}

/** The prompt cannot be edited or sent, the stop button stays live */
const isInputBlocked = computed(
  () =>
    isCapturing.value ||
    props.shortcutsDisabled ||
    Boolean(menuModalsStore.pendingModal)
)

const canSend = computed(
  () =>
    Boolean(input.value.value.trim()) &&
    !isInputBlocked.value &&
    !model.isGenerating.value
)

// Query options suggestions filtered by profile
const recentPrompts = ref<string[]>([])
async function loadRecentPrompts(pId: string | null) {
  const res = await ipcStore.call('list_recent_quick_request_prompts', {
    profileId: pId ?? null,
    limit: 5,
  })
  recentPrompts.value =
    res.success && Array.isArray(res.result) ? res.result : []
}

watch(
  () => model.profileId.value,
  (pId) => {
    void loadRecentPrompts(pId)
  },
  { immediate: true }
)

const recentOptions = computed<QueryPanelOption[]>(() =>
  filterOptions(
    recentPrompts.value.map((entry) => ({ id: entry, label: entry })),
    input.value.value
  ).filter((option) => option.label !== input.value.value.trim())
)

const promptHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('menu.aiPromptRun'),
    disabled: !canSend.value,
    action: () => handleQuerySubmit({ ctrl: false }),
  },
  {
    keys: ['Ctrl', 'Enter'],
    label: t('action.askInChat'),
    action: () => switchToChat(),
  },
  ...(model.sourceText.value && !editorNavigation.isEditorPage()
    ? [
        {
          keys: ['Tab'],
          label: t('shortcuts.insertIntoEditor'),
          action: () => editorNavigation.toEditor(model.sourceText.value ?? ''),
        },
      ]
    : []),
])

function handleInputBlur(event: FocusEvent) {
  const element = event.target as HTMLInputElement | null
  if (!element) return
  const length = input.value.value.length
  input.rememberSelection({
    start: element.selectionStart ?? length,
    end: element.selectionEnd ?? length,
  })
}

function startVoice() {
  if (
    isListening.value ||
    isCapturing.value ||
    model.isGenerating.value ||
    disposed
  )
    return
  const live = queryPanelRef.value?.getSelection()
  if (live) input.rememberSelection(live)
  const value = input.value.value
  const range = input.selection.value
  voiceRange.value = {
    prefix: range ? value.slice(0, range.start) : value,
    suffix: range ? value.slice(range.end) : '',
  }
  isListening.value = true
}

function focusPrompt() {
  void nextTick(() => {
    if (disposed) return
    queryPanelRef.value?.focus()
    const caret = input.takePendingCaret()
    if (caret !== null) queryPanelRef.value?.select(caret, caret)
  })
}

function handleVoiceCancelled() {
  isListening.value = false
  focusPrompt()
}

async function handleVoiceCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  isListening.value = false
  if (intent === 'copy') {
    void actionMenuStore.runDefaultAction('copyToClipboard', resultText)
    return
  }
  if (resultText.trim()) {
    input.insertText(resultText)
    lastInputKind.value = 'voice'
  }
  const textToSend = input.value.value.trim()
  if (intent === 'submit' && textToSend) {
    await model.submitPrompt(textToSend, 'voice', clearPrompt)
    return
  }
  focusPrompt()
}

async function handleQuerySubmit(submitEvent?: QueryPanelSubmit) {
  if (submitEvent?.ctrl) {
    await switchToChat()
    return
  }

  let textToSend = input.value.value.trim()
  let inputKind: 'text' | 'voice' = lastInputKind.value

  if (submitEvent?.option) {
    textToSend = submitEvent.option.label
    inputKind = 'text'
  }

  if (!textToSend) return

  input.value.value = textToSend
  await model.submitPrompt(textToSend, inputKind, clearPrompt)
}

/** The question moved to the feed: the input is ready for the next one */
function clearPrompt() {
  input.clear()
  lastInputKind.value = 'text'
}

/** Moves on to the main chat; an answer still coming stops there */
async function switchToChat() {
  isListening.value = false
  try {
    await model.switchToChat(input.value.value)
  } catch (error) {
    toastText(describeError(error, t), 'error')
  }
}

function handleEsc() {
  if (model.isGenerating.value) {
    model.stopGeneration()
    return
  }
  defaultHandleEsc()
}

/**
 * The disabled prompt loses focus while the answer comes, so the keys reach
 * only the window: Esc stops the answer there, Ctrl+Enter moves on to the chat
 */
function handleGeneratingKeys(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Enter') return
  if (event.shiftKey || event.isComposing) return
  if (!model.isGenerating.value || menuModalsStore.pendingModal) return
  if (event.key === 'Enter') {
    if (!event.ctrlKey) return
    event.preventDefault()
    void switchToChat()
    return
  }
  event.preventDefault()
  model.stopGeneration()
}

function goToSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}

onMounted(async () => {
  window.addEventListener('keydown', handleGeneratingKeys)
  // The models of a provider show up only when its key is known to be set;
  // the quick window has not read the keys yet, or they changed since then.
  await secretsStore.refreshSecrets().catch(() => undefined)
  if (props.isPromptSent && input.value.value.trim() && !disposed) {
    await handleQuerySubmit()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGeneratingKeys)
  disposed = true
  runtime.dispose()
})
</script>

<style scoped>
.screenshot-preview {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding-block: var(--space-xs);
}

.quick-error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-danger-subtle, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  color: var(--color-danger);
  margin-top: var(--space-sm);
}

.quick-error-text {
  flex: 1;
  font-size: var(--font-size-sm);
}

.quick-error-link {
  font-size: var(--font-size-sm);
  text-decoration: underline;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
</style>
