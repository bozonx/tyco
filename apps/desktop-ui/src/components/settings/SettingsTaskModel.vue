<template>
  <FieldRow
    flow
    :label="t('settings.taskModel')"
    :info="t('settings.taskModelInfo')"
  >
    <div class="task-model">
      <span :class="{ 'text-muted': !summary.primaryModelLabel }">
        {{ summary.primaryModelLabel ?? t('settings.taskModelNone') }}
      </span>
      <span v-if="summary.fallbackCount" class="text-muted">
        ·
        {{ t('settings.taskModelFallbacks', { count: summary.fallbackCount }) }}
      </span>
      <InlineAction @click="navigate('llm')">
        {{ t('settings.taskModelChange') }}
      </InlineAction>
    </div>
  </FieldRow>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { taskModelSummary } from '../../lib/llm/llm-config'
import FieldRow from '../common/FieldRow.vue'
import InlineAction from '../common/InlineAction.vue'
import type { LlmTask } from '@tyco/shared'

const props = defineProps<{ task: LlmTask }>()

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const summary = computed(() =>
  taskModelSummary(userConfig.value.llm, props.task)
)
</script>

<style scoped>
.task-model {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  min-width: 0;
}
</style>
