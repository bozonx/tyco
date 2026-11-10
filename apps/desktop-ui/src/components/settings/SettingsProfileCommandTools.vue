<template>
  <div class="profile-command-tools">
    <div
      v-if="supportedCommands.length > 1"
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

    <!-- Supported commands -->
    <div v-if="supportedCommands.length" class="profile-command-tools-list">
      <div
        v-for="command in supportedCommands"
        :key="command.id"
        class="profile-command-item"
      >
        <div class="profile-command-item-header">
          <FieldCheckbox
            :model-value="selectedIds.includes(command.id)"
            :label="commandLabel(command)"
            @update:model-value="emit('toggle', command.id, $event)"
          />
          <Badge v-if="command.platforms?.length" tone="muted">
            {{ formatPlatforms(command) }}
          </Badge>
        </div>
        <p v-if="command.description" class="profile-command-description">
          {{ command.description }}
        </p>
      </div>
    </div>

    <!-- Empty state if no commands at all -->
    <div v-else-if="!unsupportedCommands.length" class="profile-command-empty">
      <p class="profile-command-empty-title">
        {{ t('chatTools.commands.noCommands') }}
      </p>
      <p class="profile-command-empty-hint">
        {{ t('chatTools.commands.noCommandsHint') }}
      </p>
    </div>

    <!-- Unsupported commands section -->
    <div
      v-if="unsupportedCommands.length"
      class="profile-command-unsupported-section"
    >
      <Button
        size="xs"
        variant="ghost"
        :icon="isUnsupportedOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'"
        class="profile-command-unsupported-btn"
        @click="isUnsupportedOpen = !isUnsupportedOpen"
      >
        {{ t('chatTools.commands.unsupportedCommands') }} ({{
          unsupportedCommands.length
        }})
      </Button>

      <div v-if="isUnsupportedOpen" class="profile-command-unsupported-list">
        <div
          v-for="command in unsupportedCommands"
          :key="command.id"
          class="profile-command-unsupported-item"
        >
          <div class="profile-command-item-header">
            <span class="profile-command-unsupported-title">
              {{ commandLabel(command) }}
            </span>
            <Badge
              v-if="command.platforms?.length"
              :tone="isCurrentPlatform(command) ? 'muted' : 'warning'"
            >
              {{ formatPlatforms(command) }}
            </Badge>
          </div>

          <div class="profile-command-reasons">
            <p v-if="!hasDescription(command)" class="profile-command-warning">
              <AppIcon
                icon="mdi:alert-circle-outline"
                size="xs"
                aria-hidden="true"
              />
              {{ t('chatTools.commands.needsDescription') }}
            </p>
            <p
              v-if="currentPlatform && !isCurrentPlatform(command)"
              class="profile-command-platform-notice"
            >
              <AppIcon icon="mdi:laptop-off" size="xs" aria-hidden="true" />
              {{ t('commands.otherPlatform') }}
            </p>
            <p v-if="command.description" class="profile-command-description">
              {{ command.description }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandLabel } from '../../lib/commands/command-runtime'
import { isOnPlatform } from '../../lib/variables/command-variables'
import AppIcon from '../common/AppIcon.vue'
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

const isUnsupportedOpen = ref(false)

function hasDescription(command: CommandConfig): boolean {
  return Boolean(command.description?.trim())
}

function isCurrentPlatform(command: CommandConfig): boolean {
  return isOnPlatform(command.platforms, props.currentPlatform ?? '')
}

function isSupported(command: CommandConfig): boolean {
  return hasDescription(command) && isCurrentPlatform(command)
}

function formatPlatforms(command: CommandConfig): string {
  if (!command.platforms?.length) return ''
  return command.platforms
    .map((p) => (p === 'linux' ? 'Linux' : p === 'windows' ? 'Windows' : p))
    .join(', ')
}

const supportedCommands = computed(() => props.commands.filter(isSupported))
const unsupportedCommands = computed(() =>
  props.commands.filter((cmd) => !isSupported(cmd))
)

const allSelected = computed(
  () =>
    supportedCommands.value.length > 0 &&
    supportedCommands.value.every((cmd) => props.selectedIds.includes(cmd.id))
)

const noneSelected = computed(
  () =>
    props.selectedIds.length === 0 ||
    !supportedCommands.value.some((cmd) => props.selectedIds.includes(cmd.id))
)

function selectAll() {
  const newSelected = Array.from(
    new Set([...props.selectedIds, ...supportedCommands.value.map((c) => c.id)])
  )
  emit('updateSelected', newSelected)
}

function deselectAll() {
  const commandIdSet = new Set(supportedCommands.value.map((c) => c.id))
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

.profile-command-tools-list,
.profile-command-unsupported-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  overflow: hidden;
}

.profile-command-unsupported-list {
  background-color: var(--app-surface-default);
  opacity: 0.9;
}

.profile-command-item,
.profile-command-unsupported-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  transition: background-color var(--transition-fast);
}

.profile-command-item:last-child,
.profile-command-unsupported-item:last-child {
  border-bottom: none;
}

.profile-command-item:hover {
  background-color: var(--app-hover);
}

.profile-command-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.profile-command-unsupported-title {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--app-text-muted);
}

.profile-command-description {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  margin: 0;
  margin-inline-start: var(--space-lg);
}

.profile-command-unsupported-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.profile-command-unsupported-btn {
  align-self: flex-start;
  color: var(--app-text-muted);
}

.profile-command-unsupported-btn:hover {
  color: var(--app-text);
}

.profile-command-reasons {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-inline-start: var(--space-xs);
}

.profile-command-warning {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-caption);
  color: var(--color-warning);
  margin: 0;
}

.profile-command-platform-notice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-caption);
  color: var(--app-text-subtle);
  margin: 0;
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
  font-size: var(--text-caption);
  color: var(--app-text-subtle);
}
</style>
