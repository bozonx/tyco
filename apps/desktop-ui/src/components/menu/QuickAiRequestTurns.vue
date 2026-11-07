<template>
  <div v-if="props.turns.length > 0" class="turns-feed">
    <div v-for="turn in props.turns" :key="turn.id" class="turn-item">
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
            :source-text="props.sourceText"
            @insert-window="emit('applyReplyBlock', block, 'window')"
            @insert-editor="emit('applyReplyBlock', block, 'editor')"
            @copy="emit('applyReplyBlock', block, 'copy')"
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
              @decide="emit('answerToolApproval', part.approvalId!, $event)"
            />
          </template>
        </div>

        <!-- Generating indicator -->
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

        <!-- Turn error -->
        <div v-if="turn.status === 'error'" class="turn-error">
          <AppIcon icon="mdi:alert-circle-outline" size="sm" />
          <span>{{ turn.error }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { ChatToolDecision } from '../../lib/chat-tools/chat-tool-policy'
import type { QuickAiRequestTurn } from '../../lib/quick-ai-request/quick-ai-request-model'
import {
  REPLY_BLOCKS_TOOL_NAME,
  type ReplyBlockData,
} from '../../lib/reply-blocks/reply-blocks-tool'
import ChatToolCall from '../chat/ChatToolCall.vue'
import ReplyBlock from '../chat/ReplyBlock.vue'
import AppIcon from '../common/AppIcon.vue'

/** The questions of a quick request and their answers, as they stream in */
const props = withDefaults(
  defineProps<{
    turns: QuickAiRequestTurn[]
    /** The selection the reply blocks may replace */
    sourceText?: string
  }>(),
  { sourceText: '' }
)

const emit = defineEmits<{
  applyReplyBlock: [block: ReplyBlockData, target: 'window' | 'editor' | 'copy']
  answerToolApproval: [approvalId: string, decision: ChatToolDecision]
}>()

const { t } = useI18n()
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
</style>
