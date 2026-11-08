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
        v-model="prompt"
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
import { createDesktopChatTools } from '../../lib/chat-tools/desktop-chat-tools'
import {
  isChatHistoryEnabled,
  isQuickRequestSavingEnabled,
} from '../../lib/chat/chat-history-settings'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { chatModelOptions } from '../../lib/chat/chat-llm-selection'
import { resolveProfileInstructions } from '../../lib/chat/chat-profile-runtime'
import { type TextRange, insertAtCursor } from '../../lib/chat/insert-at-cursor'
import { invokeDesktop } from '../../lib/desktop/invoke'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { resultOrThrow } from '../../lib/ipc/ipc-model'
import { LlmError } from '../../lib/llm/llm-client'
import {
  normalizeLlmConfig,
  withPickedTaskModel,
} from '../../lib/llm/llm-config'
import { formatLlmError } from '../../lib/llm/llm-errors'
import { clientLogger } from '../../lib/logger'
import { filterOptions } from '../../lib/menu-query/menu-query'
import type { QuickAiRequestMenuParams } from '../../lib/modals/menu-modal-params'
import { isSecretUsable } from '../../lib/net/secrets'
import {
  type QuickAiRequestModel,
  createQuickAiRequestModel,
} from '../../lib/quick-ai-request/quick-ai-request-model'
import { createQuickAiRequestSession } from '../../lib/quick-ai-request/quick-ai-request-session'
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
import {
  APP_CONFIG,
  type AiProfile,
  type Chat,
  llmSecretId,
} from '@tyco/shared'

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
const prompt = ref(props.prompt)
const isCapturing = ref(false)
const queryPanelRef = ref<InstanceType<typeof QueryPanel>>()
let disposed = false
const isListening = ref(props.inputMode === 'voice')
const lastInputKind = ref<'text' | 'voice'>(
  props.inputMode === 'voice' ? 'voice' : 'text'
)
const rememberedSelection = ref<TextRange | null>(null)
const voiceRange = ref({ start: 0, end: 0, prefix: '', suffix: '' })

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

/**
 * The conversation of the request: its chat id, kept when it moves to the full
 * chat, and its tools, so that a call allowed "for this session" stays allowed
 * for the follow-up questions
 */
const session = createQuickAiRequestSession({
  createId: () => crypto.randomUUID(),
  createTools: ({
    chatId,
    profileId: pId,
    profile,
  }: {
    chatId: string
    profileId: string | null
    profile?: AiProfile
  }) =>
    createDesktopChatTools({
      profileId: pId,
      invoke: invokeDesktop,
      canUseTools: () => true,
      getMemoryMode: () => profile?.memoryMode,
      getChatId: () => chatId,
      getFetchMaxCharacters: () =>
        desktopStore.userConfig?.llm?.webSearch?.fetchMaxCharacters,
      warn: (msg) => clientLogger.warn(msg, 'tools'),
      commands: () => desktopStore.userConfig?.commands ?? [],
      tools: toolsStore,
      environment: toolsStore.environment,
    }),
})

// Model instantiation with dependencies
const profileOf = (pId: string | null) =>
  pId ? aiProfilesStore.getProfile(pId) : undefined

const model: QuickAiRequestModel = createQuickAiRequestModel({
  context: props.screenshotMode
    ? { kind: 'screenshot', image: props.screenshot, images: props.screenshots }
    : { kind: 'selection', text: props.text },
  initialInputMode: props.inputMode,
  initialProfileId: props.profileId,
  getModelOptions: () =>
    chatModelOptions(normalizeLlmConfig(desktopStore.userConfig?.llm), (id) =>
      isSecretUsable(secretsStore.secrets, llmSecretId(id))
    ),
  getRememberedModelId: (pId) =>
    (pId ? aiProfilesStore.getProfile(pId)?.quickRequestModelId : undefined) ||
    desktopStore.userConfig?.llm?.tasks?.quickRequest?.modelId ||
    undefined,
  rememberModelId: async (pId, modelId) => {
    if (pId) {
      try {
        await aiProfilesStore.updateProfile(pId, {
          quickRequestModelId: modelId,
        })
      } catch (error) {
        toastText(describeError(error, t), 'error')
      }
      return
    }
    const response = await saveQuickRequestTaskModel(modelId)
    if (!response.success) toastText(describeError(response.error, t), 'error')
  },
  getRules: () => desktopStore.userConfig?.llm?.tasks?.quickRequest?.rule,
  resolveInstructions: async (pId) =>
    [
      APP_CONFIG.aiInstructions.quickRequest,
      pId
        ? await resolveProfileInstructions(pId, {
            refreshProfile: (id) => aiProfilesStore.refreshProfile(id),
            readSoul: (id) => aiProfilesStore.readSoul(id),
            readCoreMemory: (id) => aiProfilesStore.readMemory(id, 'core.md'),
            listMemoryTopics: (id) => aiProfilesStore.listMemoryTopics(id),
            warn: (msg) => clientLogger.warn(msg, 'profile'),
          })
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  mayOfferTools: (pId) => {
    const profile = profileOf(pId)
    return session
      .toolsFor(pId, profile)
      .mayOfferTools({
        canUseTools: true,
        settings: profile?.tools,
        memoryMode: profile?.memoryMode,
      })
  },
  sendTurn: async (
    message,
    prevMessages,
    { profileId: pId, instructions, toolOutputBudgetCharacters, ...options }
  ) => {
    const profile = profileOf(pId)
    const turn = await session
      .toolsFor(pId, profile)
      .turnTools(
        options.modelId,
        toolOutputBudgetCharacters,
        profile?.tools,
        profile?.memoryMode
      )
    return llmStore.actions.sendChatMessage(
      message,
      prevMessages,
      instructions,
      {
        ...options,
        ...turn,
        task: 'quickRequest',
        rules: desktopStore.userConfig?.llm?.tasks?.quickRequest?.rule,
        temperature: profile?.temperature,
        maxOutputTokens: profile?.maxOutputTokens,
        loadImage: getChatImage,
      }
    )
  },
  answerToolApproval: (approvalId, decision) =>
    session.currentTools()?.answerApproval(approvalId, decision),
  cancelToolApprovals: () => session.currentTools()?.dispose(),
  insertText: async (text: string) => {
    await ipcStore.callOrNotify('paste_into_target_and_hide', { text })
    void historyStore.saveOutput(text, 'quickAiRequest')
  },
  copyText: async (text: string) => {
    resultOrThrow(await ipcStore.call('copy_text', { text }), 'copy_text')
    void historyStore.saveOutput(text, 'quickAiRequest')
    toastKey('common.copied', 'success')
  },
  toEditor: async (text: string, src?: string) => {
    editorNavigation.toEditor(text, src)
    void historyStore.saveOutput(text, 'quickAiRequest')
  },
  openMainChat: async (params) => {
    resultOrThrow(
      await ipcStore.callOrNotify('open_main_chat', params),
      'open_main_chat'
    )
  },
  transferChat: async ({ chat, question, profileId: pId }) => {
    resultOrThrow(
      await ipcStore.call('open_transferred_chat', {
        transfer: { chat, question: question ?? null, profileId: pId ?? null },
      }),
      'open_transferred_chat'
    )
  },
  saveChat: async (chat: Chat, pId) => {
    resultOrThrow(
      await ipcStore.call('save_chat', { profileId: pId, chat }),
      'save_chat'
    )
  },
  renameChat: async (chatId, title, pId) => {
    resultOrThrow(
      await ipcStore.call('rename_chat', { id: chatId, title, profileId: pId }),
      'rename_chat'
    )
  },
  generateChatTitle: (question, answer, modelId, signal) =>
    llmStore.actions.generateChatTitle(question, answer, modelId, signal),
  isHistoryEnabled: (pId) => isChatHistoryEnabled(desktopStore.userConfig, pId),
  isQuickRequestSavingEnabled: (pId) =>
    isQuickRequestSavingEnabled(desktopStore.userConfig, pId),
  createId: () => crypto.randomUUID(),
  chatId: session.chatId,
  closeOverlay: () => menuModalsStore.closeAll(),
  noModelError: () => t('quickAiRequest.noModel'),
  toolsRequiredError: () => t('llmErrors.toolsRequired'),
  imageModelError: () => t('chat.imageModelRequired'),
  messageTooLongError: () => t('llmErrors.contextLength'),
  emptyResponseError: () => t('selection.emptyResult'),
  imageTitle: () => t('chat.imageTitle'),
  imageOmittedText: () => t('chat.imageOmitted'),
  formatError: (error) =>
    error instanceof LlmError
      ? formatLlmError(error, t)
      : describeError(error, t),
})

/** "Ask AI" keeps its quick request model in the task settings */
function saveQuickRequestTaskModel(modelId: string) {
  return desktopStore.updateUserConfig({
    llm: withPickedTaskModel(
      desktopStore.userConfig.llm,
      'quickRequest',
      modelId
    ),
  })
}

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

watch(
  () => props.screenshots,
  (images) => {
    if (images) model.setSourceImages(images)
  }
)

watch(
  () => props.screenshot,
  (image) => {
    if (image && !model.sourceImages.value.some((img) => img.id === image.id)) {
      model.addSourceImage(image)
    }
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
    Boolean(prompt.value.trim()) &&
    !isInputBlocked.value &&
    !model.isGenerating.value
)

// Query options suggestions filtered by profile
const recentPrompts = ref<string[]>([])
async function loadRecentPrompts(pId: string | null) {
  try {
    const res = await ipcStore.call('list_recent_quick_request_prompts', {
      profileId: pId ?? null,
      limit: 5,
    })
    if (res.success && Array.isArray(res.result)) {
      recentPrompts.value = res.result
      return
    }
  } catch {
    // fall back to empty
  }
  recentPrompts.value = []
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
    prompt.value
  ).filter((option) => option.label !== prompt.value.trim())
)

// Hints
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
    disabled: model.isGenerating.value,
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
  const input = event.target as HTMLInputElement | null
  if (!input) return
  rememberedSelection.value = {
    start: input.selectionStart ?? prompt.value.length,
    end: input.selectionEnd ?? prompt.value.length,
  }
}

function captureVoiceRange() {
  const raw = queryPanelRef.value?.getSelection() ??
    rememberedSelection.value ?? {
      start: prompt.value.length,
      end: prompt.value.length,
    }
  const start = Math.max(0, Math.min(raw.start, prompt.value.length))
  const end = Math.max(start, Math.min(raw.end, prompt.value.length))
  voiceRange.value = {
    start,
    end,
    prefix: prompt.value.slice(0, start),
    suffix: prompt.value.slice(end),
  }
}

function startVoice() {
  if (
    isListening.value ||
    isCapturing.value ||
    model.isGenerating.value ||
    disposed
  )
    return
  captureVoiceRange()
  isListening.value = true
}

function handleVoiceCancelled() {
  isListening.value = false
  void nextTick(() => queryPanelRef.value?.focus())
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

  let caret = voiceRange.value.end
  if (resultText.trim()) {
    const inserted = insertAtCursor(
      prompt.value,
      { start: voiceRange.value.start, end: voiceRange.value.end },
      resultText
    )
    prompt.value = inserted.value
    caret = inserted.caret
    rememberedSelection.value = { start: caret, end: caret }
    lastInputKind.value = 'voice'
  }

  if (intent === 'submit') {
    const textToSend = prompt.value.trim()
    if (textToSend) {
      await model.submitPrompt(textToSend, 'voice', clearPrompt)
      return
    }
  }

  await nextTick()
  if (!disposed) {
    queryPanelRef.value?.focus()
    queryPanelRef.value?.select(caret, caret)
  }
}

async function handleQuerySubmit(submitEvent?: QueryPanelSubmit) {
  if (submitEvent?.ctrl) {
    await switchToChat()
    return
  }

  let textToSend = prompt.value.trim()
  let inputKind: 'text' | 'voice' = lastInputKind.value

  if (submitEvent?.option) {
    textToSend = submitEvent.option.label
    inputKind = 'text'
  }

  if (!textToSend) return

  prompt.value = textToSend
  await model.submitPrompt(textToSend, inputKind, clearPrompt)
}

/** The question moved to the feed: the input is ready for the next one */
function clearPrompt() {
  prompt.value = ''
  rememberedSelection.value = null
  lastInputKind.value = 'text'
}

async function switchToChat() {
  // like its button: the answer is not cut off by moving on
  if (model.isGenerating.value) return
  isListening.value = false
  try {
    await model.switchToChat(prompt.value)
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
 * The disabled prompt loses focus while the answer comes, so Esc reaches only
 * the window: it stops the answer there
 */
function handleGeneratingEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.shiftKey || event.isComposing) return
  if (!model.isGenerating.value || menuModalsStore.pendingModal) return
  event.preventDefault()
  model.stopGeneration()
}

function goToSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}

onMounted(async () => {
  window.addEventListener('keydown', handleGeneratingEsc)
  // The models of a provider show up only when its key is known to be set;
  // the quick window has not read the keys yet, or they changed since then.
  await secretsStore.refreshSecrets().catch(() => undefined)
  if (props.isPromptSent && prompt.value.trim() && !disposed) {
    await handleQuerySubmit()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGeneratingEsc)
  disposed = true
  if (model.isGenerating.value) {
    model.stopGeneration()
  }
  session.dispose()
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
