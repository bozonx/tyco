<template>
  <div class="tool-row" role="listitem" :data-tool="name">
    <span class="tool-row-label">{{ label }}</span>
    <Badge :tone="isRiskyTool(risk) ? 'warning' : 'muted'">
      {{ t(TOOL_RISK_LABEL_KEYS[risk]) }}
    </Badge>
    <div v-if="$slots.default" class="tool-row-controls">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { isRiskyTool } from '../../lib/chat-tools/tool-catalog'
import { TOOL_RISK_LABEL_KEYS } from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import type { ToolRisk } from '@tyco/shared'

/** One tool of a `SettingsToolSource`: its name, its risk and its controls */
defineProps<{ name: string; label: string; risk: ToolRisk }>()
const { t } = useI18n()
</script>

<style scoped>
.tool-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  min-height: var(--control-size-md);
  padding: var(--space-2xs) var(--space-md) var(--space-2xs)
    /* aligned with the source title, past its 1rem icon */
    calc(var(--space-md) + 1rem + var(--space-sm));
}

.tool-row + .tool-row {
  border-top: 1px solid var(--app-border-subtle);
}

.tool-row-label {
  flex: 1 1 8rem;
  min-width: 0;
  font-size: var(--text-control);
  color: var(--app-text);
}

.tool-row-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
