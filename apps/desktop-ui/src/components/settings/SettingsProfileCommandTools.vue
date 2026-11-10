<template>
  <div class="profile-command-tools">
    <div
      v-if="selectableCommands.length > 1"
      class="profile-command-tools-actions"
    >
      <Button
        size="xs"
        variant="ghost"
        :disabled="allSelected"
        @click="selectAll"
      >
        {{ t('chatTools.commands.selectAll') }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="noneSelected"
        @click="deselectAll"
      >
        {{ t('chatTools.commands.deselectAll') }}
      </Button>
    </div>

    <div v-if="commands.length" class="profile-command-tools-list">
      <div
        v-for="command in commands"
        :key="command.id"
        class="profile-command-item"
        :class="{ 'profile-command-disabled': !hasDescription(command) }"
      >
        <div class="profile-command-item-header">
          <FieldCheckbox
            :model-value="
              hasDescription(command) && selectedIds.includes(command.id)
            "
            :label="commandLabel(command)"
            :disabled="!hasDescription(command)"
            @update:model-value="emit('toggle', command.id, $event)"
          />
          <Badge
            v-if="command.platforms?.length"
            :tone="isCurrentPlatform(command) ? 'muted' : 'warning'"
          >
            {{ formatPlatforms(command) }}
          </Badge>
        </div>
        <p v-if="hasDescription(command)" class="profile-command-description">
          {{ command.description }}
        </p>
        <p v-else class="profile-command-warning">
          {{ t('chatTools.commands.needsDescription') }}
        </p>
        <p
          v-if="currentPlatform && !isCurrentPlatform(command)"
          class="profile-command-platform-notice"
        >
          {{ t('commands.otherPlatform') }}
        </p>
      </div>
    </div>
    <div v-else class="profile-command-empty">
      <p class="profile-command-empty-title">
        {{ t('chatTools.commands.noCommands') }}
      </p>
      <p class="profile-command-empty-hint">
        {{ t('chatTools.commands.noCommandsHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandLabel } from '../../lib/commands/command-runtime'
import { isOnPlatform } from '../../lib/variables/command-variables'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{
  commands: readonly CommandConfig[]
  selectedIds: readonly string[]
  currentPlatform?: string
}>()

const emit = defineEmits<{
  toggle: [commandId: string, enabled: boolean]
  updateSelected: [selectedIds: string[]]
}>()

const { t } = useI18n()

function hasDescription(command: CommandConfig): boolean {
  return Boolean(command.description?.trim())
}

function isCurrentPlatform(command: CommandConfig): boolean {
  return isOnPlatform(command.platforms, props.currentPlatform ?? '')
}

function formatPlatforms(command: CommandConfig): string {
  if (!command.platforms?.length) return ''
  return command.platforms
    .map((p) => (p === 'linux' ? 'Linux' : p === 'windows' ? 'Windows' : p))
    .join(', ')
}

const selectableCommands = computed(() => props.commands.filter(hasDescription))

const allSelected = computed(
  () =>
    selectableCommands.value.length > 0 &&
    selectableCommands.value.every((cmd) => props.selectedIds.includes(cmd.id))
)

const noneSelected = computed(
  () =>
    props.selectedIds.length === 0 ||
    !props.commands.some((cmd) => props.selectedIds.includes(cmd.id))
)

function selectAll() {
  const newSelected = Array.from(
    new Set([
      ...props.selectedIds,
      ...selectableCommands.value.map((c) => c.id),
    ])
  )
  emit('updateSelected', newSelected)
}

function deselectAll() {
  const commandIdSet = new Set(props.commands.map((c) => c.id))
  const newSelected = props.selectedIds.filter((id) => !commandIdSet.has(id))
  emit('updateSelected', newSelected)
}
</script>

<style scoped>
.profile-command-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-block: var(--space-xs);
}

.profile-command-tools-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.profile-command-tools-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.profile-command-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-panel);
  border: 1px solid var(--app-border-subtle);
}

.profile-command-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.profile-command-disabled {
  opacity: 0.65;
}

.profile-command-description {
  font-size: var(--text-xs);
  color: var(--app-text-muted);
  margin-inline-start: var(--space-lg);
}

.profile-command-warning {
  font-size: var(--text-xs);
  color: var(--app-warning);
  margin-inline-start: var(--space-lg);
}

.profile-command-platform-notice {
  font-size: var(--text-xs);
  color: var(--app-text-subtle);
  margin-inline-start: var(--space-lg);
}

.profile-command-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-sm);
  color: var(--app-text-muted);
  font-size: var(--text-sm);
}

.profile-command-empty-hint {
  font-size: var(--text-xs);
  color: var(--app-text-subtle);
}
</style>
