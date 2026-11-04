<template>
  <ActionOverlayLayout :title="t('action.quickAiRequest')" :on-esc="handleEsc">
    <template #header-extra>
      <div class="quick-profile-picker">
        <label class="quick-profile-label">
          <AppIcon
            icon="mdi:account-outline"
            size="sm"
            class="quick-profile-icon"
          />
          <FieldSelect
            size="sm"
            :model-value="model.profileId.value ?? ''"
            :disabled="model.isProfileLocked.value"
            :options="profileSelectOptions"
            :title="
              model.isProfileLocked.value
                ? t('quickAiRequest.profileLocked')
                : t('quickAiRequest.selectProfile')
            "
            @update:model-value="onProfileSelect"
          />
        </label>
      </div>
    </template>

    <template #preview>
      <TextPreview v-if="props.text" :text="props.text" />

      <!-- Voice recording waveform and live transcript -->
      <div v-if="isListening" class="voice-transcription-box">
        <AudioWaveform
          :level="audioLevel"
          :peak="audioPeak"
          :duration-ms="recordingDurationMs"
          :is-transcribing="isFinishingVoice"
        />
        <LiveTranscript
          :committed="liveTranscript.committed"
          :draft="liveTranscript.draft"
        />
      </div>

      <!-- Feed of multi-turn interactions -->
      <div v-if="model.turns.value.length > 0" class="turns-feed">
        <div v-for="turn in model.turns.value" :key="turn.id" class="turn-item">
          <!-- User Prompt -->
          <div class="turn-user-message">
            <span class="turn-prompt-icon">
              <AppIcon
                :icon="
                  turn.inputKind === 'voice' ? 'mdi:microphone' : 'mdi:account'
                "
                size="sm"
              />
            </span>
            <span class="turn-prompt-text">{{ turn.prompt }}</span>
          </div>

          <!-- Assistant Response -->
          <div class="turn-assistant-message">
            <!-- Text Response -->
            <div v-if="turn.textResponse" class="turn-text-response">
              {{ turn.textResponse }}
            </div>

            <!-- Reply Blocks (propose_replies tool) -->
            <div v-if="turn.replyBlocks.length > 0" class="reply-blocks-list">
              <ReplyBlock
                v-for="(block, bIndex) in turn.replyBlocks"
                :key="bIndex"
                :block="block"
                :source-text="props.text"
                @insert-window="model.applyReplyBlock(block, 'window')"
                @insert-editor="model.applyReplyBlock(block, 'editor')"
                @copy="model.applyReplyBlock(block, 'copy')"
              />
            </div>

            <!-- Other tool calls (e.g. awaiting approval) -->
            <div v-if="turn.parts.length > 0" class="turn-parts">
              <template v-for="(part, pIndex) in turn.parts" :key="pIndex">
                <ChatToolCall
                  v-if="
                    part.type === 'tool-call' &&
                    part.toolName !== REPLY_BLOCKS_TOOL_NAME
                  "
                  :call="part"
                  @decide="model.answerToolApproval(part.approvalId!, $event)"
                />
              </template>
            </div>

            <!-- Generating indicator -->
            <div v-if="turn.status === 'generating'" class="turn-generating">
              <span class="spinner" />
              <span>{{ t('common.inProgress') }}</span>
            </div>

            <!-- Turn error -->
            <div v-if="turn.status === 'error'" class="turn-error">
              <AppIcon icon="mdi:alert-circle-outline" size="sm" />
              <span>{{ turn.error }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Config or Model Error banner -->
      <div
        v-if="model.error.value && model.turns.value.length === 0"
        class="quick-error-banner"
      >
        <AppIcon icon="mdi:alert-circle-outline" size="md" />
        <span class="quick-error-text">{{ model.error.value }}</span>
        <button type="button" class="quick-error-link" @click="goToSettings">
          {{ t('chat.configureModels') }}
        </button>
      </div>
    </template>

    <template #actions>
      <QueryPanel
        v-model="prompt"
        :disabled="
          props.shortcutsDisabled ||
          Boolean(menuModalsStore.pendingModal) ||
          model.isGenerating.value
        "
        :placeholder="t('menu.aiPromptPlaceholder')"
        :options="recentOptions"
        :hints="promptHints"
        @submit="handleQuerySubmit"
        @back="handleEsc"
      >
        <template #after-input>
          <IconButton
            :icon="isListening ? 'mdi:stop' : 'mdi:microphone'"
            size="md"
            class="mic-action-btn"
            :class="{ 'is-listening': isListening }"
            :label="isListening ? t('chat.stop') : t('chat.voiceInput')"
            :title="isListening ? t('chat.stop') : t('chat.voiceInput')"
            @click="toggleVoice"
          />
        </template>
      </QueryPanel>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { useDictationActions } from '../../composables/use-dictation-actions'
import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import useToast from '../../composables/use-toast'
import { useVoiceFinishSignal } from '../../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../../composables/use-voice-recording-meter'
import { createDesktopChatTools } from '../../lib/chat-tools/desktop-chat-tools'
import { resolveProfileInstructions } from '../../lib/chat/chat-profile-runtime'
import { invokeDesktop } from '../../lib/desktop/invoke'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { resultOrThrow } from '../../lib/ipc/ipc-model'
import { clientLogger } from '../../lib/logger'
import { filterOptions } from '../../lib/menu-query/menu-query'
import type { QuickAiRequestMenuParams } from '../../lib/modals/menu-modal-params'
import {
  type QuickAiRequestModel,
  createQuickAiRequestModel,
} from '../../lib/quick-ai-request/quick-ai-request-model'
import { REPLY_BLOCKS_TOOL_NAME } from '../../lib/reply-blocks/reply-blocks-tool'
import { describeDictationError } from '../../lib/stt/dictation-error'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useToolsStore } from '../../stores/tools'
import ChatToolCall from '../chat/ChatToolCall.vue'
import ReplyBlock from '../chat/ReplyBlock.vue'
import AppIcon from '../common/AppIcon.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import AudioWaveform from '../voice/AudioWaveform.vue'
import LiveTranscript from '../voice/LiveTranscript.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import {
  APP_CONFIG,
  type AiProfile,
  type Chat,
  type ChatAttachment,
  type EditorHistoryInstruction,
  type EditorHistoryTurn,
} from '@tyco/shared'

const props = withDefaults(defineProps<QuickAiRequestMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  inputMode: 'text',
  profileId: null,
})

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()
const aiProfilesStore = useAiProfilesStore()
const dictation = useDictationActions()
const editorNavigation = useEditorNavigation()
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const { handleEsc: defaultHandleEsc } = useOverlayNav()

const isQuickWindow = isInQuickWindow()
const prompt = ref('')
const isListening = ref(false)
const isFinishingVoice = ref(false)
const liveTranscript = ref({ committed: '', draft: '' })

const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => isListening.value
)

useVoiceFinishSignal(
  () => (isQuickWindow ? 'voiceQuickAiRequest' : undefined),
  () => void finishVoice(),
  () => void finishVoice()
)

// Profile select options
const profileSelectOptions = computed(() => [
  { id: '', name: t('quickAiRequest.defaultProfile') },
  ...aiProfilesStore.profiles.map((p) => ({ id: p.id, name: p.name })),
])

function onProfileSelect(val: string | number | undefined) {
  const selected = typeof val === 'string' && val ? val : null
  model.setProfileId(selected)
}

// Model instantiation with dependencies
const model: QuickAiRequestModel = createQuickAiRequestModel({
  sourceText: props.text,
  initialInputMode: props.inputMode,
  initialProfileId: props.profileId,
  getUserConfig: () => desktopStore.userConfig,
  getAppConfig: () => APP_CONFIG,
  getAvailableTools: async (modelId: string, profile?: AiProfile) => {
    const chatTools = createDesktopChatTools({
      profileId: profile?.id ?? null,
      invoke: invokeDesktop,
      canUseTools: () => true,
      getMemoryMode: () => profile?.memoryMode,
      getChatId: () => undefined,
      getFetchMaxCharacters: () =>
        desktopStore.userConfig?.llm?.webSearch?.fetchMaxCharacters,
      warn: (msg) => clientLogger.warn(msg, 'tools'),
      commands: () => desktopStore.userConfig?.commands ?? [],
      tools: toolsStore,
      environment: toolsStore.environment,
    })
    const turnResult = await chatTools.turnTools(
      modelId,
      undefined,
      profile?.tools,
      profile?.memoryMode
    )
    return {
      tools: turnResult.tools?.tools ?? null,
      policy: turnResult.tools?.policy,
      maxStepCount: turnResult.tools?.maxStepCount,
    }
  },
  stream: (llmPrompt, options) =>
    llmStore.client.stream('quickRequest', llmPrompt, options),
  resolveProfileInstructions: (pId: string) =>
    resolveProfileInstructions(pId, {
      refreshProfile: (id) => aiProfilesStore.refreshProfile(id),
      readSoul: (id) => aiProfilesStore.readSoul(id),
      readCoreMemory: (id) => aiProfilesStore.readMemory(id, 'core.md'),
      listMemoryTopics: (id) => aiProfilesStore.listMemoryTopics(id),
      warn: (msg) => clientLogger.warn(msg, 'profile'),
    }),
  getProfile: (pId: string) => aiProfilesStore.getProfile(pId),
  saveEditorHistorySession: async (entry: {
    sourceText?: string
    profileId?: string | null
    instruction: EditorHistoryInstruction
    operation: 'quickAiRequest'
    turns: EditorHistoryTurn[]
    result?: string
  }) => {
    return historyStore.saveSource(
      entry.sourceText ?? '',
      entry.operation,
      undefined,
      entry.instruction,
      entry.profileId ?? undefined,
      entry.turns
    )
  },
  updateEditorHistorySession: async (
    id: string,
    historyTurns: EditorHistoryTurn[],
    result?: string | null
  ) => {
    await historyStore.updateSession(id, historyTurns, result ?? undefined)
  },
  listRecentInstructions: (limit?: number, pId?: string | null) =>
    historyStore.listRecentInstructions(limit, pId),
  insertText: async (text: string) => {
    await ipcStore.callOrNotify('paste_into_target_and_hide', { text })
    void historyStore.saveOutput(text)
  },
  copyText: async (text: string) => {
    resultOrThrow(await ipcStore.call('copy_text', { text }), 'copy_text')
    void historyStore.saveOutput(text)
    toastKey('common.copied', 'success')
  },
  toEditor: async (text: string, src?: string) => {
    editorNavigation.toEditor(text, src)
    void historyStore.saveOutput(text)
  },
  openMainChat: async (params: {
    attachment?: ChatAttachment
    question?: string
    profileId?: string
    chatId?: string
    autoSend?: boolean
  }) => {
    await ipcStore.callOrNotify('open_main_chat', params)
  },
  saveChat: async (chat: Chat, pId?: string) => {
    resultOrThrow(
      await ipcStore.call('save_chat', { profileId: pId ?? null, chat }),
      'save_chat'
    )
  },
  createId: () => crypto.randomUUID(),
  closeOverlay: () => menuModalsStore.closeAll(),
  noModelError: () => t('llmErrors.noModel'),
  toolsUnsupportedError: () => t('llmErrors.toolsUnsupported'),
})

// Query options suggestions filtered by profile
const recentPrompts = computed(() => model.getRecentInstructions(5))
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
    disabled: !prompt.value.trim() && !isListening.value,
    action: () => handleQuerySubmit({ ctrl: false }),
  },
  {
    keys: ['Ctrl', 'Enter'],
    label: t('action.askInChat'),
    action: () => switchToChat(),
  },
  ...(props.text && !editorNavigation.isEditorPage()
    ? [
        {
          keys: ['Tab'],
          label: t('shortcuts.insertIntoEditor'),
          action: () => editorNavigation.toEditor(props.text),
        },
      ]
    : []),
])

async function startVoice() {
  if (isListening.value) return
  try {
    await dictation.startDictation({
      onText: (event) => {
        liveTranscript.value = {
          committed: event.committed,
          draft: event.draft,
        }
      },
      onError: (err) => {
        toastText(describeDictationError(err, t), 'error')
      },
    })
    isListening.value = true
  } catch (err) {
    toastText(describeError(err, t), 'error')
  }
}

async function stopVoice(): Promise<string> {
  if (!isListening.value) return ''
  isFinishingVoice.value = true
  try {
    const text = await dictation.finishDictation()
    isListening.value = false
    const spoken =
      (
        liveTranscript.value.committed +
        ' ' +
        (liveTranscript.value.draft || '')
      ).trim() || text.trim()
    liveTranscript.value = { committed: '', draft: '' }
    return spoken
  } catch (err) {
    toastText(describeError(err, t), 'error')
    return ''
  } finally {
    isFinishingVoice.value = false
    isListening.value = false
  }
}

async function toggleVoice() {
  if (isListening.value) {
    const spoken = await stopVoice()
    if (spoken) {
      prompt.value = prompt.value ? `${prompt.value} ${spoken}` : spoken
    }
  } else {
    await startVoice()
  }
}

async function finishVoice() {
  const spoken = await stopVoice()
  if (spoken) {
    prompt.value = spoken
    await model.submitPrompt(spoken, 'voice')
    prompt.value = ''
  }
}

async function handleQuerySubmit(submitEvent?: QueryPanelSubmit) {
  if (submitEvent?.ctrl) {
    await switchToChat()
    return
  }

  let textToSend = prompt.value.trim()
  let inputKind: 'text' | 'voice' = 'text'

  if (isListening.value) {
    const spoken = await stopVoice()
    if (spoken) {
      textToSend = spoken
      inputKind = 'voice'
    }
  }

  if (submitEvent?.option) {
    textToSend = submitEvent.option.label
  }

  if (!textToSend) return

  prompt.value = ''
  await model.submitPrompt(textToSend, inputKind)
}

async function switchToChat() {
  if (isListening.value) {
    await dictation.cancelDictation().catch(() => undefined)
    isListening.value = false
  }
  await model.switchToChat(prompt.value)
}

function handleEsc() {
  if (model.isGenerating.value) {
    model.stopGeneration()
    return
  }
  if (isListening.value) {
    void dictation.cancelDictation().catch(() => undefined)
    isListening.value = false
    return
  }
  defaultHandleEsc()
}

function goToSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}

onMounted(async () => {
  if (!aiProfilesStore.isLoaded) {
    void aiProfilesStore.loadAll()
  }

  if (props.inputMode === 'voice') {
    await nextTick()
    await startVoice()
  }
})

onUnmounted(() => {
  if (isListening.value) {
    void dictation.cancelDictation().catch(() => undefined)
  }
  if (model.isGenerating.value) {
    model.stopGeneration()
  }
})
</script>

<style scoped>
.quick-profile-picker {
  display: flex;
  align-items: center;
}

.quick-profile-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  cursor: pointer;
}

.quick-profile-icon {
  color: var(--color-text-subtle);
}

.voice-transcription-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.turns-feed {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-top: var(--space-sm);
  overflow-y: auto;
  max-height: 380px;
  padding-right: var(--space-xs);
}

.turn-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.turn-user-message {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-bg-subtle);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  align-self: flex-start;
}

.turn-prompt-icon {
  display: inline-flex;
  color: var(--color-primary);
}

.turn-assistant-message {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-left: var(--space-xs);
}

.turn-text-response {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  white-space: pre-wrap;
  line-height: 1.5;
}

.reply-blocks-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
}

.turn-generating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

.turn-error {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-xs);
  color: var(--color-danger);
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

.mic-action-btn.is-listening {
  color: var(--color-danger);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
  }
}
</style>
