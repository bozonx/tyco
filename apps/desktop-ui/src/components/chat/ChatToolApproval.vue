<template>
  <div class="tool-approval" role="group" :aria-label="question">
    <span class="tool-approval-question">{{ question }}</span>
    <div class="tool-approval-actions">
      <Button
        size="xs"
        variant="primary"
        icon="mdi:check"
        @click="emit('decide', 'allow-once')"
      >
        {{ t('chat.toolAllow') }}
      </Button>
      <Button
        size="xs"
        variant="neutral"
        icon="mdi:check-all"
        @click="emit('decide', 'allow-session')"
      >
        {{ t('chat.toolAllowSession') }}
      </Button>
      <Button
        size="xs"
        variant="danger-ghost"
        icon="mdi:close"
        @click="emit('decide', 'deny')"
      >
        {{ t('chat.toolDeny') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ChatToolDecision } from '../../lib/chat-tools/chat-tool-policy'
import Button from '../common/Button.vue'

const props = defineProps<{ toolName: string }>()
const emit = defineEmits<{ decide: [decision: ChatToolDecision] }>()
const { t } = useI18n()

const question = computed(() =>
  t('chat.toolApprovalQuestion', { tool: props.toolName })
)
</script>

<style scoped>
.tool-approval {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--app-border-subtle);
  background: var(--app-surface-raised);
}
.tool-approval-question {
  font-size: var(--text-caption);
  font-weight: 500;
}
.tool-approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
</style>
