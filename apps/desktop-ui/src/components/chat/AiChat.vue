<template>
  <div ref="dropZoneRef" class="ai-chat">
    <ChatResponseAnnouncer
      :chat-id="chatStore.currentChatParams.id"
      :is-generating="chatStore.isGenerating"
      :message="chatStore.messages.at(-1)"
    />
    <div ref="scroller" class="chat-messages" @scroll="handleScroll">
      <div class="chat-column">
        <StateMessage
          v-if="chatStore.messages.length === 0"
          class="chat-empty"
          :title="t('chat.emptyTitle')"
          :message="emptyHint"
          icon="mdi:creation-outline"
        />

        <ChatMessageItem
          v-for="(message, index) in chatStore.messages"
          :key="messageKey(message)"
          :message="message"
          :can-regenerate="!chatStore.isGenerating"
          :pending-approvals="pendingApprovals"
          :streaming="
            chatStore.isGenerating && index === chatStore.messages.length - 1
          "
          @branch="branch(index)"
          @regenerate="regenerate(index)"
          @copy-markdown-to-point="copyMarkdownToPoint(index)"
          @content-resized="handleContentResized"
          @tool-approval="chatStore.answerToolApproval"
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

        <InlineNotice
          v-if="chatStore.isCoreClipped"
          class="chat-memory-clipped"
          kind="warning"
          icon="mdi:brain"
          :message="t('chat.coreMemoryClippedWarning')"
        >
          <Button
            v-if="chatStore.profileId"
            size="xs"
            variant="ghost"
            icon="mdi:cog-outline"
            @click="openProfileMemorySettings"
          >
            {{ t('chat.profileSettings') }}
          </Button>
        </InlineNotice>

        <InlineNotice
          v-if="chatStore.isStopped && !chatStore.error"
          class="chat-error"
          kind="info"
          announcement="polite"
          :message="t('chat.stopped')"
        >
          <Button size="xs" variant="ghost" icon="mdi:reload" @click="retry">{{
            t('chat.retry')
          }}</Button>
        </InlineNotice>
        <InlineNotice
          v-if="chatStore.error"
          class="chat-error"
          kind="error"
          announcement="assertive"
          :message="chatStore.error"
          icon="mdi:alert-circle-outline"
        >
          <Button size="xs" variant="ghost" icon="mdi:reload" @click="retry">{{
            t('chat.retry')
          }}</Button>
        </InlineNotice>
      </div>
    </div>

    <IconButton
      v-if="showScrollButton"
      class="scroll-to-bottom"
      @click="scrollToBottom('smooth')"
      :label="t('chat.scrollToBottom')"
      icon="mdi:arrow-down"
    />

    <!-- files dropped anywhere on the chat arrive through the native
      drag-and-drop event of the webview -->
    <div class="composer-wrap" :class="{ 'is-dragging': draggingFiles }">
      <div v-if="draggingFiles" class="drop-hint" role="status">
        <AppIcon icon="mdi:paperclip" size="md" class="shrink-0" />
        {{ t('chat.dropFiles') }}
      </div>
      <VoiceRecognitionMenu
        v-if="isInlineVoice"
        variant="bar"
        chat
        v-bind="voiceParams"
        @cancelled="menuModalsStore.closeAll()"
        @corrected="menuModalsStore.closeAll()"
      />
      <InlineNotice
        v-else-if="!chatStore.selectedModel"
        class="chat-no-models"
        icon="mdi:key-alert-outline"
        :message="t('chat.noModelsHint')"
      >
        <Button size="xs" icon="mdi:cog-outline" @click="openModelSettings">
          {{ t('chat.configureModels') }}
        </Button>
      </InlineNotice>
      <ChatComposer
        v-else
        :can-send="canSend"
        :dragging-files="draggingFiles"
        @send="sendMessage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, toRaw } from 'vue'

import { useChatFileDrop } from '../../composables/use-chat-file-drop'
import { useChatScope } from '../../composables/use-chat-scope'
import { useChatScroll } from '../../composables/use-chat-scroll'
import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import { useInlineVoiceStep } from '../../composables/use-inline-voice-step'
import useToast from '../../composables/use-toast'
import { formatChatToMarkdown } from '../../lib/chat/chat-export'
import { appNavigation } from '../../navigation'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useSecretsStore } from '../../stores/secrets'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import VoiceRecognitionMenu from '../menu/VoiceRecognitionMenu.vue'
import ChatComposer from './ChatComposer.vue'
import ChatMessageItem from './ChatMessageItem.vue'
import ChatResponseAnnouncer from './ChatResponseAnnouncer.vue'
import type { ChatMessage } from '@tyco/shared'

const { chat: chatStore, input: chatInputStore } = useChatScope()
const secretsStore = useSecretsStore()
const menuModalsStore = useMenuModalsStore()
const { toastKey } = useToast()
const copyValue = useCopyValue()
const { t } = useI18n()

const { voiceParams, isInlineVoice } = useInlineVoiceStep()

const {
  scroller,
  pinnedToBottom,
  showScrollButton,
  handleScroll,
  handleContentResized,
  scrollToBottom,
} = useChatScroll({
  getChatId: () => chatStore.currentChatParams?.id,
  getStreamRevision: () => [
    chatStore.messages.length,
    chatStore.messages.at(-1)?.content.length,
    chatStore.messages.at(-1)?.parts?.length,
  ],
  clearInput: chatInputStore.clear,
})
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
  return (
    last?.role === 'assistant' &&
    (Boolean(last.content) || Boolean(last.parts?.length))
  )
})
const pendingApprovals = computed(
  () =>
    new Map(
      chatStore.pendingToolApprovals.map((request) => [
        request.approvalId,
        request,
      ])
    )
)

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

function openProfileMemorySettings() {
  if (chatStore.profileId) {
    void appNavigation.goToConfig(`ai-profile:${chatStore.profileId}`)
  }
}

async function sendMessage() {
  if (!canSend.value) return
  pinnedToBottom.value = true
  await chatStore.sendInput()
}

async function retry() {
  pinnedToBottom.value = true
  await chatStore.retryLastTurn()
}

async function regenerate(index: number) {
  pinnedToBottom.value = true
  await chatStore.regenerateMessage(index)
}

async function branch(index: number) {
  pinnedToBottom.value = true
  if (await chatStore.branchChat(index)) toastKey('chat.branchCreated', 'info')
}

async function copyMarkdownToPoint(index: number) {
  const slice = chatStore.messages.slice(0, index + 1)
  const title = chatStore.currentChatParams.title || ''
  const md = formatChatToMarkdown(slice, title ? { title } : undefined)
  if (await copyValue.copy(md)) toastKey('chat.markdownCopied', 'info')
}

const { dropZoneRef, draggingFiles } = useChatFileDrop({
  getContext: () => [
    chatStore.isGenerating,
    chatStore.selectedModel,
    isInlineVoice.value,
  ],
  // a drop during generation reaches the store, which tells why it is refused
  canAccept: () => Boolean(chatStore.selectedModel) && !isInlineVoice.value,
  accept: (paths) => chatStore.addDroppedFiles(paths),
})
onMounted(() => {
  // Keys may have changed while the chat was not shown.
  secretsStore.refreshSecrets().catch(() => undefined)
})
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
.drop-hint {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
  color: var(--color-primary);
  font-size: var(--text-control);
}
.chat-no-models {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-xl);
  color: var(--app-text-muted);
  font-size: var(--text-control);
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
}
@media (prefers-reduced-motion: reduce) {
  .typing-indicator > span,
  .stream-cursor {
    animation: none;
  }
}
</style>
