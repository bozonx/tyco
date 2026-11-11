<template>
  <div
    v-if="props.turns.length > 0"
    ref="scroller"
    class="turns-feed"
    @scroll="handleScroll"
  >
    <div v-for="turn in props.turns" :key="turn.id" class="turn-item">
      <div class="turn-user-message">
        <span class="turn-prompt-icon">
          <AppIcon
            :icon="
              turn.inputKind === 'voice' ? 'mdi:microphone' : 'mdi:account'
            "
            size="sm"
          />
        </span>
        <span class="turn-prompt-text selectable">{{ turn.prompt }}</span>
      </div>

      <!-- The answer, in the order the main chat shows it -->
      <div v-if="turn.answer" class="turn-assistant-message">
        <template v-for="(step, index) in stepsOf(turn.answer)" :key="index">
          <ChatMarkdown
            v-if="step.type === 'text'"
            :content="step.text"
            :streaming="
              turn.status === 'generating' &&
              index === stepsOf(turn.answer).length - 1
            "
            @copy-code="copyText"
            @content-resized="handleContentResized"
          />
          <div
            v-else-if="step.call.toolName === REPLY_BLOCKS_TOOL_NAME"
            class="reply-blocks-list"
          >
            <ReplyBlock
              v-for="(block, bIndex) in extractReplyBlocks(step.call.input)"
              :key="bIndex"
              :block="block"
              :index="bIndex"
              :original-text="props.sourceText"
              @insert="emit('applyReplyBlock', block, 'window')"
              @insert-editor="emit('applyReplyBlock', block, 'editor')"
            />
          </div>
          <ChatToolCall
            v-else
            :call="step.call"
            :result="step.result"
            :is-awaiting-answer="Boolean(pendingApproval(step.call))"
            :preview="pendingApproval(step.call)?.preview"
            @decide="emit('answerToolApproval', step.call.approvalId!, $event)"
          />
        </template>
      </div>

      <div
        v-if="turn.status === 'generating'"
        class="turn-generating"
        role="status"
      >
        <span
          class="loading loading-spinner loading-xs text-primary"
          aria-hidden="true"
        />
        <span>{{ t('chat.generating') }}</span>
      </div>
      <div v-else-if="turn.status === 'stopped'" class="turn-status">
        {{ t('chat.stopped') }}
      </div>
      <div v-else-if="turn.status === 'error'" class="turn-error">
        <AppIcon icon="mdi:alert-circle-outline" size="sm" />
        <span>{{ turn.error }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatScroll } from '../../composables/use-chat-scroll'
import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import {
  type ChatMessageStep,
  messageSteps,
} from '../../lib/chat-tools/chat-message-steps'
import type { ChatToolApprovalRequest } from '../../lib/chat-tools/chat-tool-loop'
import type { ChatToolDecision } from '../../lib/chat-tools/chat-tool-policy'
import type { QuickAiRequestTurn } from '../../lib/quick-ai-request/quick-ai-request-model'
import {
  REPLY_BLOCKS_TOOL_NAME,
  type ReplyBlockData,
  extractReplyBlocks,
} from '../../lib/reply-blocks/reply-blocks-tool'
import ChatMarkdown from '../chat/ChatMarkdown.vue'
import ChatToolCall from '../chat/ChatToolCall.vue'
import ReplyBlock from '../chat/ReplyBlock.vue'
import AppIcon from '../common/AppIcon.vue'
import type { ChatMessage, ChatMessagePart } from '@tyco/shared'

/** The questions of a quick request and their answers, as they stream in */
const props = withDefaults(
  defineProps<{
    turns: QuickAiRequestTurn[]
    /** The selection the reply blocks may replace */
    sourceText?: string
    /** The tool calls that wait for the user's answer now, by approval */
    pendingApprovals?: ReadonlyMap<string, ChatToolApprovalRequest>
  }>(),
  { sourceText: '', pendingApprovals: undefined }
)

const emit = defineEmits<{
  applyReplyBlock: [block: ReplyBlockData, target: 'window' | 'editor']
  answerToolApproval: [approvalId: string, decision: ChatToolDecision]
}>()

const { t } = useI18n()
const { copy: copyText } = useCopyValue()

/** The answer's text and tool calls in order; a plain answer is one text */
const stepsOf = (answer: ChatMessage): ChatMessageStep[] =>
  messageSteps(answer) ??
  (answer.content ? [{ type: 'text', text: answer.content }] : [])

const pendingApproval = (
  call: Extract<ChatMessagePart, { type: 'tool-call' }>
) =>
  call.state === 'awaiting-approval' && call.approvalId
    ? props.pendingApprovals?.get(call.approvalId)
    : undefined

// the feed follows the answer while the user has not scrolled up
const { scroller, handleScroll, handleContentResized } = useChatScroll({
  getChatId: () => undefined,
  getStreamRevision: () => {
    const answer = props.turns.at(-1)?.answer
    return [props.turns.length, answer?.content.length, answer?.parts?.length]
  },
  clearInput: () => {},
})
</script>

<style scoped>
.turns-feed {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-top: var(--space-sm);
  overflow-y: auto;
  overscroll-behavior: contain;
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
  align-items: flex-start;
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
  margin-top: 0.125rem;
  color: var(--color-primary);
}

.turn-prompt-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.turn-assistant-message {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-left: var(--space-xs);
}

.turn-status {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
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
</style>
