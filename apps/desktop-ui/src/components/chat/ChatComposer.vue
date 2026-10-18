<template>
  <div class="chat-composer" :class="{ 'is-dragging': draggingFiles }">
    <ChatContextList />

    <InlineNotice
      v-if="chatStore.importingImages"
      announcement="polite"
      :message="t('chat.fileProcessing')"
    />
    <InlineNotice
      v-if="chatStore.imageModelRequired"
      kind="error"
      announcement="assertive"
      :message="t('chat.imageModelRequired')"
    />
    <Button
      v-if="
        !chatStore.omitHistoryImages &&
        !chatStore.pendingImages.length &&
        chatStore.messages.some((message) => message.images?.length)
      "
      size="xs"
      variant="ghost"
      @click="chatStore.omitHistoryImages = true"
    >
      {{ t('chat.continueWithoutImages') }}
    </Button>
    <InlineNotice
      v-if="chatStore.omitHistoryImages"
      announcement="polite"
      :message="t('chat.historyImagesOmitted')"
      ><Button
        size="xs"
        variant="ghost"
        @click="chatStore.omitHistoryImages = false"
        >{{ t('chat.restoreHistoryImages') }}</Button
      ></InlineNotice
    >
    <InlineNotice
      v-if="chatStore.trimmedTurnCount"
      announcement="polite"
      :message="t('chat.historyTrimmed', { count: chatStore.trimmedTurnCount })"
    />
    <InlineNotice
      v-if="
        chatStore.currentChatParams.attachments?.some(
          (item) =>
            item.mediaType === 'application/pdf' ||
            item.mediaType?.includes('wordprocessingml')
        )
      "
      :message="t('chat.documentTextHint')"
    />
    <ChatInput @send="emit('send')" />
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
        :disabled="chatStore.isGenerating || Boolean(chatStore.importingImages)"
        @click="filePicker?.click()"
        :label="t('chat.addFile')"
        icon="mdi:paperclip"
      />
      <DropdownMenu
        size="xs"
        class="model-picker"
        tone="muted"
        max-trigger-width="16rem"
        icon="mdi:creation-outline"
        placement="top"
        :label="chatStore.selectedModel?.name"
        :title="t('chat.selectModel')"
        :items="modelMenuItems"
      />
      <span class="composer-hint">{{ inputHint }}</span>
      <div class="composer-actions">
        <IconButton
          size="sm"
          variant="ghost"
          @click="voiceInput"
          :label="t('chat.voiceInput')"
          icon="mdi:microphone-outline"
        />
        <IconButton
          v-if="!chatStore.isGenerating"
          size="sm"
          :disabled="!canSend"
          @click="emit('send')"
          :label="t('chat.sendMessage')"
          icon="mdi:arrow-up"
        />
        <IconButton
          v-else
          size="sm"
          @click="chatStore.stopGeneration()"
          :label="t('chat.stop')"
          icon="mdi:stop"
        />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'

import { useChatScope } from '../../composables/use-chat-scope'
import { useChatVoiceInput } from '../../composables/use-chat-voice-input'
import { useI18n } from '../../composables/use-i18n'
import {
  newlineShortcut,
  resolveSubmitKey,
  submitShortcut,
} from '../../lib/input-keys/input-keys'
import { appNavigation } from '../../lib/navigation/navigation'
import { useDesktopStore } from '../../stores/desktop'
import Button from '../common/Button.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import ChatContextList from './ChatContextList.vue'
import ChatInput from './ChatInput.vue'

defineProps<{ canSend: boolean; draggingFiles: boolean }>()
const emit = defineEmits<{ send: [] }>()
const { chat: chatStore } = useChatScope()
const desktopStore = useDesktopStore()
const { t } = useI18n()
const { openChatVoiceInput } = useChatVoiceInput()
function openModelSettings() {
  void appNavigation.goToConfig('llm')
}
const inputHint = computed(() => {
  const submitKey = resolveSubmitKey(desktopStore.userConfig?.submitKey)
  return t('chat.inputHint', {
    send: submitShortcut(submitKey),
    newline: newlineShortcut(submitKey),
  })
})
const filePicker = ref<HTMLInputElement | null>(null)
function pickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void chatStore.addFiles(Array.from(input.files || []))
  input.value = ''
}
const modelMenuItems = computed<DropdownMenuItem[]>(() => [
  ...chatStore.modelOptions.map((option) => ({
    label: `${option.name} · ${option.providerLabel}${option.canUseImages ? ` · ${t('settings.vision')}` : ''}`,
    icon: option.id === chatStore.selectedModel?.id ? 'mdi:check' : undefined,
    action: () => chatStore.selectModel(option.id),
  })),
  {
    label: t('chat.configureModels'),
    icon: 'mdi:cog-outline',
    action: openModelSettings,
  },
])

function voiceInput() {
  openChatVoiceInput({ finishBehavior: 'confirm' })
}
</script>
<style scoped>
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-xl);
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
.composer-actions {
  flex-shrink: 0;
}
/* shown only while typing, in the space the bar has anyway */
.composer-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--app-text-faint);
  font-size: var(--text-micro);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.chat-composer:focus-within .composer-hint {
  opacity: 1;
}

.chat-composer.is-dragging {
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}
@media (max-width: 640px) {
  .composer-hint {
    visibility: hidden;
  }
}
</style>
