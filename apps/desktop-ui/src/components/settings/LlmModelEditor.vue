<template>
  <div class="model-row">
    <div class="model-row-header">
      <div class="flex items-center gap-2 min-w-0">
        <AppIcon icon="mdi:cube-outline" size="lg" class="text-muted" />
        <span class="font-medium truncate">{{ modelLabel(model) }}</span>
      </div>
      <IconButton
        size="sm"
        variant="danger-ghost"
        icon="mdi:trash-can-outline"
        :label="t('settings.removeModel')"
        @click="emit('remove', model.id)"
      />
    </div>
    <FieldRow :label="t('settings.name')">
      <FieldInput
        :model-value="model.name || ''"
        @update:model-value="emit('update', { name: $event })"
      />
    </FieldRow>
    <FieldRow :label="t('settings.modelId')">
      <FieldInput
        :model-value="model.providerModelId"
        :placeholder="placeholder"
        @update:model-value="emit('update', { providerModelId: $event })"
      />
    </FieldRow>
    <div class="advanced-toggle">
      <DisclosureHeader
        density="compact"
        icon="mdi:tune-variant"
        icon-size="md"
        :expanded="expandedModelIds.has(model.id)"
        :controls="advancedId"
        :title="
          expandedModelIds.has(model.id)
            ? t('settings.hideAdvanced')
            : t('settings.showAdvanced')
        "
        @toggle="toggle(expandedModelIds, model.id)"
      />
    </div>
    <div v-if="expandedModelIds.has(model.id)" :id="advancedId">
      <FieldRow :label="t('settings.vision')">
        <FieldSwitch
          :model-value="supportsImages(model)"
          @update:model-value="emit('update', { canUseImages: $event })"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.toolUse')"
        :hint="t('settings.toolUseHint')"
      >
        <FieldSwitch
          :model-value="supportsTools(model, providers)"
          @update:model-value="emit('update', { canUseTools: $event })"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.temperature')"
        :error="
          numberErrors[`${model.id}:temperature`]
            ? t('settings.numberTemperatureInvalid')
            : undefined
        "
      >
        <FieldNumber
          min="0"
          max="2"
          step="0.1"
          :model-value="
            numberDrafts[`${model.id}:temperature`] ?? model.temperature ?? ''
          "
          :aria-invalid="numberErrors[`${model.id}:temperature`] || undefined"
          @update:model-value="setNumber(model, 'temperature', $event)"
          @invalid-input="numberErrors[`${model.id}:temperature`] = true"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.maxTokens')"
        :error="
          numberErrors[`${model.id}:maxOutputTokens`]
            ? t('settings.numberTokensInvalid')
            : undefined
        "
      >
        <FieldNumber
          min="1"
          :model-value="
            numberDrafts[`${model.id}:maxOutputTokens`] ??
            model.maxOutputTokens ??
            ''
          "
          :aria-invalid="
            numberErrors[`${model.id}:maxOutputTokens`] || undefined
          "
          :placeholder="t('settings.providerDefault')"
          @update:model-value="setNumber(model, 'maxOutputTokens', $event)"
          @invalid-input="numberErrors[`${model.id}:maxOutputTokens`] = true"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.contextSize')"
        :error="
          numberErrors[`${model.id}:contextWindowTokens`]
            ? t('settings.numberTokensInvalid')
            : undefined
        "
      >
        <FieldNumber
          min="1"
          :model-value="
            numberDrafts[`${model.id}:contextWindowTokens`] ??
            model.contextWindowTokens ??
            ''
          "
          :aria-invalid="
            numberErrors[`${model.id}:contextWindowTokens`] || undefined
          "
          :placeholder="t('settings.providerDefault')"
          @update:model-value="setNumber(model, 'contextWindowTokens', $event)"
          @invalid-input="
            numberErrors[`${model.id}:contextWindowTokens`] = true
          "
        />
      </FieldRow>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { supportsImages, supportsTools } from '../../lib/llm/llm-catalog'
import { modelLabel } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import AppIcon from '../common/AppIcon.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import type { LlmModel, LlmProvider } from '@tyco/shared'

const props = defineProps<{
  model: LlmModel
  /** The configured providers; whether a model calls tools depends on its own */
  providers: LlmProvider[]
  placeholder: string
  settings: ReturnType<typeof createLlmSettingsModel>
}>()
const emit = defineEmits<{
  remove: [id: string]
  update: [patch: Partial<LlmModel>]
}>()
const { t } = useI18n()
const advancedId = useId()
const { expandedModelIds, numberDrafts, numberErrors, setNumber } =
  props.settings
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
.advanced-toggle {
  display: flex;
  padding: var(--space-xs) var(--space-md);
  font-size: var(--text-control);
  color: var(--app-text-muted);
}
</style>
