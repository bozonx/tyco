<template>
  <div class="profile-command-tools">
    <div v-if="commands.length" class="profile-command-tools-list">
      <div
        v-for="command in commands"
        :key="command.id"
        class="profile-command-item"
        :class="{ 'profile-command-disabled': !hasDescription(command) }"
      >
        <FieldCheckbox
          :model-value="
            hasDescription(command) && selectedIds.includes(command.id)
          "
          :label="commandLabel(command)"
          :disabled="!hasDescription(command)"
          @update:model-value="emit('toggle', command.id, $event)"
        />
        <p v-if="hasDescription(command)" class="profile-command-description">
          {{ command.description }}
        </p>
        <p v-else class="profile-command-warning">
          {{ t('chatTools.commands.needsDescription') }}
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
import { useI18n } from '../../composables/use-i18n'
import { commandLabel } from '../../lib/commands/command-runtime'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import type { CommandConfig } from '@tyco/shared'

defineProps<{
  commands: readonly CommandConfig[]
  selectedIds: readonly string[]
}>()

const emit = defineEmits<{ toggle: [commandId: string, enabled: boolean] }>()

const { t } = useI18n()

function hasDescription(command: CommandConfig): boolean {
  return Boolean(command.description?.trim())
}
</script>

<style scoped>
.profile-command-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding-block: var(--space-xs);
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
