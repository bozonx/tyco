<template>
  <SettingsSection
    :title="t('settings.profileTools')"
    :info="t('settings.profileToolsHint')"
  >
    <div class="settings-section-content">
      <SettingsEntityItem
        v-for="group in groups"
        :key="group.id"
        :icon="group.icon"
        icon-tone="secondary"
        :title="t(group.labelKey)"
        :description="t(group.descriptionKey)"
      >
        <SegmentedControl
          v-if="groupSettings(group).isEnabled"
          size="sm"
          :label="`${t(group.labelKey)}: ${t('settings.profileToolAccess')}`"
          :model-value="groupSettings(group).access"
          :options="accessOptions"
          @update:model-value="
            emitGroup(group, { access: $event as ProjectAccessMode })
          "
        />
        <FieldSwitch
          :aria-label="t(group.labelKey)"
          :model-value="groupSettings(group).isEnabled"
          @update:model-value="emitGroup(group, { isEnabled: $event })"
        />
      </SettingsEntityItem>
    </div>
    <FieldRow
      :label="t('settings.profileToolSteps')"
      :hint="t('settings.profileToolStepsHint')"
      :error="
        stepCountError ? t('settings.profileToolStepsInvalid') : undefined
      "
    >
      <FieldNumber
        min="1"
        :max="MAX_TOOL_STEP_COUNT"
        :model-value="stepCountText"
        :placeholder="String(DEFAULT_TOOL_STEP_COUNT)"
        :aria-invalid="stepCountError || undefined"
        @update:model-value="changeStepCount"
        @invalid-input="stepCountError = true"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type ChatToolGroup,
  DEFAULT_TOOL_STEP_COUNT,
  MAX_TOOL_STEP_COUNT,
  parseToolStepCount,
  toolGroupSettings,
  withToolGroup,
  withToolStepCount,
} from '../../lib/chat-tools/chat-tool-groups'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import type {
  ProfileToolSettings,
  ProjectAccessMode,
  ToolGroupSettings,
} from '@tyco/shared'

const props = defineProps<{
  groups: readonly ChatToolGroup[]
  tools: ProfileToolSettings | undefined
}>()
const emit = defineEmits<{ update: [tools: ProfileToolSettings] }>()
const { t } = useI18n()

const accessOptions = computed(() => [
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

const groupSettings = (group: ChatToolGroup) =>
  toolGroupSettings(props.tools, group)

function emitGroup(group: ChatToolGroup, patch: Partial<ToolGroupSettings>) {
  emit('update', withToolGroup(props.tools, group, patch))
}

const stepCountText = ref('')
const stepCountError = ref(false)
watch(
  () => props.tools?.maxStepCount,
  (count) => {
    if (!stepCountError.value) stepCountText.value = String(count ?? '')
  },
  { immediate: true }
)

function changeStepCount(value: string) {
  stepCountText.value = value
  const parsed = parseToolStepCount(value)
  stepCountError.value = !parsed.isValid
  if (parsed.isValid)
    emit('update', withToolStepCount(props.tools, parsed.value))
}
</script>
