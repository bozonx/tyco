<template>
  <div class="ai-chat">
    <div class="chat-messages">
      <div v-if="chatStore.messages.length === 0" class="chat-empty">
        <div class="chat-empty-icon">
          <Icon icon="mdi:chat-processing-outline" height="26" />
        </div>
        <div class="font-medium">{{ t('chat.emptyTitle') }}</div>
        <div class="text-sm text-muted">{{ t('chat.emptyHint') }}</div>
      </div>
      <ChatItem
        v-for="(message, index) in chatStore.messages"
        :key="`${message.role}-${index}`"
        :message="message"
      />
      <div
        v-if="chatStore.isGenerating && chatStore.loadingProgress"
        class="chat-progress"
      >
        <span class="loading loading-dots loading-sm"></span>
        {{ chatStore.loadingProgress }}
      </div>
    </div>

    <div class="chat-composer">
      <div
        v-if="attachments.length > 0 || canAttachEditorText"
        class="flex flex-row gap-1.5 flex-wrap items-center"
      >
        <span
          v-for="(attachment, index) in attachments"
          :key="index"
          class="chat-attachment"
          :title="attachment"
        >
          <Icon icon="mdi:file-document-outline" height="14" />
          <span>{{ truncate(attachment, 28) }}</span>
          <button
            type="button"
            class="chat-attachment-remove"
            @click="chatStore.removeAttachment(index)"
            :title="t('chat.removeAttachment')"
          >
            <Icon icon="mdi:close" height="14" />
          </button>
        </span>

        <Button
          v-if="canAttachEditorText"
          xs
          ghost
          icon="mdi:paperclip"
          class="chat-attach-btn"
          @click="attachEditorText"
          :title="t('chat.attachEditorTextTitle')"
        >
          {{ t('chat.attachEditorText') }}
        </Button>
      </div>

      <ChatInput :disabled="chatStore.isGenerating" />

      <div class="chat-composer-bar">
        <div class="flex items-center gap-1 min-w-0">
          <FieldSelect
            v-if="roles && roles.length > 0"
            class="chat-role-select"
            :options="roles"
            v-model:value="selectedRole"
            :title="t('chat.role')"
            :disabled="chatStore.isGenerating"
          />
        </div>
        <div class="flex items-center gap-1">
          <Button
            sm
            ghost
            square
            @click="voiceInput"
            :title="t('chat.voiceInput')"
            :disabled="chatStore.isGenerating"
          >
            <Icon icon="mdi:microphone-outline" height="18" />
          </Button>
          <Button
            sm
            ghost
            square
            @click="clearInput"
            :title="t('chat.clearInput')"
            :disabled="chatStore.isGenerating"
          >
            <Icon icon="mdi:eraser" height="18" />
          </Button>
          <Button
            v-if="!chatStore.isGenerating"
            sm
            square
            @click="sendMessage"
            :title="t('chat.sendMessage')"
          >
            <Icon icon="mdi:send" height="18" />
          </Button>
          <Button
            v-else
            sm
            square
            @click="chatStore.stopGeneration()"
            :title="t('chat.stop')"
          >
            <Icon icon="mdi:stop" height="18" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chatInput'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { truncate } from '@/lib/squidlet-lib-local'
import { Icon } from '@iconify/vue'

const chatInputStore = useChatInputStore()
const editorInputStore = useEditorInputStore()
const ipcStore = useIpcStore()
const chatStore = useChatStore()
const menuModalsStore = useMenuModalsStore()
const userConfig = computed(() => ipcStore.params?.userConfig)
const attachments = computed(() => chatStore.newChatParams?.attachments || [])
const { t } = useI18n()
const roles = computed<Array<{ id: string; name: string }>>(() =>
  (userConfig.value?.chatRoles || []).map((role: any) => ({
    id: role.name,
    name: truncate(role.name, 16),
  }))
)
const selectedRole = ref<string | undefined>(undefined)

const canAttachEditorText = computed(() => {
  const text = editorInputStore.value?.trim()
  if (!text) return false
  return !attachments.value.includes(text)
})

const attachEditorText = () => {
  const text = editorInputStore.value?.trim()
  if (text) {
    chatStore.addAttachment(text)
  }
}

watch(
  () => chatStore.newChatParams?.id,
  (newId) => {
    if (newId) {
      if (chatStore.newChatParams?.initialMessage) {
        chatInputStore.setValue(chatStore.newChatParams.initialMessage)
        // Clear it so it doesn't reappear
        chatStore.newChatParams.initialMessage = ''
      } else {
        chatInputStore.clear()
      }
    }
  }
)

watch(
  () => roles.value,
  (newRoles) => {
    if (!selectedRole.value && newRoles.length > 0) {
      selectedRole.value = newRoles[0].id
    }
  },
  { immediate: true }
)

const sendMessage = async () => {
  const msg = chatInputStore.value.trim()

  if (!msg) return

  const result = await chatStore.sendMessage(
    msg,
    attachments.value,
    (userConfig.value?.chatRoles || []).find(
      (role: any) => role.name === selectedRole.value
    )?.rule || ''
  )

  if (result) {
    chatInputStore.clear()
  }
}

const clearInput = () => {
  chatInputStore.clear()
  chatInputStore.focus()
}

const voiceInput = () => {
  menuModalsStore.nextModal(MenuModals.VOICE_RECOGNITION, {
    onCorrected: (resultText: string) => {
      chatInputStore.setValue(resultText)
      menuModalsStore.closeAll()
    },
  })
}
</script>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
  min-height: 0;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-xs) var(--space-xs) var(--space-sm);
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  margin: auto;
  padding: var(--space-3xl) var(--space-lg);
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
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.chat-progress {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.8125rem;
  color: var(--app-text-muted);
}

.chat-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.chat-composer:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
}

.chat-composer :deep(.main-input) {
  min-height: 4.5rem;
  max-height: 12rem;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  box-shadow: none;
  background: transparent;
  font-size: 0.9375rem;
}

.chat-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.chat-composer-bar :deep(.btn-ghost) {
  color: var(--app-text-muted);
}

.chat-role-select {
  width: auto;
  max-width: 12rem;
  height: 2rem;
  font-size: 0.8125rem;
  border-color: transparent;
  background-color: var(--app-hover);
}

.chat-attachment {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  height: 1.625rem;
  padding: 0 0.25rem 0 0.5rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background-color: var(--app-surface-raised);
  font-size: 0.75rem;
}

.chat-attachment-remove {
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
  color: var(--app-text-muted);
  cursor: pointer;
}

.chat-attachment-remove:hover {
  color: var(--color-error);
  background-color: var(--app-hover);
}

.chat-attach-btn {
  border: 1px dashed var(--app-border-strong);
  color: var(--app-text-muted);
}
</style>
