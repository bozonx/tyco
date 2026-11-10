<template>
  <article class="chat-item" :class="`is-${message.role}`">
    <div class="chat-item-content">
      <div v-if="message.attachments?.length" class="message-attachments">
        <ChatAttachment
          v-for="(attachment, index) in message.attachments"
          :key="index"
          :text="attachment.text"
          :source="attachment.source"
          :name="attachment.name"
          :media-type="attachment.mediaType"
          :file="attachment.file"
        />
      </div>

      <div v-if="message.images?.length" class="flex flex-wrap gap-2">
        <ChatImageAttachment
          v-for="image in message.images"
          :key="image.id"
          :image="image"
          @loaded="emit('content-resized')"
        />
      </div>
      <template v-if="message.role === 'assistant' && steps">
        <template v-for="(step, index) in steps" :key="index">
          <ChatMarkdown
            v-if="step.type === 'text'"
            :content="step.text"
            :streaming="streaming && index === steps.length - 1"
            @copy-code="copyText"
            @content-resized="emit('content-resized')"
          />
          <div
            v-else-if="
              step.call.toolName === REPLY_BLOCKS_TOOL_NAME &&
              replyBlocksOf(step.call.input).length > 0
            "
            class="reply-blocks-container"
          >
            <div class="reply-blocks-label">
              <AppIcon icon="mdi:text-box-plus-outline" size="sm" />
              <span>{{ t('chatTools.replyBlocks.toolLabel') }}</span>
            </div>
            <ReplyBlock
              v-for="(block, bIndex) in replyBlocksOf(step.call.input)"
              :key="bIndex"
              :block="block"
              :index="bIndex"
              @insert="emit('insert-reply-block', $event)"
              @insert-editor="emit('insert-editor-reply-block', $event)"
            />
          </div>
          <ChatToolCall
            v-else
            :call="step.call"
            :result="step.result"
            :is-awaiting-answer="Boolean(pendingApproval(step.call))"
            :preview="pendingApproval(step.call)?.preview"
            @decide="emit('tool-approval', step.call.approvalId!, $event)"
          />
        </template>
      </template>
      <ChatMarkdown
        v-else-if="message.role === 'assistant'"
        :content="message.content"
        :streaming="streaming"
        @copy-code="copyText"
        @content-resized="emit('content-resized')"
      />
      <div v-else-if="message.content" class="chat-item-bubble selectable">
        {{ message.content }}
      </div>

      <div v-if="hasMessageActions" class="message-actions">
        <span v-if="message.status === 'stopped'" class="message-status">
          {{ t('chat.stopped') }}
        </span>
        <IconButton
          v-if="isReplyBlocksOnly && canRegenerate"
          class="message-action"
          @click="emit('regenerate')"
          :label="t('chat.regenerate')"
          icon="mdi:reload"
        />
        <template v-else-if="!isReplyBlocksOnly">
          <IconButton
            v-if="message.content"
            class="message-action"
            @click="copyMessage"
            :label="isCopied() ? t('common.copied') : t('chat.copy')"
            :icon="isCopied() ? 'mdi:check' : 'mdi:content-copy'"
          />
          <DropdownMenu
            size="xs"
            square
            hide-chevron
            placement="top"
            align="right"
            icon="mdi:dots-horizontal"
            :title="t('common.more')"
            :items="moreMenuItems"
          />
        </template>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import { messageSteps } from '../../lib/chat-tools/chat-message-steps'
import type { ChatToolApprovalRequest } from '../../lib/chat-tools/chat-tool-loop'
import type { ChatToolDecision } from '../../lib/chat-tools/chat-tool-policy'
import {
  REPLY_BLOCKS_TOOL_NAME,
  extractReplyBlocks,
} from '../../lib/reply-blocks/reply-blocks-tool'
import AppIcon from '../common/AppIcon.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import ChatAttachment from './ChatAttachment.vue'
import ChatImageAttachment from './ChatImageAttachment.vue'
import ChatMarkdown from './ChatMarkdown.vue'
import ChatToolCall from './ChatToolCall.vue'
import ReplyBlock from './ReplyBlock.vue'
import type { ChatMessage, ChatMessagePart } from '@tyco/shared'

const props = defineProps<{
  message: ChatMessage
  streaming?: boolean
  canRegenerate?: boolean
  /** The tool calls that wait for the user's answer now, by approval */
  pendingApprovals?: ReadonlyMap<string, ChatToolApprovalRequest>
}>()
const emit = defineEmits<{
  (e: 'branch'): void
  (e: 'regenerate'): void
  (e: 'copy-markdown-to-point'): void
  (e: 'content-resized'): void
  (e: 'tool-approval', approvalId: string, decision: ChatToolDecision): void
  (e: 'insert-reply-block', text: string): void
  (e: 'insert-editor-reply-block', text: string): void
}>()

/** The request a call of the answer waits on, if it waits now */
const pendingApproval = (
  call: Extract<ChatMessagePart, { type: 'tool-call' }>
) =>
  call.state === 'awaiting-approval' && call.approvalId
    ? props.pendingApprovals?.get(call.approvalId)
    : undefined

/** The answer's text and tool calls in order; null for a plain answer */
const steps = computed(() => messageSteps(props.message))
const replyBlocksOf = (input: unknown) => extractReplyBlocks(input)

/** True when the assistant answer consists solely of insertion reply blocks */
const isReplyBlocksOnly = computed(() => {
  if (props.message.role !== 'assistant') return false
  if (props.message.content.trim() || props.message.images?.length) return false
  if (!steps.value?.length) return false
  return steps.value.every(
    (step) =>
      step.type === 'tool' &&
      step.call.toolName === REPLY_BLOCKS_TOOL_NAME &&
      replyBlocksOf(step.call.input).length > 0
  )
})

const hasMessageActions = computed(() => {
  if (isReplyBlocksOnly.value) {
    return props.message.status === 'stopped' || Boolean(props.canRegenerate)
  }
  return Boolean(
    props.message.content || props.message.images?.length || steps.value
  )
})

const { t } = useI18n()
const { copy: copyText, isCopied } = useCopyValue()

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  ...(props.message.role === 'assistant' && props.canRegenerate
    ? [
        {
          label: t('chat.regenerate'),
          icon: 'mdi:reload',
          action: () => emit('regenerate'),
        },
      ]
    : []),
  {
    label: t('chat.copyMarkdownToPoint'),
    icon: 'mdi:language-markdown',
    action: () => emit('copy-markdown-to-point'),
  },
  {
    label: t('chat.branchChat'),
    icon: 'mdi:source-branch',
    action: () => emit('branch'),
  },
])
function copyMessage() {
  void copyText(props.message.content)
}
</script>

<style scoped>
.chat-item {
  display: flex;
  width: 100%;
}
.chat-item-content {
  min-width: 0;
  max-width: min(86%, 46rem);
}
.chat-item.is-user {
  justify-content: flex-end;
}
.chat-item.is-assistant .chat-item-content {
  width: 100%;
}
.chat-item-bubble {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm)
    var(--radius-lg);
  background-color: var(--color-primary);
  color: var(--color-primary-content);
  font-size: var(--text-title);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.message-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-xs);
  min-height: 1.7rem;
  margin-top: var(--space-xs);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.message-status {
  align-self: center;
  margin-right: auto;
  color: var(--app-text-faint);
  font-size: var(--text-caption);
}
.chat-item-content:hover .message-actions,
.message-actions:focus-within {
  opacity: 1;
}
.message-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: pointer;
}
.message-action:hover {
  background: var(--app-hover);
}
.message-action:disabled {
  opacity: 0.45;
  cursor: default;
}
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}
.reply-blocks-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
  margin-bottom: var(--space-xs);
}
.reply-blocks-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--app-text-faint);
  font-size: var(--text-caption);
  font-weight: 500;
}
@media (hover: none) {
  .message-actions {
    opacity: 1;
  }
}
</style>
