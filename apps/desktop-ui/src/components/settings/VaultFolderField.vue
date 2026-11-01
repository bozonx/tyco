<template>
  <FieldRow
    :label="t('settings.vaultFolder')"
    :info="info"
    :hint="`${directory}/${field.folderId.value}`"
    :error="field.errorKey.value ? t(field.errorKey.value) : undefined"
  >
    <FieldInput
      :model-value="field.typedId.value"
      @update:model-value="emit('update:typedId', $event)"
      :placeholder="field.suggestedId.value"
      :disabled="disabled"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { createVaultFolderField } from '../../lib/ai-profiles/vault-folder-field'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'

defineProps<{
  field: ReturnType<typeof createVaultFolderField>
  directory: 'profiles' | 'projects'
  info: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:typedId': [value: string] }>()
const { t } = useI18n()
</script>
