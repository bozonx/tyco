<template>
  <div class="tool-change">
    <div class="tool-change-header">
      <span class="tool-change-path" :title="change.path">{{
        change.path
      }}</span>
      <span v-if="change.before === null" class="tool-change-note">
        {{ t('chatTools.files.newFile') }}
      </span>
      <span class="tool-change-counts">
        <span class="is-added">+{{ summary.addedCount }}</span>
        <span class="is-removed">−{{ summary.removedCount }}</span>
      </span>
    </div>
    <pre
      class="tool-change-lines"
      :aria-label="t('chatTools.files.changeLabel', { path: change.path })"
    ><template v-for="(line, index) in summary.lines" :key="index"><span
      v-if="line.kind === 'gap'"
      class="line is-gap"
    >{{ t('chatTools.files.unchangedLines', { count: line.count }) }}</span><span
      v-else
      class="line"
      :class="`is-${line.kind}`"
    >{{ LINE_MARKS[line.kind] }} {{ line.text }}</span></template><span
      v-if="summary.hiddenCount"
      class="line is-gap"
    >{{ t('chatTools.files.hiddenLines', { count: summary.hiddenCount }) }}</span></pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { summarizeFileChange } from '../../lib/chat-tools/chat-tool-diff'
import type { ChatToolPreview } from '../../lib/chat-tools/chat-tool-registry'

const props = defineProps<{ change: ChatToolPreview }>()
const { t } = useI18n()

const LINE_MARKS = { added: '+', removed: '−', context: ' ' } as const

const summary = computed(() =>
  summarizeFileChange(props.change.before, props.change.after)
)
</script>

<style scoped>
.tool-change {
  margin-top: var(--space-xs);
}
.tool-change-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: 2px;
  color: var(--app-text-muted);
}
.tool-change-path {
  overflow: hidden;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tool-change-note {
  color: var(--app-text-faint);
}
.tool-change-counts {
  display: inline-flex;
  gap: var(--space-xs);
  margin-left: auto;
  font-family: var(--font-mono, monospace);
}
.tool-change-lines {
  overflow: auto;
  max-height: 20rem;
  margin: 0;
  padding: var(--space-xs) 0;
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  font-size: var(--text-caption);
}
.line {
  display: block;
  padding: 0 var(--space-sm);
  white-space: pre-wrap;
  word-break: break-word;
}
.is-added {
  color: var(--color-success);
}
.line.is-added {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}
.is-removed {
  color: var(--color-error);
}
.line.is-removed {
  background: color-mix(in srgb, var(--color-error) 12%, transparent);
}
.line.is-gap {
  color: var(--app-text-faint);
  font-style: italic;
}
</style>
