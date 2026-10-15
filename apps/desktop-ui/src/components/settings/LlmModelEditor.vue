<template>
  <div class="model-row">
    <div class="model-row-header">
      <div class="flex items-center gap-2 min-w-0">
        <Icon icon="mdi:cube-outline" height="17" class="text-muted" />
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
      <Button
        size="xs"
        variant="ghost"
        :icon="
          expandedModelIds.has(model.id) ? 'mdi:chevron-up' : 'mdi:tune-variant'
        "
        @click="toggle(expandedModelIds, model.id)"
      >
        {{
          expandedModelIds.has(model.id)
            ? t('settings.hideAdvanced')
            : t('settings.showAdvanced')
        }}
      </Button>
    </div>
    <template v-if="expandedModelIds.has(model.id)">
      <FieldRow :label="t('settings.vision')">
        <FieldSwitch
          :model-value="supportsImages(model)"
          @update:model-value="emit('update', { canUseImages: $event })"
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
    </template>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { supportsImages } from '../../lib/llm/llm-catalog'
import { modelLabel } from '../../lib/llm/llm-config'
import type { createLlmSettingsModel } from '../../lib/llm/llm-settings-model'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import type { LlmModel } from '@tyco/shared'

const props = defineProps<{
  model: LlmModel
  placeholder: string
  settings: ReturnType<typeof createLlmSettingsModel>
}>()
const emit = defineEmits<{
  remove: [id: string]
  update: [patch: Partial<LlmModel>]
}>()
const { t } = useI18n()
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
  padding: var(--space-xs) var(--space-md) var(--space-sm);
  text-align: right;
}
</style>
