<template>
  <div class="ai-task-progress" role="status" aria-live="polite">
    <div class="progress-header">
      <div class="flex items-center gap-2">
        <AppIcon
          icon="mdi:loading"
          size="md"
          class="animate-spin text-primary shrink-0"
        />
        <span class="font-medium text-sm truncate">
          {{ task.name || t('menu.aiTask') }}
        </span>
      </div>
      <Button
        size="xs"
        variant="ghost"
        icon="mdi:close"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </Button>
    </div>

    <div v-if="state.reasoning" class="reasoning-box">
      <div
        class="flex items-center gap-1.5 text-xs text-muted font-medium mb-1"
      >
        <AppIcon icon="mdi:brain" size="xs" />
        <span>{{ t('chat.reasoning') }}</span>
      </div>
      <div class="reasoning-text selectable">
        {{ state.reasoning }}
      </div>
    </div>

    <div v-if="state.toolCalls.length > 0" class="tool-calls-list">
      <div
        v-for="call in state.toolCalls"
        :key="call.toolCallId"
        class="tool-call-item"
        :class="`is-${call.status}`"
      >
        <div class="tool-call-main">
          <div class="flex items-center gap-1.5 min-w-0">
            <AppIcon icon="mdi:tools" size="xs" class="text-muted shrink-0" />
            <span class="text-xs font-medium truncate">{{
              call.toolName
            }}</span>
          </div>
          <div class="tool-call-status">
            <AppIcon
              v-if="call.status === 'loading'"
              icon="mdi:loading"
              size="xs"
              class="animate-spin text-primary"
            />
            <AppIcon
              v-else-if="call.status === 'done'"
              icon="mdi:check-circle"
              size="xs"
              class="text-success"
            />
            <AppIcon
              v-else-if="call.status === 'error'"
              icon="mdi:alert-circle"
              size="xs"
              class="text-danger"
            />
            <AppIcon
              v-else-if="call.status === 'denied'"
              icon="mdi:close-circle"
              size="xs"
              class="text-muted"
            />
            <AppIcon
              v-else-if="call.status === 'awaiting-approval'"
              icon="mdi:help-circle"
              size="xs"
              class="text-warning"
            />
            <span class="text-xs text-muted">
              {{ t(stateKey(call.status)) }}
            </span>
          </div>
        </div>

        <div
          v-if="call.status === 'awaiting-approval'"
          class="tool-approval-actions"
        >
          <span class="text-xs">
            {{ t('chat.toolApprovalQuestion', { tool: call.toolName }) }}
          </span>
          <div class="flex items-center gap-1.5 mt-1.5">
            <Button
              size="xs"
              variant="primary"
              icon="mdi:check"
              @click="emit('decide', true)"
            >
              {{ t('chat.toolAllow') }}
            </Button>
            <Button
              size="xs"
              variant="neutral"
              icon="mdi:close"
              @click="emit('decide', false)"
            >
              {{ t('chat.toolDeny') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import type {
  TaskRunState,
  TaskToolCallStatus,
} from '../../lib/ai-tasks/task-runner'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import type { AiTaskConfig } from '@tyco/shared'

defineProps<{ task: AiTaskConfig; state: TaskRunState }>()

const emit = defineEmits<{ decide: [approved: boolean]; cancel: [] }>()

useDismissibleLayer({
  isOpen: () => true,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => emit('cancel'),
})

const { t } = useI18n()

function stateKey(status: TaskToolCallStatus): string {
  switch (status) {
    case 'loading':
      return 'chat.toolState.pending'
    case 'done':
      return 'chat.toolState.done'
    case 'error':
      return 'chat.toolState.error'
    case 'awaiting-approval':
      return 'chat.toolState.awaitingApproval'
    case 'denied':
      return 'chat.toolState.denied'
  }
}
</script>

<style scoped>
.ai-task-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm);
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--app-border-subtle);
}

.reasoning-box {
  background: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  max-height: 120px;
  overflow-y: auto;
}

.reasoning-text {
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--app-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-calls-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 160px;
  overflow-y: auto;
}

.tool-call-item {
  background: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
}

.tool-call-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.tool-call-status {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  shrink: 0;
}

.tool-approval-actions {
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}
</style>
