<template>
  <div class="custom-action-fields">
    <FieldRow
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionCommandLabel')"
      :warning="warningsOf('command')"
    >
      <ActionTemplateField
        ref="commandRef"
        multiline
        :model-value="script.command"
        :placeholder="
          t('settings.actionCommandPlaceholder', { placeholder: TEXT })
        "
        @update:model-value="update('command', $event)"
      >
        <IconButton
          variant="ghost"
          size="sm"
          @click="browseScript"
          :label="t('settings.actionInsertScript')"
          icon="mdi:file-code-outline"
        />
      </ActionTemplateField>

      <template #info
        ><InfoTooltip
          :text="t('settings.actionCommandInfo', { placeholder: TEXT })"
      /></template>
    </FieldRow>

    <FieldRow
      class="action-field"
      vertical
      density="compact"
      :label="t('settings.actionWorkingDirLabel')"
    >
      <div class="action-field-row">
        <FieldInput
          class="flex-1"
          :model-value="script.workingDirectory"
          :placeholder="t('settings.actionWorkingDirPlaceholder')"
          @update:model-value="update('workingDirectory', $event)"
        />
        <IconButton
          variant="ghost"
          size="sm"
          @click="browseWorkingDir"
          :label="t('settings.browseWorkingDir')"
          icon="mdi:folder-open-outline"
        />
      </div>

      <template #info
        ><InfoTooltip :text="t('settings.actionWorkingDirInfo')"
      /></template>
    </FieldRow>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { scriptToolConfig } from '../../lib/commands/command-config'
import { validateCommand } from '../../lib/commands/command-runtime'
import { useIpcStore } from '../../stores/ipc'
import { useToolsStore } from '../../stores/tools'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import ActionTemplateField from './ActionTemplateField.vue'
import type { CommandConfig } from '@tyco/shared'
import { ACTION_TEXT_PLACEHOLDER as TEXT } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const toolsStore = useToolsStore()
const issues = computed(() => validateCommand(props.command, toolsStore))
const warningsOf = (field: string) =>
  issues.value
    .filter((issue) => issue.field === field)
    .map((issue) => t(issue.messageKey, { placeholder: TEXT }))
function update(field: string, value: unknown) {
  emit('update', field, value)
}

const ipcStore = useIpcStore()
const script = computed(() => scriptToolConfig(props.command))
const commandRef = ref<InstanceType<typeof ActionTemplateField> | null>(null)
async function browseScript() {
  const res = await ipcStore.callOrNotify('pick_script_file')
  if (typeof res.result === 'string') await commandRef.value?.insert(res.result)
}

async function browseWorkingDir() {
  const res = await ipcStore.callOrNotify('pick_directory')
  if (typeof res.result === 'string') update('workingDirectory', res.result)
}
</script>
<style scoped>
.custom-action-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
}

.action-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  width: 100%;
}

.action-field-warning {
  font-size: var(--text-caption);
  color: var(--color-warning);
}

.header-name {
  width: 10rem;
  flex: none;
}
</style>
