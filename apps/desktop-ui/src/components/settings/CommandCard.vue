<template>
  <DisclosurePanel
    class="command-panel"
    :expanded="expanded"
    density="compact"
    :icon="commandIcon(command, toolsStore)"
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
          'is-empty': !command.name || !command.enabled || unavailableReasonKey,
        }"
      >
        {{ command.name || t('commands.unnamed') }}
      </span>
      <Badge v-if="!commandTakesText(command, toolsStore)">
        {{ t('commands.badgeNoText') }}
      </Badge>
      <Badge
        v-if="command.enabled && unavailableReasonKey"
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
        <Icon icon="mdi:alert-outline" width="14" height="14" />
      </Badge>
    </template>
    <template #actions>
      <div class="command-placements">
        <Badge
          interactive
          v-if="menuSlot !== undefined"
          :title="t('commands.placeConfigure')"
          @click="emit('navigate', 'main-actions')"
        >
          {{ t('commands.badgeInMenu', { key: slotKey(menuSlot!) }) }}
        </Badge>
        <Badge
          interactive
          v-for="slot in launcherSlots"
          :key="`${slot.page}:${slot.index}`"
          :title="t('commands.placeConfigure')"
          @click="emit('navigate', 'launcher-commands')"
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
        :model-value="command.enabled"
        :title="t(command.enabled ? 'commands.disable' : 'commands.enable')"
        @update:model-value="emit('update', { ...command, enabled: $event })"
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
  commandTakesText,
  commandUnavailableReason,
  validateCommand,
} from '../../lib/commands/command-runtime'
import { toolLabel } from '../../lib/tools/tool-label'
import { useToolsStore } from '../../stores/tools'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import Icon from '../common/AppIcon.vue'
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
const toolsStore = useToolsStore()
const slotKey = (index: number) =>
  SHORTCUT_SLOT_KEYS[index]?.toUpperCase() ?? ''
const unavailableReasonKey = computed(() =>
  commandUnavailableReason(props.command, toolsStore)
)
const hasIssues = computed(
  () =>
    validateCommand(props.command, toolsStore).length > 0 ||
    props.nameConflicts.length > 0
)
const toolName = computed(() => {
  const tool = toolsStore.get(props.command.toolId)
  return tool ? toolLabel(tool, t) : props.command.toolId
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
    danger: true,
    action: () => emit('remove'),
  },
])
</script>
<style scoped>
.command-panel :deep(.disclosure-panel-header) {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-xs);
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
