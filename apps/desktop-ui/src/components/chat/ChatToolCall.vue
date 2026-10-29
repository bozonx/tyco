<template>
  <ChatMemoryChangeCard
    v-if="isMemoryWriteDone"
    :call="call"
    :result="result"
  />
  <div v-else class="tool-call" :class="`is-${call.state}`">
    <DisclosureHeader
      :expanded="isExpanded"
      :controls="detailsId"
      :icon="call.icon || 'mdi:tools'"
      icon-size="md"
      @toggle="isExpanded = !isExpanded"
    >
      <span class="tool-call-summary">
        <span class="tool-call-name" :title="call.toolName">{{ label }}</span>
        <span v-if="argumentsPreview" class="tool-call-args">
          {{ argumentsPreview }}
        </span>
      </span>
      <template #status>
        <span class="tool-call-status">
          <AppIcon
            :icon="stateIcon"
            size="sm"
            class="tool-call-state shrink-0"
            :class="{ 'is-running': call.state === 'pending' }"
          />
          {{ t(stateKey) }}
        </span>
      </template>
    </DisclosureHeader>
    <div v-if="isExpanded" :id="detailsId" class="tool-call-details selectable">
      <ChatToolChange
        v-if="isAwaitingAnswer && preview?.kind === 'file-change'"
        :change="preview"
      />
      <template v-else>
        <div class="tool-call-label">{{ t('chat.toolArguments') }}</div>
        <pre>{{ argumentsText }}</pre>
      </template>
      <template v-if="result">
        <div class="tool-call-label">
          {{ t('chat.toolResult') }}
          <span v-if="result.isTruncated" class="tool-call-note">
            · {{ t('chat.toolResultTruncated') }}
          </span>
        </div>
        <pre :class="{ 'is-error': result.isError }">{{ result.output }}</pre>
      </template>
    </div>
    <ChatToolApproval
      v-if="isAwaitingAnswer"
      :tool-name="call.toolName"
      @decide="emit('decide', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ChatToolDecision } from '../../lib/chat-tools/chat-tool-policy'
import type { ChatToolPreview } from '../../lib/chat-tools/chat-tool-registry'
import AppIcon from '../common/AppIcon.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import ChatMemoryChangeCard from './ChatMemoryChangeCard.vue'
import ChatToolApproval from './ChatToolApproval.vue'
import ChatToolChange from './ChatToolChange.vue'
import type { ChatMessagePart } from '@tyco/shared'

/** How long the arguments are in the collapsed card */
const ARGUMENTS_PREVIEW_CHARACTERS = 80

const props = defineProps<{
  call: Extract<ChatMessagePart, { type: 'tool-call' }>
  result?: Extract<ChatMessagePart, { type: 'tool-result' }>
  /** The call waits for the user's answer right now */
  isAwaitingAnswer?: boolean
  /** What the waiting call would change, shown instead of its arguments */
  preview?: ChatToolPreview
}>()
const emit = defineEmits<{ decide: [decision: ChatToolDecision] }>()
const { t } = useI18n()
const isExpanded = ref(false)
const detailsId = useId()

const MEMORY_WRITE_TOOLS = new Set([
  'memory_add',
  'memory_replace',
  'memory_rewrite',
])
const isMemoryWriteDone = computed(
  () =>
    props.call.state === 'done' && MEMORY_WRITE_TOOLS.has(props.call.toolName)
)
// the user decides on what the call does, so its arguments are in view
watch(
  () => props.isAwaitingAnswer,
  (isAwaiting) => {
    if (isAwaiting) isExpanded.value = true
  },
  { immediate: true }
)

const label = computed(
  () =>
    (props.call.labelKey && t(props.call.labelKey)) ||
    props.call.label ||
    props.call.toolName
)

const STATE_ICONS = {
  pending: 'mdi:progress-clock',
  'awaiting-approval': 'mdi:shield-alert-outline',
  denied: 'mdi:cancel',
  done: 'mdi:check-circle-outline',
  error: 'mdi:alert-circle-outline',
} as const

const STATE_KEYS = {
  pending: 'chat.toolState.pending',
  'awaiting-approval': 'chat.toolState.awaitingApproval',
  denied: 'chat.toolState.denied',
  done: 'chat.toolState.done',
  error: 'chat.toolState.error',
} as const

const stateIcon = computed(() => STATE_ICONS[props.call.state])
const stateKey = computed(() => STATE_KEYS[props.call.state])

const argumentsText = computed(() =>
  JSON.stringify(props.call.input ?? {}, null, 2)
)
const argumentsPreview = computed(() => {
  const text = JSON.stringify(props.call.input ?? {})
  if (text === '{}') return ''
  return text.length > ARGUMENTS_PREVIEW_CHARACTERS
    ? `${text.slice(0, ARGUMENTS_PREVIEW_CHARACTERS)}…`
    : text
})
</script>

<style scoped>
.tool-call {
  --disclosure-padding: var(--space-xs) var(--space-md);
  --disclosure-background: transparent;
  --disclosure-hover-background: var(--app-hover);
  overflow: hidden;
  margin: var(--space-xs) 0;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-caption);
}
.tool-call.is-awaiting-approval {
  border-color: var(--color-warning);
}
.tool-call-summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.tool-call-name {
  font-weight: 500;
}
.tool-call-args {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--app-text-muted);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tool-call-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  color: var(--app-text-faint);
  white-space: nowrap;
}
.tool-call.is-done .tool-call-state {
  color: var(--color-success);
}
.tool-call.is-error .tool-call-state,
.tool-call.is-denied .tool-call-state {
  color: var(--color-error);
}
.tool-call.is-awaiting-approval .tool-call-state {
  color: var(--color-warning);
}
.tool-call-state.is-running {
  animation: tool-call-pulse 1.2s ease-in-out infinite;
}
@keyframes tool-call-pulse {
  50% {
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tool-call-state.is-running {
    animation: none;
  }
}
.tool-call-details {
  padding: var(--space-xs) var(--space-md) var(--space-sm);
  border-top: 1px solid var(--app-border-subtle);
}
.tool-call-label {
  margin: var(--space-xs) 0 2px;
  color: var(--app-text-muted);
}
.tool-call-note {
  color: var(--app-text-faint);
}
.tool-call-details pre {
  overflow: auto;
  max-height: 16rem;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-call-details pre.is-error {
  color: var(--color-error);
}
</style>
