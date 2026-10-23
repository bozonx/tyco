<template>
  <SettingsSection
    :title="t('settings.profileTools')"
    :info="t('settings.profileToolsHint')"
  >
    <div class="settings-section-content">
      <template v-for="group in groups" :key="group.id">
        <SettingsEntityItem
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
        <div
          v-if="groupSettings(group).isEnabled && $slots.group"
          class="tool-group-details"
        >
          <slot name="group" :group="group" :settings="groupSettings(group)" />
        </div>
      </template>
    </div>
    <FieldRow
      v-if="hasEnabledGroup"
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
        @update:model-value="emit('changeStepCount', $event)"
        @invalid-input="emit('invalidStepCount')"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type ChatToolGroup,
  DEFAULT_TOOL_STEP_COUNT,
  MAX_TOOL_STEP_COUNT,
  toolGroupSettings,
  withToolGroup,
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
  /** The step limit as typed; the editor checks and stores it */
  stepCountText: string
  stepCountError: boolean
}>()
const emit = defineEmits<{
  update: [tools: ProfileToolSettings]
  changeStepCount: [text: string]
  /** The browser holds text that is no number at all */
  invalidStepCount: []
}>()
defineSlots<{
  /** More settings of a group, shown while it is on */
  group?: (props: {
    group: ChatToolGroup
    settings: ToolGroupSettings
  }) => unknown
}>()
const { t } = useI18n()

const accessOptions = computed(() => [
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

const groupSettings = (group: ChatToolGroup) =>
  toolGroupSettings(props.tools, group)

/** The step limit only matters once the model has a tool to call */
const hasEnabledGroup = computed(() =>
  props.groups.some((group) => groupSettings(group).isEnabled)
)

function emitGroup(group: ChatToolGroup, patch: Partial<ToolGroupSettings>) {
  emit('update', withToolGroup(props.tools, group, patch))
}
</script>

<style scoped>
.tool-group-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-inline-start: var(--space-lg);
  border-inline-start: 2px solid var(--app-border-subtle);
}
</style>
