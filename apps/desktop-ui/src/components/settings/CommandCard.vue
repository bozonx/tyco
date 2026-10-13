<template>
  <div class="command-header">
    <div
      class="drag-handle"
      :title="t('settings.dragToReorder')"
      @pointerdown="emit('drag', $event)"
    >
      <Icon icon="mdi:drag-vertical" width="18" height="18" />
    </div>
    <button
      type="button"
      class="command-summary"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <Icon
        :icon="commandIcon(command, toolsStore)"
        width="18"
        height="18"
        class="shrink-0"
        :title="toolName"
      />
      <span class="command-name" :class="{ 'is-empty': !command.name }">
        {{ command.name || t('commands.unnamed') }}
      </span>
      <span v-if="!commandTakesText(command, toolsStore)" class="command-badge">
        {{ t('commands.badgeNoText') }}
      </span>
      <span
        v-if="command.enabled && unavailableReason"
        class="command-badge is-muted"
        :title="t(unavailableReason!)"
      >
        {{ t('commands.badgeUnavailable') }}
      </span>
      <span
        v-if="hasIssues"
        class="command-badge is-warning"
        :title="t('commands.badgeIssuesHint')"
      >
        <Icon icon="mdi:alert-outline" width="14" height="14" />
      </span>
      <Icon
        icon="mdi:chevron-down"
        width="18"
        height="18"
        class="command-chevron"
        :class="{ 'rotate-180': expanded }"
      />
    </button>
    <div class="command-placements">
      <button
        v-if="menuSlot !== undefined"
        type="button"
        class="command-badge"
        :title="t('commands.placeConfigure')"
        @click="emit('navigate', 'main-actions')"
      >
        {{ t('commands.badgeInMenu', { key: slotKey(menuSlot!) }) }}
      </button>
      <button
        v-for="slot in launcherSlots"
        :key="`${slot.page}:${slot.index}`"
        type="button"
        class="command-badge"
        :title="t('commands.placeConfigure')"
        @click="emit('navigate', 'launcher-commands')"
      >
        {{
          t('commands.badgeInLauncher', {
            page: slot.page + 1,
            key: slotKey(slot.index),
          })
        }}
      </button>
    </div>
    <FieldCheckbox
      class="enabled-switch"
      :value="command.enabled"
      :title="t(command.enabled ? 'commands.disable' : 'commands.enable')"
      @update:value="emit('update', { ...command, enabled: $event })"
    />
    <DropdownMenu
      xs
      square
      hide-chevron
      align="right"
      icon="mdi:dots-vertical"
      :title="t('commands.moreActions')"
      :items="menuItems"
    />
  </div>

  <div v-if="expanded" class="command-body">
    <CommandEditor
      :command="command"
      :user-config="userConfig"
      :name-conflicts="nameConflicts"
      @update="emit('update', $event)"
      @navigate="emit('navigate', $event)"
    />
  </div>
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
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import CommandEditor from './CommandEditor.vue'
import { Icon } from '@iconify/vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig: UserConfig
  expanded: boolean
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
const unavailableReason = computed(() =>
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
.command-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-xs);
}

.command-summary {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  text-align: left;
  cursor: pointer;
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
  justify-content: flex-end;
  gap: var(--space-xs);
  max-width: 50%;
}

.command-placements .command-badge {
  cursor: pointer;
}

.command-placements .command-badge:hover {
  background: var(--app-hover);
}

.command-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  color: var(--app-text-muted);
}

.command-badge.is-muted {
  color: var(--app-text-faint);
}

.command-badge.is-warning {
  border-color: transparent;
  color: var(--color-warning);
}

.command-chevron {
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.7;
  transition: transform var(--transition-fast);
}

.command-body {
  padding: var(--space-sm) var(--space-md) var(--space-md)
    calc(var(--space-xs) + 1.25rem + var(--space-xs));
  border-top: 1px solid var(--app-border);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--app-text-faint);
  cursor: grab;
  opacity: 0;
  pointer-events: none;
  /* Touch and pen drags must not scroll the page instead */
  touch-action: none;
  transition:
    color var(--transition-fast),
    opacity var(--transition-fast);
}

.drag-handle:hover {
  color: var(--color-base-content);
}

.enabled-switch {
  margin: 0 var(--space-xs);
}
</style>
