<template>
  <div class="settings-stack">
    <SettingsSection
      bare
      :description="
        t('variables.hint', { example: variablePlaceholder('NAME') })
      "
    >
      <div class="flex flex-col gap-3">
        <InlineNotice
          v-if="unsetCount"
          kind="warning"
          appearance="surface"
          icon="mdi:alert-outline"
          :message="t('variables.unsetOnDevice', { count: unsetCount })"
        />
        <InlineNotice
          kind="info"
          appearance="sunken"
          density="compact"
          icon="mdi:shield-alert-outline"
          :message="t('variables.notForSecrets')"
        />
      </div>
    </SettingsSection>

    <SettingsSection :title="t('variables.listTitle')">
      <p v-if="!variables.length" class="variables-empty">
        {{ t('variables.empty') }}
      </p>
      <div
        v-for="variable in variables"
        :key="variable.id"
        class="variable-row"
        :data-testid="`variable-${variable.id}`"
      >
        <div class="variable-row-head">
          <FieldRow
            :label="t('variables.name')"
            density="compact"
            :error="nameErrors[variable.id]"
          >
            <FieldInput
              :model-value="nameDrafts[variable.id] ?? variable.name"
              class="font-mono"
              @update:model-value="nameDrafts[variable.id] = String($event)"
              @blur="commitName(variable.id)"
              @keydown.enter="commitName(variable.id)"
            />
          </FieldRow>
          <IconButton
            icon="mdi:delete-outline"
            variant="danger-ghost"
            :label="t('variables.remove')"
            @click="remove(variable.id)"
          />
        </div>
        <FieldRow :label="t('variables.description')" density="compact">
          <FieldInput
            :model-value="variable.description"
            @update:model-value="
              setVariableDescription(draft, variable.id, String($event))
            "
          />
        </FieldRow>
        <FieldRow
          :label="t('variables.value')"
          density="compact"
          :warning="
            draft.variableValues[variable.id]?.trim()
              ? undefined
              : t('variables.valueNotSet')
          "
        >
          <template #info><DeviceScopeBadge /></template>
          <div class="flex flex-wrap items-center gap-2">
            <FieldInput
              class="flex-1 min-w-48"
              :model-value="draft.variableValues[variable.id] ?? ''"
              :placeholder="t('variables.valuePlaceholder')"
              @update:model-value="
                setVariableValue(draft, variable.id, String($event))
              "
            />
            <DirectoryPickerButton
              @select="setVariableValue(draft, variable.id, $event)"
            />
            <Button size="sm" @click="pickFile(variable.id)">
              {{ t('variables.browseFile') }}
            </Button>
          </div>
        </FieldRow>
        <p class="variable-usage">
          <code>{{ variablePlaceholder(variable.name) }}</code>
          · {{ usageText(variable.name) }}
        </p>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('variables.addTitle')">
      <div class="flex flex-col gap-2">
        <FieldRow
          :label="t('variables.name')"
          density="compact"
          :error="newError"
          :hint="t('variables.nameHint')"
        >
          <FieldInput
            v-model="newName"
            class="font-mono"
            placeholder="NOTES_DIR"
            data-testid="variable-new-name"
            @keydown.enter="add"
          />
        </FieldRow>
        <FieldRow :label="t('variables.description')" density="compact">
          <FieldInput v-model="newDescription" @keydown.enter="add" />
        </FieldRow>
        <div>
          <Button
            variant="primary"
            size="sm"
            data-testid="variable-add"
            @click="add"
          >
            {{ t('variables.add') }}
          </Button>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('variables.builtinTitle')"
      :description="t('variables.builtinHint')"
    >
      <div v-for="item in builtins" :key="item.name" class="variable-builtin">
        <code>{{ variablePlaceholder(item.name) }}</code>
        <span class="variable-builtin-value">{{ item.value }}</span>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { variableUsage } from '../../lib/variables/command-variables'
import {
  addVariable,
  removeVariable,
  renameVariableIn,
  setVariableDescription,
  setVariableValue,
  unsetVariables,
} from '../../lib/variables/variables-settings'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import DirectoryPickerButton from './DirectoryPickerButton.vue'
import SettingsSection from './SettingsSection.vue'
import { variablePlaceholder } from '@tyco/shared'

const { t } = useI18n()
const { draft } = useSettingsContext()
const desktop = useDesktopStore()
const ipc = useIpcStore()

const variables = computed(() => draft.value.variables)
const unsetCount = computed(() => unsetVariables(draft.value).length)

/** Names being typed: a rename is applied when the field is left */
const nameDrafts = reactive<Record<string, string>>({})
const nameErrors = reactive<Record<string, string>>({})

function commitName(id: string) {
  const name = nameDrafts[id]
  if (name === undefined) return
  const issueKey = renameVariableIn(draft.value, id, name)
  if (issueKey) {
    nameErrors[id] = t(issueKey)
    return
  }
  delete nameDrafts[id]
  delete nameErrors[id]
}

function remove(id: string) {
  removeVariable(draft.value, id)
  delete nameDrafts[id]
  delete nameErrors[id]
}

const newName = ref('')
const newDescription = ref('')
const newError = ref<string>()

function add() {
  const result = addVariable(draft.value, newName.value, newDescription.value)
  if (!result.ok) {
    newError.value = t(result.issueKey)
    return
  }
  newName.value = ''
  newDescription.value = ''
  newError.value = undefined
}

/** A file, by its path */
async function pickFile(id: string) {
  const result = await ipc.callOrNotify('pick_file')
  if (typeof result.result === 'string')
    setVariableValue(draft.value, id, result.result)
}

function usageText(name: string): string {
  const usage = variableUsage(draft.value, name)
  const count = usage.commandIds.length + usage.providerIds.length
  return count ? t('variables.usedBy', { count }) : t('variables.unused')
}

const builtins = computed(() => [
  { name: 'TYCO_USER_DIR', value: desktop.userData?.path ?? '' },
  { name: 'TYCO_DEVICE_ID', value: desktop.userData?.deviceId ?? '' },
])
</script>

<style scoped>
.variable-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-block: var(--space-md);
}
.variable-row + .variable-row {
  border-top: 1px solid var(--app-border);
}
.variable-row-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
}
.variable-row-head > :first-child {
  flex: 1;
  min-width: 0;
}
.variable-usage,
.variables-empty {
  color: var(--app-text-muted);
  font-size: var(--text-small);
}
.variable-builtin {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding-block: var(--space-xs);
}
.variable-builtin-value {
  color: var(--app-text-muted);
  overflow-wrap: anywhere;
}
</style>
