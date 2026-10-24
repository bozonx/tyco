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

import { useCommandValidation } from '../../composables/use-command-validation'
import { useI18n } from '../../composables/use-i18n'
import { scriptToolConfig } from '../../lib/commands/command-config'
import { useIpcStore } from '../../stores/ipc'
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
const warningsOf = useCommandValidation(() => props.command)
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
