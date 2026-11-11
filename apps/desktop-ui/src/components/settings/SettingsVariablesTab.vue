<template>
  <div class="settings-stack">
    <SettingsSection :title="t('variables.listTitle')">
      <template #info>
        <InfoPopover
          :aria-label="t('common.info')"
          placement="bottom"
          align="start"
          panel-class="panel-wide"
        >
          <div class="variables-popover-content">
            <p class="variables-popover-hint">
              {{
                t('variables.hint', { example: variablePlaceholder('NAME') })
              }}
            </p>

            <div class="variables-popover-notice">
              <AppIcon
                icon="mdi:shield-alert-outline"
                size="sm"
                class="variables-popover-notice-icon"
              />
              <span class="variables-popover-notice-text">
                {{ t('variables.notForSecrets') }}
              </span>
            </div>

            <div class="variables-popover-builtins">
              <div class="variables-popover-builtins-title">
                {{ t('variables.builtinTitle') }}
              </div>
              <p class="variables-popover-builtins-hint">
                {{ t('variables.builtinHint') }}
              </p>

              <div class="variables-popover-builtins-list">
                <div
                  v-for="item in builtins"
                  :key="item.name"
                  class="variables-popover-builtin-item"
                >
                  <div class="variables-popover-builtin-row">
                    <code class="variables-popover-builtin-name">{{
                      variablePlaceholder(item.name)
                    }}</code>
                    <CopyButton
                      v-if="item.name"
                      :value="variablePlaceholder(item.name)"
                      :label="t('common.copy')"
                      size="xs"
                    />
                  </div>
                  <span class="variables-popover-builtin-value">{{
                    item.value
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </InfoPopover>
      </template>

      <template #actions>
        <Button
          variant="primary"
          class="add-btn"
          size="sm"
          icon="mdi:plus"
          @click="handleCreateVariable"
        >
          {{ t('variables.create') }}
        </Button>
      </template>

      <div class="variables-tab">
        <ConfirmModal
          :open="Boolean(pendingRemoval)"
          danger
          :title="t('variables.removeConfirmTitle')"
          :message="
            t('variables.removeConfirmMessage', {
              name: pendingRemoval?.name ?? '',
              count: pendingRemoval?.usageCount ?? 0,
            })
          "
          :confirm-text="t('variables.remove')"
          @confirm="confirmRemove"
          @cancel="pendingRemoval = undefined"
        />

        <InlineNotice
          v-if="unsetCount"
          class="variables-notice"
          kind="warning"
          appearance="surface"
          icon="mdi:alert-outline"
          :message="t('variables.unsetOnDevice', { count: unsetCount })"
        />

        <p v-if="!variables.length" class="variables-empty">
          {{ t('variables.empty') }}
        </p>

        <div ref="listRef" class="variables-list">
          <div
            v-for="(variable, index) in variables"
            :key="variable.id"
            :ref="(el) => setItemRef(variable.id, el)"
            data-sortable-item
            class="variable-card"
            :class="{
              'is-sorting': isSorting,
              'is-dragged': draggedIndex === index,
              'is-new': newlyCreatedId === variable.id,
            }"
            :style="itemStyle(index)"
            :data-testid="`variable-${variable.id}`"
            @animationend="onAnimationEnd(variable.id)"
          >
            <div class="variable-card-drag">
              <DragHandle @drag="startDrag(index, $event)" />
            </div>

            <div class="variable-card-content">
              <div class="variable-card-header">
                <div class="variable-card-header-main">
                  <div class="variable-name-row">
                    <FieldInput
                      :ref="(el) => setNameInputRef(variable.id, el)"
                      :model-value="nameDrafts[variable.id] ?? variable.name"
                      class="font-mono variable-name-input"
                      :placeholder="t('variables.name')"
                      :aria-label="t('variables.name')"
                      :title="t('variables.nameHint')"
                      size="sm"
                      @update:model-value="
                        setNameDraft(variable.id, String($event))
                      "
                      @blur="commitName(variable.id)"
                      @keydown.enter="commitName(variable.id)"
                    />
                    <div class="variable-usage">
                      <span>{{ usageText(variable.name) }}</span>
                    </div>
                  </div>
                  <span
                    v-if="nameErrors[variable.id]"
                    class="variable-name-error"
                  >
                    {{ nameErrors[variable.id] }}
                  </span>
                </div>
                <IconButton
                  icon="mdi:trash-can-outline"
                  variant="ghost"
                  size="sm"
                  :label="t('variables.remove')"
                  :title="t('variables.remove')"
                  @click="requestRemove(variable.id)"
                />
              </div>

              <div class="variable-value-section">
                <div class="variable-value-header">
                  <div class="variable-value-meta">
                    <span class="variable-value-label">{{
                      t('variables.value')
                    }}</span>
                    <span
                      v-if="!draft.variableValues[variable.id]?.trim()"
                      class="variable-value-warning"
                    >
                      {{ t('variables.valueNotSet') }}
                    </span>
                  </div>
                  <DropdownMenu
                    size="xs"
                    align="right"
                    icon="mdi:folder-search-outline"
                    :label="t('variables.browse')"
                    :items="browseItems(variable.id)"
                  />
                </div>
                <FieldPromptTextArea
                  :ref="(el) => setValueRef(variable.id, el)"
                  class="variable-value-field"
                  :model-value="draft.variableValues[variable.id] ?? ''"
                  :placeholder="t('variables.valuePlaceholder')"
                  :modal-title="variable.name"
                  :rows="2"
                  auto-resize
                  :data-testid="`variable-value-${variable.id}`"
                  @update:model-value="
                    setVariableValue(draft, variable.id, $event)
                  "
                />
              </div>
              <VariableReferenceHints
                v-if="draft.variableValues[variable.id]?.trim()"
                :templates="[variablePlaceholder(variable.name)]"
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSortableList } from '../../composables/use-sortable-list'
import { moveItem } from '../../lib/sortable/sortable-list'
import { variableUsage } from '../../lib/variables/command-variables'
import {
  addVariable,
  removeVariable,
  renameVariableIn,
  setVariableValue,
  unsetVariables,
} from '../../lib/variables/variables-settings'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import CopyButton from '../common/CopyButton.vue'
import DragHandle from '../common/DragHandle.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import IconButton from '../common/IconButton.vue'
import InfoPopover from '../common/InfoPopover.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsSection from './SettingsSection.vue'
import VariableReferenceHints from './VariableReferenceHints.vue'
import { type VariableConfig, variablePlaceholder } from '@tyco/shared'

/** `focusVariableId` opens the tab on the value of that variable */
const props = defineProps<{ focusVariableId?: string }>()

const { t } = useI18n()
const { draft } = useSettingsContext()
const desktop = useDesktopStore()
const ipc = useIpcStore()

const variables = computed(() => draft.value.variables)
const unsetCount = computed(() => unsetVariables(draft.value).length)

const listRef = ref<HTMLElement | null>(null)
const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  moveVariable,
  { getItemKeys: () => variables.value.map((v) => v.id) }
)

function moveVariable(from: number, to: number) {
  draft.value.variables = moveItem(draft.value.variables, from, to)
}

const itemStyle = (index: number) => {
  const offset = itemOffset(index)
  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

const newlyCreatedId = ref<string | null>(null)

function onAnimationEnd(id: string) {
  if (newlyCreatedId.value === id) {
    newlyCreatedId.value = null
  }
}

function nextVariableName(
  existingVariables: readonly VariableConfig[]
): string {
  const taken = new Set(existingVariables.map((v) => v.name.toUpperCase()))
  if (!taken.has('VAR')) return 'VAR'
  for (let i = 1; ; i += 1) {
    const candidate = `VAR_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

async function handleCreateVariable() {
  const name = nextVariableName(draft.value.variables)
  const result = addVariable(draft.value, name)
  if (!result.ok) return
  newlyCreatedId.value = result.variable.id
  await nextTick()
  const nameInput = nameInputRefs.get(result.variable.id)
  nameInput?.focus?.()
  nameInput?.select?.()
}

/** Names being typed: a rename is applied when the field is left */
const nameDrafts = reactive<Record<string, string>>({})
const nameErrors = reactive<Record<string, string>>({})

function setNameDraft(id: string, name: string) {
  nameDrafts[id] = name
  delete nameErrors[id]
}

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

/** The variable about to be removed while commands still use it */
const pendingRemoval = ref<{ id: string; name: string; usageCount: number }>()

function usageCountOf(name: string): number {
  const usage = variableUsage(draft.value, name)
  return (
    usage.commandIds.length +
    usage.providerIds.length +
    usage.variableIds.length
  )
}

/** Removes at once a variable nothing uses; asks first otherwise */
function requestRemove(id: string) {
  const variable = draft.value.variables.find((item) => item.id === id)
  if (!variable) return
  const usageCount = usageCountOf(variable.name)
  if (!usageCount) return remove(id)
  pendingRemoval.value = { id, name: variable.name, usageCount }
}

function confirmRemove() {
  if (pendingRemoval.value) remove(pendingRemoval.value.id)
  pendingRemoval.value = undefined
}

const itemRefs = new Map<string, HTMLElement>()
function setItemRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) itemRefs.set(id, el)
  else itemRefs.delete(id)
}

const nameInputRefs = new Map<
  string,
  { focus?: () => void; select?: () => void }
>()
function setNameInputRef(id: string, el: unknown) {
  if (el)
    nameInputRefs.set(id, el as { focus?: () => void; select?: () => void })
  else nameInputRefs.delete(id)
}

const valueRefs = new Map<string, { focus?: () => void; $el?: Element }>()
function setValueRef(id: string, el: unknown) {
  if (el) valueRefs.set(id, el as { focus?: () => void; $el?: Element })
  else valueRefs.delete(id)
}

onMounted(async () => {
  if (!props.focusVariableId) return
  await nextTick()
  const field = valueRefs.get(props.focusVariableId)
  field?.$el?.scrollIntoView?.({ block: 'center' })
  field?.focus?.()
})

async function pick(
  variableId: string,
  command: 'pick_directory' | 'pick_file'
) {
  const result = await ipc.callOrNotify(command)
  if (typeof result.result === 'string')
    setVariableValue(draft.value, variableId, result.result)
}

function browseItems(variableId: string): DropdownMenuItem[] {
  return [
    {
      label: t('variables.browseFolder'),
      icon: 'mdi:folder-outline',
      action: () => pick(variableId, 'pick_directory'),
    },
    {
      label: t('variables.browseFile'),
      icon: 'mdi:file-outline',
      action: () => pick(variableId, 'pick_file'),
    },
  ]
}

function usageText(name: string): string {
  const count = usageCountOf(name)
  return count ? t('variables.usedBy', { count }) : t('variables.unused')
}

const builtins = computed(() => [
  { name: 'TYCO_USER_DIR', value: desktop.userData?.path ?? '' },
  { name: 'TYCO_DEVICE_ID', value: desktop.userData?.deviceId ?? '' },
])
</script>

<style scoped>
.variables-popover-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  white-space: normal;
  color: var(--color-base-content);
}

.variables-popover-hint {
  margin: 0;
  font-size: var(--text-caption);
  line-height: var(--leading-normal);
}

.variables-popover-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-sunken);
  font-size: var(--text-small);
  color: var(--app-text-muted);
  line-height: var(--leading-normal);
}

.variables-popover-notice-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-warning, #f59e0b);
}

.variables-popover-builtins {
  display: flex;
  flex-direction: column;
  gap: var(--space-xxs);
  border-top: 1px solid var(--app-border);
  padding-top: var(--space-xs);
}

.variables-popover-builtins-title {
  font-weight: 600;
  font-size: var(--text-caption);
}

.variables-popover-builtins-hint {
  margin: 0;
  font-size: var(--text-small);
  color: var(--app-text-muted);
}

.variables-popover-builtins-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-xxs);
}

.variables-popover-builtin-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-xs);
  background: var(--app-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--app-border);
}

.variables-popover-builtin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
}

.variables-popover-builtin-name {
  font-family: var(--font-mono);
  font-size: var(--text-small);
  font-weight: 600;
  color: var(--color-primary);
}

.variables-popover-builtin-value {
  font-size: var(--text-small);
  color: var(--app-text-muted);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.variables-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.variables-notice {
  margin: var(--space-md);
  margin-bottom: 0;
}

.variables-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
}

.variable-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast),
    opacity var(--transition-fast);
}

.variable-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.variable-card.is-dragged {
  position: relative;
  z-index: 10;
  box-shadow: var(--app-shadow-lg);
  border-color: var(--color-primary);
  background-color: var(--app-surface-elevated, var(--app-surface-raised));
  transition: none;
}

.variable-card.is-new {
  animation: variable-card-created 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes variable-card-created {
  0% {
    opacity: 0;
    transform: translateY(-10px) scale(0.98);
    border-color: var(--color-primary);
    box-shadow: 0 0 0 4px
      color-mix(in oklab, var(--color-primary) 35%, transparent);
  }
  50% {
    opacity: 1;
    transform: translateY(0) scale(1);
    border-color: var(--color-primary);
    box-shadow: 0 0 0 4px
      color-mix(in oklab, var(--color-primary) 25%, transparent);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    border-color: var(--app-border-subtle);
    box-shadow: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .variable-card.is-new {
    animation: none;
  }
}

.variable-card-drag {
  padding-top: var(--space-xs);
  flex-shrink: 0;
}

.variable-card-content {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.variable-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
}

.variable-card-header-main {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.variable-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.variable-name-input {
  max-width: 16rem;
  font-weight: 600;
}

.variable-name-error {
  color: var(--color-error);
  font-size: var(--text-caption);
  line-height: var(--leading-normal);
}

.variable-usage {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--app-text-muted);
  font-size: var(--text-small);
}

.variable-value-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.variable-value-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.variable-value-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.variable-value-label {
  font-size: var(--text-small);
  font-weight: 600;
  color: var(--color-base-content);
}

.variable-value-warning {
  font-size: var(--text-caption);
  color: var(--color-warning, #f59e0b);
}

.variable-value-field {
  width: 100%;
}

.variables-empty {
  color: var(--app-text-muted);
  font-size: var(--text-small);
  padding: var(--space-md);
  margin: 0;
}
</style>
