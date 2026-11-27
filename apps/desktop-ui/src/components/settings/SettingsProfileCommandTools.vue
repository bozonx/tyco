<template>
  <SettingsSection
    :title="t('chatTools.commands.group')"
    :info="t('chatTools.commands.groupHint')"
  >
    <template #actions>
      <Badge v-if="!isAvailable" tone="muted">
        {{ t('toolPermissions.sourceOffEverywhere') }}
      </Badge>
      <SegmentedControl
        v-else-if="supportedCommands.length"
        size="sm"
        :label="t('chatTools.commands.group')"
        :model-value="groupState"
        :options="stateOptions"
        @update:model-value="setGroupState($event as ToolState)"
      />
    </template>
    <div
      class="settings-section-content profile-command-tools"
      :class="{ 'opacity-60': isOff }"
      :inert="isOff"
    >
      <!-- Empty state if no commands at all -->
      <div
        v-if="!supportedCommands.length && !unsupportedCommands.length"
        class="profile-command-empty"
      >
        <p class="profile-command-empty-title">
          {{ t('chatTools.commands.noCommands') }}
        </p>
        <p class="profile-command-empty-hint">
          {{ t('chatTools.commands.noCommandsHint') }}
        </p>
      </div>

      <template v-if="supportedCommands.length">
        <div class="profile-command-tools-actions">
          <SegmentedControl
            size="sm"
            :label="t('chatTools.commands.pickMode')"
            :model-value="isPicking ? 'some' : 'all'"
            :options="pickModeOptions"
            @update:model-value="setPicking($event === 'some')"
          />
          <template v-if="isPicking && supportedCommands.length > 1">
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
          </template>
        </div>
        <p class="profile-command-mode-hint">
          {{
            isPicking
              ? t('chatTools.commands.pickSomeHint')
              : t('chatTools.commands.pickAllHint')
          }}
        </p>

        <div class="profile-command-tools-list">
          <div
            v-for="command in supportedCommands"
            :key="command.id"
            class="profile-command-item"
          >
            <div class="profile-command-item-header">
              <FieldCheckbox
                v-if="isPicking"
                :model-value="isPicked(command.id)"
                :label="commandLabel(command)"
                @update:model-value="toggle(command.id, $event)"
              />
              <span v-else class="profile-command-title">
                {{ commandLabel(command) }}
              </span>
              <Badge v-if="command.platforms?.length" tone="muted">
                {{ formatPlatforms(command) }}
              </Badge>
            </div>
            <p v-if="command.description" class="profile-command-description">
              {{ command.description }}
            </p>
          </div>
        </div>
      </template>

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
              <p
                v-if="!hasDescription(command)"
                class="profile-command-warning"
              >
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
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandRiskLookup } from '../../lib/ai-commands/ai-command-config'
import {
  COMMANDS_SOURCE,
  type CatalogTool,
  commandRisk,
  isCommandPicked,
  isSourceAvailable,
  sourceState,
  withPickedCommands,
  withSourceState,
} from '../../lib/chat-tools/tool-catalog'
import { commandLabel } from '../../lib/commands/command-runtime'
import { isOnPlatform } from '../../lib/variables/command-variables'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from './SettingsSection.vue'
import type {
  CommandConfig,
  ProfileToolSettings,
  ToolCatalogSettings,
  ToolState,
} from '@tyco/shared'

/**
 * The commands a profile's chat may run: all of them, new ones too, or only
 * those picked; and whether a run asks first
 */
const props = defineProps<{
  commands: readonly CommandConfig[]
  tools: ProfileToolSettings | undefined
  catalog: ToolCatalogSettings | undefined
  currentPlatform?: string
}>()

const emit = defineEmits<{ update: [tools: ProfileToolSettings] }>()

const { t } = useI18n()

const isUnsupportedOpen = ref(false)

const stateOptions = computed(() => [
  {
    id: 'off',
    name: t('settings.accessOff'),
    title: t('settings.accessOffHint'),
  },
  {
    id: 'ask',
    name: t('settings.accessAsk'),
    title: t('settings.accessAskHint'),
  },
  {
    id: 'allow',
    name: t('settings.accessAllow'),
    title: t('settings.accessAllowHint'),
  },
])

const pickModeOptions = computed(() => [
  { id: 'all', name: t('chatTools.commands.pickAll') },
  { id: 'some', name: t('chatTools.commands.pickSome') },
])

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

const isAvailable = computed(() =>
  isSourceAvailable(props.catalog, COMMANDS_SOURCE)
)

/** The commands as tools, for their policy; every one, picked or not */
const commandTools = computed<CatalogTool[]>(() => {
  const lookup = commandRiskLookup(props.commands)
  return supportedCommands.value.map((command) => ({
    source: COMMANDS_SOURCE,
    name: command.id,
    risk: commandRisk(command, lookup),
  }))
})

/** The policy of the commands, whichever are picked */
const groupState = computed(() =>
  sourceState(
    props.catalog,
    withPickedCommands(props.tools, undefined),
    commandTools.value
  )
)

const isOff = computed(() => !isAvailable.value || groupState.value === 'off')

function setGroupState(state: ToolState) {
  const updated = withSourceState(props.tools, commandTools.value, state)
  if (updated) emit('update', updated)
}

const isPicking = computed(() => Boolean(props.tools?.pickedCommandIds))
const isPicked = (commandId: string) => isCommandPicked(props.tools, commandId)

/**
 * The ids of commands that still exist: a removed command leaves its id in the
 * profile, which is a file of its own, until the list is changed
 */
const existingPickedIds = () => {
  const ids = new Set(props.commands.map((command) => command.id))
  return (props.tools?.pickedCommandIds ?? []).filter((id) => ids.has(id))
}

const pick = (commandIds: readonly string[] | undefined) =>
  emit('update', withPickedCommands(props.tools, commandIds))

/** Picking starts from what is offered now: every command */
function setPicking(isOn: boolean) {
  if (isOn === isPicking.value) return
  pick(isOn ? supportedCommands.value.map((command) => command.id) : undefined)
}

function toggle(commandId: string, isOn: boolean) {
  const others = existingPickedIds().filter((id) => id !== commandId)
  pick(isOn ? [...others, commandId] : others)
}

const allSelected = computed(() =>
  supportedCommands.value.every((command) => isPicked(command.id))
)
const noneSelected = computed(
  () => !supportedCommands.value.some((command) => isPicked(command.id))
)

function selectAll() {
  pick([
    ...new Set([
      ...existingPickedIds(),
      ...supportedCommands.value.map((command) => command.id),
    ]),
  ])
}

function deselectAll() {
  const supported = new Set(supportedCommands.value.map((c) => c.id))
  pick(existingPickedIds().filter((id) => !supported.has(id)))
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

.profile-command-title {
  font-size: var(--text-body);
}

.profile-command-mode-hint {
  margin: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
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
