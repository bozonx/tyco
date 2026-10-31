<template>
  <div v-if="preview" class="tool-config-preview">
    <p
      v-for="(issue, index) in preview.issues ?? []"
      :key="index"
      role="alert"
      class="tool-config-issue"
    >
      {{ t(issue.messageKey, issue.params ?? {}) }}
    </p>
    <template v-if="preview.samples?.length">
      <p>{{ t('settings.configPreview') }}</p>
      <pre v-for="(sample, index) in preview.samples" :key="index">{{
        sample
      }}</pre>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { clientLogger } from '../../lib/logger'
import type {
  RegisteredTool,
  ToolConfigPreview,
} from '../../lib/tools/tool-types'

/** Problems and sample output a tool reports for the settings being edited. */
const props = defineProps<{
  tool: RegisteredTool
  config: Record<string, unknown>
}>()
const { t } = useI18n()
const preview = ref<ToolConfigPreview>()
let request = 0

watch(
  () => [props.tool, props.config] as const,
  async ([tool, config]) => {
    const current = ++request
    try {
      const next = await tool.previewConfig?.(config)
      if (current === request) preview.value = next
    } catch (error) {
      if (current !== request) return
      preview.value = undefined
      clientLogger.warn(
        `Settings preview of ${tool.id} failed: ${String(error)}`,
        'plugins'
      )
    }
  },
  { immediate: true, deep: true }
)
</script>
<style scoped>
.tool-config-preview {
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  font-size: var(--text-caption);
}
.tool-config-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tool-config-issue {
  color: var(--color-error);
}
</style>
