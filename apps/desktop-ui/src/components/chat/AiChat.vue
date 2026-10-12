<template>
  <div class="ai-chat">
    <div ref="scroller" class="chat-messages" @scroll="handleScroll">
      <div class="chat-column">
        <UiState
          v-if="chatStore.messages.length === 0"
          class="chat-empty"
          :title="t('chat.emptyTitle')"
          :message="emptyHint"
          icon="mdi:creation-outline"
        />

        <ChatItem
          v-for="(message, index) in chatStore.messages"
          :key="messageKey(message)"
          :message="message"
          :streaming="
            chatStore.isGenerating && index === chatStore.messages.length - 1
          "
          @branch="branch(index)"
          @copy-markdown-to-point="copyMarkdownToPoint(index)"
          @content-resized="handleContentResized"
        />

        <div
          v-if="chatStore.isGenerating && !streamHasContent"
          class="typing-indicator"
          role="status"
          :aria-label="t('chat.generating')"
        >
          <span /><span /><span />
        </div>
        <div v-else-if="chatStore.isGenerating" class="stream-cursor" />

        <UiState
          v-if="chatStore.isStopped && !chatStore.error"
          class="chat-error"
          kind="info"
          inline
          :message="t('chat.stopped')"
        >
          <Button size="xs" variant="ghost" icon="mdi:reload" @click="retry">{{
            t('chat.retry')
          }}</Button>
        </UiState>
        <UiState
          v-if="chatStore.error"
          class="chat-error"
          kind="error"
          inline
          :message="chatStore.error"
          icon="mdi:alert-circle-outline"
        >
          <Button size="xs" variant="ghost" icon="mdi:reload" @click="retry">{{
            t('chat.retry')
          }}</Button>
        </UiState>
      </div>
    </div>

    <IconButton
      v-if="showScrollButton"
      class="scroll-to-bottom"
      :title="t('chat.scrollToBottom')"
      @click="scrollToBottom('smooth')"
      :label="t('chat.scrollToBottom')"
      icon="mdi:arrow-down"
    />

    <!-- files arrive through the native drag-and-drop event of the webview -->
    <div class="composer-wrap" :class="{ 'is-dragging': draggingFiles }">
      <div v-if="draggingFiles" class="drop-hint" role="status">
        <Icon icon="mdi:paperclip" height="16" class="shrink-0" />
        {{ t('chat.dropFiles') }}
      </div>
      <VoiceRecognitionMenu
        v-if="isInlineVoice"
        variant="bar"
        chat
        v-bind="menuModalsStore.currentModalParams"
        @cancelled="menuModalsStore.closeAll()"
        @corrected="menuModalsStore.closeAll()"
      />
      <div v-else-if="!chatStore.selectedModel" class="chat-no-models">
        <Icon icon="mdi:key-alert-outline" height="18" class="shrink-0" />
        <span>{{ t('chat.noModelsHint') }}</span>
        <Button size="xs" icon="mdi:cog-outline" @click="openModelSettings">
          {{ t('chat.configureModels') }}
        </Button>
      </div>
      <div v-else class="chat-composer">
        <ChatContextList />

        <div
          v-if="chatStore.importingImages"
          class="text-sm text-muted"
          role="status"
        >
          {{ t('chat.fileProcessing') }}
        </div>
        <div
          v-if="chatStore.imageModelRequired"
          class="text-sm text-error"
          role="alert"
        >
          {{ t('chat.imageModelRequired') }}
        </div>
        <Button
          v-if="
            !chatStore.omitHistoryImages &&
            !chatStore.pendingImages.length &&
            chatStore.messages.some((message) => message.images?.length)
          "
          xs
          ghost
          @click="chatStore.omitHistoryImages = true"
        >
          {{ t('chat.continueWithoutImages') }}
        </Button>
        <div
          v-if="chatStore.omitHistoryImages"
          class="text-sm text-muted"
          role="status"
        >
          {{ t('chat.historyImagesOmitted') }}
          <Button
            size="xs"
            variant="ghost"
            @click="chatStore.omitHistoryImages = false"
            >{{ t('chat.restoreHistoryImages') }}</Button
          >
        </div>
        <div
          v-if="chatStore.trimmedTurns"
          class="text-sm text-muted"
          role="status"
        >
          {{ t('chat.historyTrimmed', { count: chatStore.trimmedTurns }) }}
        </div>
        <div
          v-if="
            chatStore.newChatParams.attachments?.some(
              (item) =>
                item.mediaType === 'application/pdf' ||
                item.mediaType?.includes('wordprocessingml')
            )
          "
          class="text-sm text-muted"
        >
          {{ t('chat.documentTextHint') }}
        </div>
        <ChatInput @send="sendMessage" />
        <input
          ref="filePicker"
          type="file"
          multiple
          class="hidden"
          @change="pickFiles"
        />

        <div class="chat-composer-bar">
          <IconButton
            size="sm"
            variant="ghost"
            :disabled="
              chatStore.isGenerating || Boolean(chatStore.importingImages)
            "
            :title="t('chat.addFile')"
            @click="filePicker?.click()"
            :label="t('chat.addFile')"
            icon="mdi:paperclip"
          />
          <DropdownMenu
            xs
            class="model-picker"
            icon="mdi:creation-outline"
            placement="top"
            :label="chatStore.selectedModel.name"
            :title="t('chat.selectModel')"
            :items="modelMenuItems"
          />
          <span class="composer-hint">{{ inputHint }}</span>
          <div class="composer-actions">
            <IconButton
              size="sm"
              variant="ghost"
              :title="t('chat.voiceInput')"
              @click="voiceInput"
              :label="t('chat.voiceInput')"
              icon="mdi:microphone-outline"
            />
            <IconButton
              v-if="!chatStore.isGenerating"
              size="sm"
              :disabled="!canSend"
              :title="t('chat.sendMessage')"
              @click="sendMessage"
              :label="t('chat.sendMessage')"
              icon="mdi:arrow-up"
            />
            <IconButton
              v-else
              size="sm"
              :title="t('chat.stop')"
              @click="chatStore.stopGeneration()"
              :label="t('chat.stop')"
              icon="mdi:stop"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  watch,
} from 'vue'

import { useChatVoiceInput } from '../../composables/use-chat-voice-input'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { formatChatToMarkdown } from '../../lib/chat/chat-export'
import { getDesktopWebview as getCurrentWebview } from '../../lib/desktop/window'
import {
  newlineShortcut,
  resolveSubmitKey,
  submitShortcut,
} from '../../lib/input-keys/input-keys'
import { appNavigation } from '../../lib/navigation/navigation'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import type { DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import UiState from '../common/UiState.vue'
import VoiceRecognitionMenu from '../menu/VoiceRecognitionMenu.vue'
import ChatContextList from './ChatContextList.vue'
import { Icon } from '@iconify/vue'
import type { ChatMessage } from '@tyco/shared'

const chatInputStore = useChatInputStore()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()
const { toast } = useToast()
const { openChatVoiceInput } = useChatVoiceInput()
const { t } = useI18n()

const isInlineVoice = computed(
  () =>
    menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION &&
    Boolean(menuModalsStore.currentModalParams?.inline)
)

const inputHint = computed(() => {
  const submitKey = resolveSubmitKey(ipcStore.params?.userConfig?.submitKey)
  return t('chat.inputHint', {
    send: submitShortcut(submitKey),
    newline: newlineShortcut(submitKey),
  })
})
const scroller = ref<HTMLElement | null>(null)
const pinnedToBottom = ref(true)
const showScrollButton = ref(false)
const filePicker = ref<HTMLInputElement | null>(null)
function pickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void chatStore.addFiles(Array.from(input.files || []))
  input.value = ''
}
const canSend = computed(
  () =>
    (Boolean(chatInputStore.value.trim()) ||
      chatStore.pendingImages.length > 0 ||
      chatStore.attachedContext.length > 0) &&
    !chatStore.importingImages &&
    !chatStore.imageModelRequired &&
    !chatStore.isGenerating &&
    chatStore.contextBudget?.level !== 'over'
)
const emptyHint = computed(() =>
  chatStore.attachedContext.length > 0
    ? t('chat.emptyHintWithContext')
    : t('chat.emptyHint')
)
const streamHasContent = computed(() => {
  const last = chatStore.messages.at(-1)
  return last?.role === 'assistant' && Boolean(last.content)
})

const modelMenuItems = computed<DropdownMenuItem[]>(() => [
  ...chatStore.modelOptions.map((option) => ({
    label: `${option.name} · ${option.provider}${option.vision ? ` · ${t('settings.vision')}` : ''}`,
    icon: option.id === chatStore.selectedModel?.id ? 'mdi:check' : undefined,
    action: () => chatStore.selectModel(option.id),
  })),
  {
    label: t('chat.configureModels'),
    icon: 'mdi:cog-outline',
    action: openModelSettings,
  },
])

// messages have no ids of their own; the object is the identity
const messageKeys = new WeakMap<ChatMessage, number>()
let nextMessageKey = 0
function messageKey(message: ChatMessage) {
  const raw = toRaw(message)
  let key = messageKeys.get(raw)
  if (key === undefined) {
    key = nextMessageKey++
    messageKeys.set(raw, key)
  }
  return key
}

function openModelSettings() {
  void appNavigation.goToConfig('llm')
}

async function sendMessage() {
  if (!canSend.value) return
  pinnedToBottom.value = true
  await chatStore.sendInput()
}

async function retry() {
  const draft = chatInputStore.value
  const chatId = chatStore.newChatParams.id
  const result = await chatStore.retryLastTurn()
  if (
    result &&
    chatStore.newChatParams.id === chatId &&
    chatInputStore.value === draft
  )
    chatInputStore.clear()
}

async function branch(index: number) {
  pinnedToBottom.value = true
  if (await chatStore.branchChat(index)) toast('chat.branchCreated', 'info')
}

async function copyMarkdownToPoint(index: number) {
  const slice = chatStore.messages.slice(0, index + 1)
  const title = chatStore.newChatParams.title || ''
  const md = formatChatToMarkdown(slice, title ? { title } : undefined)
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    toast('editor.menu.clipboardUnavailable', 'error')
    return
  }
  toast('chat.markdownCopied', 'info')
}

function voiceInput() {
  openChatVoiceInput({ quickSend: false })
}

function handleScroll() {
  const element = scroller.value
  if (!element) return
  const distance =
    element.scrollHeight - element.scrollTop - element.clientHeight
  pinnedToBottom.value = distance < 80
  showScrollButton.value = distance > 160
}

function handleContentResized() {
  if (pinnedToBottom.value) void scrollToBottom()
}

// Follows the stream instantly: a smooth scroll restarted on every chunk
// can stop at a fractional offset, and WebKitGTK then shows blurry text
async function scrollToBottom(behavior: 'instant' | 'smooth' = 'instant') {
  await nextTick()
  const element = scroller.value
  if (!element) return
  const top = Math.max(0, element.scrollHeight - element.clientHeight)
  element.scrollTo({ top: Math.round(top), behavior })
}

const draggingFiles = ref(false)
let unlistenDrop: (() => void) | undefined
let disposed = false
onBeforeUnmount(() => {
  disposed = true
  unlistenDrop?.()
})
onMounted(() => {
  void getCurrentWebview()
    .onDragDropEvent(async ({ payload }) => {
      draggingFiles.value = payload.type === 'enter' || payload.type === 'over'
      if (payload.type !== 'drop') return
      if (!disposed) await chatStore.addDroppedFiles(payload.paths)
    })
    .then((unlisten) => {
      if (disposed) unlisten()
      else unlistenDrop = unlisten
    })
    .catch(() => undefined)
  // keys may have been added or removed while the chat was not shown
  // on failure the list stays as it was with the keys known before
  llmStore.refreshSecrets().catch(() => undefined)
})

watch(
  // the stream only grows the last message: no need to read every one
  () => [chatStore.messages.length, chatStore.messages.at(-1)?.content.length],
  () => {
    if (pinnedToBottom.value) void scrollToBottom()
  }
)

watch(
  () => chatStore.newChatParams?.id,
  () => {
    chatInputStore.clear()
    pinnedToBottom.value = true
    void scrollToBottom()
  }
)
</script>

<style scoped>
.ai-chat {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.chat-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  width: min(100%, 52rem);
  min-height: 100%;
  margin: 0 auto;
  padding: var(--space-2xl) var(--space-lg);
}
.typing-indicator {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--app-text-muted);
}
.typing-indicator > span {
  width: 0.38rem;
  height: 0.38rem;
  border-radius: 50%;
  background: currentColor;
  animation: chat-pulse 1.2s infinite ease-in-out;
}
.typing-indicator > span:nth-child(2) {
  animation-delay: 150ms;
}
.typing-indicator > span:nth-child(3) {
  animation-delay: 300ms;
}
.stream-cursor {
  width: 0.45rem;
  height: 1rem;
  margin-top: -2.55rem;
  background: var(--color-primary);
  animation: chat-blink 1s step-end infinite;
}
.chat-error span {
  flex: 1;
}
.composer-wrap {
  position: relative;
  width: min(100%, 52rem);
  margin: 0 auto;
  padding: var(--space-sm) var(--space-lg) var(--space-md);
}
.composer-wrap.is-dragging .chat-composer {
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}
.drop-hint {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: var(--space-xs);
  color: var(--color-primary);
  font-size: 0.8rem;
}
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--app-border);
  border-radius: 1rem;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-md);
}
.chat-composer:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow: var(--app-focus-ring);
}
.chat-composer-bar,
.composer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.chat-composer-bar {
  justify-content: space-between;
}
.model-picker {
  min-width: 0;
}
.model-picker :deep(.dropdown-trigger) {
  max-width: 16rem;
  color: var(--app-text-muted);
  font-weight: 500;
}
.composer-actions {
  flex-shrink: 0;
}
/* shown only while typing, in the space the bar has anyway */
.composer-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--app-text-faint);
  font-size: 0.68rem;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 150ms ease;
}
.chat-composer:focus-within .composer-hint {
  opacity: 1;
}
.chat-no-models {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px dashed var(--app-border);
  border-radius: 1rem;
  color: var(--app-text-muted);
  font-size: var(--text-control);
}
.chat-no-models span {
  flex: 1;
}
.scroll-to-bottom {
  position: absolute;
  right: max(var(--space-xl), calc((100% - 52rem) / 2));
  bottom: 7rem;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--app-border);
  border-radius: 50%;
  background: var(--app-surface);
  box-shadow: var(--app-shadow-md);
  cursor: pointer;
}
@keyframes chat-pulse {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
@keyframes chat-blink {
  50% {
    opacity: 0;
  }
}
@media (max-width: 640px) {
  .chat-column,
  .composer-wrap {
    padding-right: var(--space-md);
    padding-left: var(--space-md);
  }
  .composer-hint {
    visibility: hidden;
  }
}
@media (prefers-reduced-motion: reduce) {
  .typing-indicator > span,
  .stream-cursor {
    animation: none;
  }
}
</style>
