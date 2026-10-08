<template>
  <div class="ai-chat">
    <div ref="scroller" class="chat-messages" @scroll="handleScroll">
      <div class="chat-column">
        <div v-if="chatStore.messages.length === 0" class="chat-empty">
          <div class="chat-empty-icon">
            <Icon icon="mdi:creation-outline" height="26" />
          </div>
          <div class="font-medium">{{ t('chat.emptyTitle') }}</div>
          <div class="text-sm text-muted">{{ t('chat.emptyHint') }}</div>
        </div>

        <ChatItem
          v-for="(message, index) in chatStore.messages"
          :key="messageKey(message)"
          :message="message"
          :assistant-name="chatStore.selectedModel?.name"
          @branch="branch(index)"
        />

        <div
          v-if="chatStore.isGenerating && !streamHasContent"
          class="typing-indicator"
          :aria-label="t('chat.generating')"
        >
          <span /><span /><span />
        </div>
        <div v-else-if="chatStore.isGenerating" class="stream-cursor" />

        <div v-if="chatStore.error" class="chat-error" role="alert">
          <Icon icon="mdi:alert-circle-outline" height="18" />
          <span>{{ chatStore.error }}</span>
          <Button xs ghost icon="mdi:reload" @click="retry">
            {{ t('chat.retry') }}
          </Button>
        </div>
      </div>
    </div>

    <button
      v-if="showScrollButton"
      type="button"
      class="scroll-to-bottom"
      :title="t('chat.scrollToBottom')"
      @click="scrollToBottom('smooth')"
    >
      <Icon icon="mdi:arrow-down" height="18" />
    </button>

    <div class="composer-wrap">
      <VoiceRecognitionMenu
        v-if="isInlineVoice"
        variant="bar"
        v-bind="menuModalsStore.currentModalParams"
        @cancelled="menuModalsStore.closeAll()"
        @corrected="menuModalsStore.closeAll()"
      />
      <div v-else-if="!chatStore.selectedModel" class="chat-no-models">
        <Icon icon="mdi:key-alert-outline" height="18" class="shrink-0" />
        <span>{{ t('chat.noModelsHint') }}</span>
        <Button xs icon="mdi:cog-outline" @click="openModelSettings">
          {{ t('chat.configureModels') }}
        </Button>
      </div>
      <div v-else class="chat-composer">
        <ChatContextList />

        <ChatInput @send="sendMessage" />

        <div class="chat-composer-bar">
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
            <Button
              sm
              ghost
              square
              :title="t('chat.voiceInput')"
              @click="voiceInput"
            >
              <Icon icon="mdi:microphone-outline" height="18" />
            </Button>
            <Button
              v-if="!chatStore.isGenerating"
              sm
              square
              :disabled="!canSend"
              :title="t('chat.sendMessage')"
              @click="sendMessage"
            >
              <Icon icon="mdi:arrow-up" height="19" />
            </Button>
            <Button
              v-else
              sm
              square
              :title="t('chat.stop')"
              @click="chatStore.stopGeneration()"
            >
              <Icon icon="mdi:stop" height="18" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'

import { useChatVoiceInput } from '../composables/useChatVoiceInput'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import {
  newlineShortcut,
  resolveSubmitKey,
  submitShortcut,
} from '../lib/input-keys/input-keys'
import { appNavigation } from '../lib/navigation/navigation'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import ChatContextList from './chat/ChatContextList.vue'
import type { DropdownMenuItem } from './common/DropdownMenu.vue'
import VoiceRecognitionMenu from './menu/VoiceRecognitionMenu.vue'
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
const canSend = computed(
  () => Boolean(chatInputStore.value.trim()) && !chatStore.isGenerating
)
const streamHasContent = computed(() => {
  const last = chatStore.messages.at(-1)
  return last?.role === 'assistant' && Boolean(last.content)
})

const modelMenuItems = computed<DropdownMenuItem[]>(() => [
  ...chatStore.modelOptions.map((option) => ({
    label: `${option.name} · ${option.provider}`,
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
  const result = await chatStore.retryLastTurn()
  if (result) chatInputStore.clear()
}

async function branch(index: number) {
  pinnedToBottom.value = true
  await chatStore.branchChat(index)
  toast(t('chat.branchCreated'), 'info')
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

async function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior })
}

onMounted(() => {
  // keys may have been added or removed while the chat was not shown
  // on failure the list stays as it was with the keys known before
  llmStore.refreshSecrets().catch(() => undefined)
})

watch(
  () => chatStore.messages.map((message) => message.content).join('\u0000'),
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
  scroll-behavior: smooth;
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
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  margin: auto;
  padding: var(--space-3xl) 0;
  text-align: center;
}
.chat-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  margin-bottom: var(--space-sm);
  border-radius: 999px;
  background: var(--app-accent-soft);
  color: var(--color-primary);
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
.chat-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid color-mix(in oklab, var(--color-error) 35%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--color-error) 8%, transparent);
  color: var(--color-error);
  font-size: 0.8125rem;
}
.chat-error span {
  flex: 1;
}
.composer-wrap {
  width: min(100%, 52rem);
  margin: 0 auto;
  padding: var(--space-sm) var(--space-lg) var(--space-md);
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
  font-size: 0.8125rem;
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
