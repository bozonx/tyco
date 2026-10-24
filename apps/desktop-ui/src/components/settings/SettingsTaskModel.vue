<template>
  <FieldRow
    flow
    :label="t('settings.taskModel')"
    :info="t('settings.taskModelInfo')"
  >
    <div class="task-model">
      <span :class="{ 'text-muted': !model }">
        {{ model ? modelLabel(model) : t('settings.taskModelNone') }}
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
import { modelLabel, taskModel } from '../../lib/llm/llm-config'
import FieldRow from '../common/FieldRow.vue'
import InlineAction from '../common/InlineAction.vue'
import type { LlmTask } from '@tyco/shared'

const props = defineProps<{ task: LlmTask }>()

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const model = computed(() => taskModel(userConfig.value.llm, props.task))
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
