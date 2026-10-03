<template>
  <div class="ai-chat">
    <header class="chat-header">
      <div class="min-w-0 flex flex-col gap-0.5">
        <h1 class="chat-title">{{ chatTitle }}</h1>
        <div class="chat-model-selector flex items-center">
          <DropdownMenu
            xs
            icon="mdi:creation-outline"
            :label="currentModelLabel"
            :title="t('chat.selectModel')"
            :items="modelMenuItems"
          />
        </div>
      </div>
      <Button
        v-if="chatStore.messages.length"
        xs
        ghost
        icon="mdi:plus"
        @click="chatStore.startChat({})"
      >
        {{ t('chat.newChat') }}
      </Button>
    </header>

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
          :key="`${message.role}-${index}`"
          :message="message"
          :generating="chatStore.isGenerating"
          @regenerate="regenerate(index)"
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
      <div class="chat-composer">
        <div v-if="attachments.length" class="attachment-list">
          <span
            v-for="(attachment, index) in attachments"
            :key="index"
            class="chat-attachment"
            :title="attachment"
          >
            <Icon icon="mdi:file-document-outline" height="14" />
            <span>{{ t('chat.editorContext') }}</span>
            <button
              type="button"
              class="chat-attachment-remove"
              :title="t('chat.removeAttachment')"
              @click="chatStore.removeAttachment(index)"
            >
              <Icon icon="mdi:close" height="14" />
            </button>
          </span>
        </div>

        <ChatInput @send="sendMessage" />

        <div class="chat-composer-bar">
          <div class="composer-tools">
            <DropdownMenu
              v-if="aiTaskMenuItems.length"
              icon="mdi:robot-outline"
              square
              hide-chevron
              placement="top"
              :title="t('action.aiTask')"
              :items="aiTaskMenuItems"
            />
            <Button
              sm
              ghost
              square
              icon="mdi:paperclip"
              :title="t('chat.attachEditorTextTitle')"
              :disabled="!canAttachEditorText"
              @click="attachEditorText"
            />
            <Button
              sm
              ghost
              square
              :title="t('chat.voiceInput')"
              @click="voiceInput"
            >
              <Icon icon="mdi:microphone-outline" height="18" />
            </Button>
          </div>
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
      <p class="composer-hint">{{ inputHint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useChatVoiceInput } from '../composables/useChatVoiceInput'
import { useI18n } from '../composables/useI18n'
import {
  newlineShortcut,
  resolveSubmitKey,
  submitShortcut,
} from '../lib/input-keys/input-keys'
import { usableModels } from '../lib/llm/llm-catalog'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { AI_TASKS } from '../types'
import type { DropdownMenuItem } from './common/DropdownMenu.vue'
import { Icon } from '@iconify/vue'

const chatInputStore = useChatInputStore()
const editorInputStore = useEditorInputStore()
const ipcStore = useIpcStore()
const chatStore = useChatStore()
const { openChatVoiceInput } = useChatVoiceInput()
const { t } = useI18n()

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
const userConfig = computed(() => ipcStore.params?.userConfig)
const attachments = computed(() => chatStore.newChatParams?.attachments || [])
const canSend = computed(
  () => Boolean(chatInputStore.value.trim()) && !chatStore.isGenerating
)
const chatTitle = computed(
  () => chatStore.newChatParams.initialMessage || t('chat.newChat')
)
const streamHasContent = computed(() => {
  const last = chatStore.messages.at(-1)
  return last?.role === 'assistant' && Boolean(last.content)
})
const selectedModel = computed(() => {
  const llm = userConfig.value?.llm
  if (!llm) return null
  const modelId = llm.tasks?.[AI_TASKS.CHAT]?.[0]
  if (modelId) {
    const found = llm.models?.find((m) => m.id === modelId)
    if (found) {
      const provider = llm.providers?.find((p) => p.id === found.provider)
      return { model: found, provider }
    }
  }
  const usable = usableModels(llm)
  return usable[0] ?? null
})

const currentModelLabel = computed(() => {
  if (chatStore.isGenerating && chatStore.activeModel) {
    return chatStore.activeModel
  }
  if (!userConfig.value?.llm) return t('chat.noModels')
  if (selectedModel.value) {
    const { model, provider } = selectedModel.value
    const providerName = provider?.name || provider?.type || provider?.id || ''
    const modelName = model.name || model.model
    return providerName ? `${modelName} (${providerName})` : modelName
  }
  return t('chat.selectModel')
})

const modelMenuItems = computed<DropdownMenuItem[]>(() => {
  const llm = userConfig.value?.llm
  if (!llm) return []
  const usable = usableModels(llm)
  if (usable.length === 0) {
    return [{ label: t('chat.noModels'), action: () => {} }]
  }
  const currentId = selectedModel.value?.model.id
  return usable.map(({ model, provider }) => {
    const providerName = provider.name || provider.type || provider.id
    const modelName = model.name || model.model
    const isSelected = model.id === currentId
    return {
      label: `${modelName} (${providerName})`,
      icon: isSelected ? 'mdi:check' : undefined,
      action: () => selectChatModel(model.id),
    }
  })
})

const aiTaskMenuItems = computed<DropdownMenuItem[]>(() => {
  const tasks = userConfig.value?.aiTasks || []
  return tasks
    .filter((task): task is NonNullable<typeof task> & { rule: string } =>
      Boolean(task?.rule?.trim())
    )
    .map((task) => ({
      label: task.name?.trim() || task.rule.trim(),
      action: () => {
        const currentText = chatInputStore.value
        const separator = currentText && !/\s$/.test(currentText) ? ' ' : ''
        chatInputStore.setValue(`${currentText}${separator}${task.rule}`)
        chatInputStore.focus()
      },
    }))
})

async function selectChatModel(modelId: string) {
  if (!userConfig.value?.llm) return
  chatStore.activeModel = ''
  const currentTasks = userConfig.value.llm.tasks || {}
  const currentChain = currentTasks[AI_TASKS.CHAT] || []
  const newChain = [modelId, ...currentChain.filter((id) => id !== modelId)]
  const updatedConfig = {
    ...userConfig.value,
    llm: {
      ...userConfig.value.llm,
      tasks: { ...currentTasks, [AI_TASKS.CHAT]: newChain },
    },
  }
  await ipcStore.saveUserConfig(updatedConfig)
}

function attachEditorText() {
  const text = editorInputStore.value?.trim()
  if (text) chatStore.addAttachment(text)
}

const canAttachEditorText = computed(() => {
  const text = editorInputStore.value?.trim()
  return Boolean(text && !attachments.value.includes(text))
})

async function sendMessage() {
  if (!canSend.value) return
  pinnedToBottom.value = true
  await chatStore.sendInput()
}

async function retry() {
  const result = await chatStore.retryLastTurn()
  if (result) chatInputStore.clear()
}

async function regenerate(index: number) {
  if (
    index < chatStore.messages.length - 1 &&
    !window.confirm(t('chat.regenerateConfirm'))
  ) {
    return
  }
  pinnedToBottom.value = true
  await chatStore.regenerateMessage(index)
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

watch(
  () => chatStore.messages.map((message) => message.content).join('\u0000'),
  () => {
    if (pinnedToBottom.value) void scrollToBottom()
  }
)

watch(
  () => chatStore.newChatParams?.id,
  () => {
    if (
      chatStore.messages.length === 0 &&
      chatStore.newChatParams.initialMessage
    ) {
      chatInputStore.setValue(chatStore.newChatParams.initialMessage)
    } else {
      chatInputStore.clear()
    }
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
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 3.5rem;
  padding: 0 var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
}
.chat-title {
  max-width: 32rem;
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-model {
  margin-top: 0.1rem;
  color: var(--app-text-faint);
  font-size: 0.68rem;
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
.composer-tools,
.attachment-list {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.chat-composer-bar {
  justify-content: space-between;
}
.attachment-list {
  flex-wrap: wrap;
}
.chat-attachment {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.25rem 0.2rem 0.5rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  font-size: 0.72rem;
}
.chat-attachment-remove {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
}
.chat-attachment-remove:hover {
  background: var(--app-hover);
  color: var(--color-error);
}
.composer-hint {
  margin-top: var(--space-xs);
  color: var(--app-text-faint);
  font-size: 0.68rem;
  text-align: center;
}
.scroll-to-bottom {
  position: absolute;
  right: max(var(--space-xl), calc((100% - 52rem) / 2));
  bottom: 7.5rem;
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
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .typing-indicator > span,
  .stream-cursor {
    animation: none;
  }
}
</style>
