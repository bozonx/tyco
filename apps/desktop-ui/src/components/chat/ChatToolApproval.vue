<template>
  <div class="tool-approval" role="group" :aria-label="question">
    <div class="tool-approval-text">
      <span class="tool-approval-question">{{ question }}</span>
      <span class="tool-approval-meta">
        <Badge tone="muted">{{ sourceText }}</Badge>
        <Badge
          v-if="request?.risk"
          :tone="isRiskyTool(request.risk) ? 'warning' : 'muted'"
        >
          {{ t(TOOL_RISK_LABEL_KEYS[request.risk]) }}
        </Badge>
        <span v-if="request?.capabilities?.length" class="tool-approval-hint">
          {{
            t('toolPermissions.pluginCapabilities', {
              capabilities: request.capabilities.join(', '),
            })
          }}
        </span>
      </span>
      <span
        v-if="request?.leakTarget || request?.coveredLeakTarget"
        class="tool-approval-hint"
      >
        {{ t('toolPermissions.leakQuestion') }}
      </span>
      <span
        v-else-if="request?.isAfterUntrustedContent"
        class="tool-approval-hint"
      >
        {{ t('toolPermissions.untrustedQuestion') }}
      </span>
    </div>
    <div class="tool-approval-actions">
      <Button
        v-if="batchCount > 1"
        size="xs"
        variant="neutral"
        icon="mdi:check-all"
        @click="emit('decide', 'allow-batch')"
      >
        {{ t('chat.toolAllowBatch', { count: batchCount }) }}
      </Button>
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
        icon="mdi:check-circle-outline"
        @click="emit('decide', 'allow-session')"
      >
        {{ t('chat.toolAllowSession') }}
      </Button>
      <Button
        v-if="request?.alwaysAllow?.length && !request.leakTarget"
        size="xs"
        variant="neutral"
        icon="mdi:shield-check-outline"
        @click="emit('decide', 'allow-always')"
      >
        {{ alwaysText }}
      </Button>
      <Button
        size="xs"
        variant="danger-ghost"
        icon="mdi:close"
        @click="emit('decide', 'deny')"
      >
        {{ t('chat.toolDeny') }}
      </Button>
      <Button
        v-if="batchCount > 1"
        size="xs"
        variant="danger-ghost"
        @click="emit('decide', 'deny-batch')"
      >
        {{ t('chat.toolDenyBatch', { count: batchCount }) }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ChatToolApprovalRequest } from '../../lib/chat-tools/chat-tool-loop'
import type { ChatToolAnswer } from '../../lib/chat-tools/chat-tool-policy'
import { isRiskyTool } from '../../lib/chat-tools/tool-catalog'
import { TOOL_RISK_LABEL_KEYS } from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'

const props = withDefaults(
  defineProps<{
    /** The name the user knows the tool by */
    toolLabel: string
    /** What the call asks with: its source, risk and what it may be answered */
    request?: ChatToolApprovalRequest
    /** The calls of the same step that wait too, this one among them */
    batchCount?: number
  }>(),
  { request: undefined, batchCount: 1 }
)
const emit = defineEmits<{ decide: [decision: ChatToolAnswer] }>()
const { t } = useI18n()

const question = computed(() =>
  t('chat.toolApprovalQuestion', { tool: props.toolLabel })
)

const SOURCE_KEYS = {
  core: 'toolPermissions.sourceCore',
  plugin: 'toolPermissions.sourcePlugin',
  mcp: 'toolPermissions.sourceMcp',
  commands: 'toolPermissions.sourceCommand',
} as const

const sourceText = computed(() => {
  const source = props.request?.source
  const kind = t(SOURCE_KEYS[source?.kind ?? 'core'])
  const label = props.request?.sourceLabel
  return label ? `${kind}: ${label}` : kind
})

/** Raising deleting in a project, with writing where it asks, is said so */
const alwaysText = computed(() => {
  const project = props.request?.alwaysAllow?.find(
    (target) => target.kind === 'project'
  )
  if (project?.kind === 'project' && project.operations.includes('delete'))
    return t(
      project.operations.length > 1
        ? 'chat.toolAllowAlwaysWriteDelete'
        : 'chat.toolAllowAlwaysDelete'
    )
  return t('chat.toolAllowAlways')
})
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
.tool-approval-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.tool-approval-question {
  font-size: var(--text-caption);
  font-weight: 500;
}
.tool-approval-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}
.tool-approval-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
.tool-approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
</style>
