<template>
  <div class="model-row">
    <div class="model-row-header">
      <div class="flex items-center gap-2 min-w-0">
        <AppIcon icon="mdi:cube-outline" size="lg" class="text-muted" />
        <span v-if="displayName" class="font-medium truncate">{{
          displayName
        }}</span>
      </div>
      <IconButton
        size="sm"
        variant="ghost"
        icon="mdi:trash-can-outline"
        :label="t('settings.removeModel')"
        @click="emit('remove', model.id)"
      />
    </div>
    <FieldRow
      :label="t('settings.modelId')"
      required
      :hint="isDraft ? t('settings.modelIdDraftHint') : undefined"
      :error="
        !isDraft && !model.providerModelId.trim()
          ? t('settings.modelIdRequired')
          : undefined
      "
    >
      <FieldInput
        :model-value="model.providerModelId"
        :placeholder="placeholder"
        :autofocus="isDraft"
        @update:model-value="emit('update', { providerModelId: $event })"
      />
    </FieldRow>
    <SettingsAdvancedFields
      :expanded="expandedModelIds.has(model.id)"
      @update:expanded="toggle(expandedModelIds, model.id)"
    >
      <FieldRow :label="t('settings.name')">
        <FieldInput
          :model-value="model.name || ''"
          :placeholder="model.providerModelId.trim() || undefined"
          @update:model-value="emit('update', { name: $event })"
        />
      </FieldRow>
      <FieldRow :label="t('settings.vision')">
        <FieldSwitch
          :model-value="model.canUseImages"
          @update:model-value="emit('update', { canUseImages: $event })"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.toolUse')"
        :info="t('settings.toolUseHint')"
      >
        <FieldSwitch
          :model-value="model.canUseTools"
          @update:model-value="emit('update', { canUseTools: $event })"
        />
      </FieldRow>
      <FieldRow
        v-if="isDeepSeek"
        :label="t('settings.thinkingMode')"
        :info="t('settings.thinkingModeHint')"
      >
        <FieldSwitch
          :model-value="model.isThinkingEnabled === true"
          @update:model-value="emit('update', { isThinkingEnabled: $event })"
        />
      </FieldRow>
      <ModelNumberField
        kind="temperature"
        :model-value="
          numberDrafts[`${model.id}:temperature`] ?? model.temperature ?? ''
        "
        :is-invalid="numberErrors[`${model.id}:temperature`]"
        :placeholder="t('settings.providerDefault')"
        @update:model-value="setNumber(model, 'temperature', $event)"
        @invalid-input="numberErrors[`${model.id}:temperature`] = true"
      />
      <ModelNumberField
        kind="maxOutputTokens"
        :model-value="
          numberDrafts[`${model.id}:maxOutputTokens`] ??
          model.maxOutputTokens ??
          ''
        "
        :is-invalid="numberErrors[`${model.id}:maxOutputTokens`]"
        :placeholder="t('settings.providerDefault')"
        @update:model-value="setNumber(model, 'maxOutputTokens', $event)"
        @invalid-input="numberErrors[`${model.id}:maxOutputTokens`] = true"
        :info="t('settings.maxTokensHint')"
      />
      <ModelNumberField
        kind="contextWindowTokens"
        :model-value="
          numberDrafts[`${model.id}:contextWindowTokens`] ??
          model.contextWindowTokens ??
          ''
        "
        :is-invalid="numberErrors[`${model.id}:contextWindowTokens`]"
        :placeholder="t('settings.providerDefault')"
        @update:model-value="setNumber(model, 'contextWindowTokens', $event)"
        @invalid-input="numberErrors[`${model.id}:contextWindowTokens`] = true"
        :info="t('settings.contextSizeHint')"
      />
    </SettingsAdvancedFields>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { modelDisplayName } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import AppIcon from '../common/AppIcon.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import ModelNumberField from './ModelNumberField.vue'
import SettingsAdvancedFields from './SettingsAdvancedFields.vue'
import type { LlmModel, LlmProvider } from '@tyco/shared'

const props = defineProps<{
  model: LlmModel
  /** The configured providers; the thinking mode depends on the model's own */
  providers: LlmProvider[]
  placeholder: string
  settings: ReturnType<typeof createLlmSettingsModel>
}>()
const emit = defineEmits<{
  remove: [id: string]
  update: [patch: Partial<LlmModel>]
}>()
const { t } = useI18n()
const {
  expandedModelIds,
  numberDrafts,
  numberErrors,
  setNumber,
  isDraftModel,
} = props.settings
const displayName = computed(() => modelDisplayName(props.model))
const isDraft = computed(() => isDraftModel(props.model.id))
/** Only DeepSeek models switch thinking with a request option */
const isDeepSeek = computed(
  () =>
    props.providers.find((provider) => provider.id === props.model.providerId)
      ?.type === 'deepseek'
)
function toggle(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id)
  else set.add(id)
}
</script>
<style scoped>
.model-row {
  overflow: hidden;
  margin-top: var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
}
.model-row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--app-surface-raised);
}
</style>
