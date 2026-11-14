<template>
  <DisclosurePanel
    class="command-panel"
    :expanded="expanded"
    density="compact"
    :icon="commandIcon(command, operationsStore)"
    :icon-title="toolName"
    @toggle="emit('toggle')"
  >
    <template #before>
      <DragHandle @drag="emit('drag', $event)" />
    </template>
    <template #summary>
      <span
        class="command-name"
        :class="{
          'is-empty':
            !displayName || !command.isEnabled || unavailableReasonKey,
        }"
      >
        {{ displayName || t('commands.unnamed') }}
      </span>
      <Badge v-if="!commandTakesText(command, operationsStore)">
        {{ t('commands.badgeNoText') }}
      </Badge>
      <Badge
        v-if="command.isEnabled && unavailableReasonKey"
        tone="muted"
        :title="t(unavailableReasonKey!)"
      >
        {{ t('commands.badgeUnavailable') }}
      </Badge>
      <Badge
        v-if="hasIssues"
        tone="warning"
        :title="t('commands.badgeIssuesHint')"
      >
        <AppIcon icon="mdi:alert-outline" size="sm" />
      </Badge>
    </template>
    <template #actions>
      <div class="command-placements">
        <Badge v-if="menuSlot !== undefined">
          {{ t('commands.badgeInMenu', { key: slotKey(menuSlot!) }) }}
        </Badge>
        <Badge
          v-for="slot in launcherSlots"
          :key="`${slot.page}:${slot.index}`"
        >
          {{
            t('commands.badgeInLauncher', {
              page: slot.page + 1,
              key: slotKey(slot.index),
            })
          }}
        </Badge>
      </div>
      <FieldSwitch
        :key="command.id"
        class="enabled-switch"
        :model-value="command.isEnabled"
        :title="t(command.isEnabled ? 'commands.disable' : 'commands.enable')"
        @update:model-value="emit('update', { ...command, isEnabled: $event })"
      />
      <DropdownMenu
        size="xs"
        square
        hide-chevron
        align="right"
        icon="mdi:dots-vertical"
        :title="t('commands.moreActions')"
        :items="menuItems"
      />
    </template>
    <div class="command-body">
      <CommandEditor
        :key="command.id"
        :command="command"
        :user-config="userConfig"
        :name-conflicts="nameConflicts"
        :autofocus-name="autofocusName"
        @update="emit('update', $event)"
        @navigate="emit('navigate', $event)"
      />
    </div>
  </DisclosurePanel>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  commandIcon,
  commandLabel,
  commandTakesText,
  commandUnavailableReason,
  validateCommand,
} from '../../lib/commands/command-runtime'
import { operationLabel } from '../../lib/operations/operation-label'
import { useOperationsStore } from '../../stores/operations'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import DisclosurePanel from '../common/DisclosurePanel.vue'
import DragHandle from '../common/DragHandle.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import CommandEditor from './CommandEditor.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig: UserConfig
  expanded: boolean
  autofocusName?: boolean
  menuSlot?: number
  launcherSlots: { page: number; index: number }[]
  nameConflicts: CommandConfig[]
}>()
const emit = defineEmits<{
  (event: 'toggle'): void
  (event: 'drag', value: PointerEvent): void
  (event: 'update', value: CommandConfig): void
  (event: 'navigate', tab: string): void
  (event: 'copy-id'): void
  (event: 'remove'): void
}>()
const { t } = useI18n()
const operationsStore = useOperationsStore()
const slotKey = (index: number) =>
  SHORTCUT_SLOT_KEYS[index]?.toUpperCase() ?? ''
// a translation without a name of its own is named by its tool
const displayName = computed(() =>
  props.command.name.trim() || props.command.operationId !== 'core.translate'
    ? props.command.name
    : commandLabel(props.command)
)
const unavailableReasonKey = computed(() =>
  commandUnavailableReason(props.command, operationsStore)
)
const hasIssues = computed(
  () =>
    validateCommand(props.command, operationsStore).length > 0 ||
    props.nameConflicts.length > 0
)
const toolName = computed(() => {
  const tool = operationsStore.get(props.command.operationId)
  return tool ? operationLabel(tool, t) : props.command.operationId
})
const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    label: t('commands.copyId'),
    icon: 'mdi:identifier',
    action: () => emit('copy-id'),
  },
  {
    label: t('common.delete'),
    icon: 'mdi:trash-can-outline',
    action: () => emit('remove'),
  },
])
</script>
<style scoped>
.command-panel {
  --disclosure-panel-header-gap: var(--space-xs);
  --disclosure-panel-header-padding: var(--space-xs) var(--space-sm)
    var(--space-xs) var(--space-xs);
}

.command-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.command-name.is-empty {
  color: var(--app-text-muted);
}

.command-placements {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-xs);
  max-width: 65%;
}

.command-body {
  padding: var(--space-sm) var(--space-md) var(--space-md)
    calc(var(--space-xs) + 1.25rem + var(--space-xs));
}

.enabled-switch {
  margin: 0 var(--space-xs);
}
</style>
