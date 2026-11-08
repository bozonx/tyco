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
          :aria-expanded="isCreateModalOpen"
          @click="isCreateModalOpen = true"
        >
          {{ t('variables.create') }}
        </Button>
      </template>

      <div class="variables-tab">
        <SettingsCreateVariableModal
          :open="isCreateModalOpen"
          @close="isCreateModalOpen = false"
        />

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

        <div
          v-for="variable in variables"
          :key="variable.id"
          class="variable-row"
          :data-testid="`variable-${variable.id}`"
        >
          <div class="variable-row-head">
            <FieldRow
              :label="t('variables.name')"
              density="compact"
              :error="nameErrors[variable.id]"
            >
              <FieldInput
                :model-value="nameDrafts[variable.id] ?? variable.name"
                class="font-mono"
                @update:model-value="nameDrafts[variable.id] = String($event)"
                @blur="commitName(variable.id)"
                @keydown.enter="commitName(variable.id)"
              />
            </FieldRow>
            <IconButton
              icon="mdi:delete-outline"
              variant="ghost"
              :label="t('variables.remove')"
              @click="requestRemove(variable.id)"
            />
          </div>
          <FieldRow :label="t('variables.description')" density="compact">
            <FieldInput
              :model-value="variable.description"
              @update:model-value="
                setVariableDescription(draft, variable.id, String($event))
              "
            />
          </FieldRow>
          <FieldRow
            :label="t('variables.value')"
            density="compact"
            :warning="
              draft.variableValues[variable.id]?.trim()
                ? undefined
                : t('variables.valueNotSet')
            "
          >
            <template #info><DeviceScopeBadge /></template>
            <VariableValueInput
              :ref="(el) => setValueRef(variable.id, el)"
              :model-value="draft.variableValues[variable.id] ?? ''"
              :test-id="`variable-value-${variable.id}`"
              @update:model-value="setVariableValue(draft, variable.id, $event)"
            />
          </FieldRow>
          <p class="variable-usage">
            <code>{{ variablePlaceholder(variable.name) }}</code>
            · {{ usageText(variable.name) }}
          </p>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import {
  type ComponentPublicInstance,
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
} from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { variableUsage } from '../../lib/variables/command-variables'
import {
  removeVariable,
  renameVariableIn,
  setVariableDescription,
  setVariableValue,
  unsetVariables,
} from '../../lib/variables/variables-settings'
import { useDesktopStore } from '../../stores/desktop'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import CopyButton from '../common/CopyButton.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InfoPopover from '../common/InfoPopover.vue'
import InlineNotice from '../common/InlineNotice.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import SettingsCreateVariableModal from './SettingsCreateVariableModal.vue'
import SettingsSection from './SettingsSection.vue'
import VariableValueInput from './VariableValueInput.vue'
import { variablePlaceholder } from '@tyco/shared'

/** `focusVariableId` opens the tab on the value of that variable */
const props = defineProps<{ focusVariableId?: string }>()

const { t } = useI18n()
const { draft } = useSettingsContext()
const desktop = useDesktopStore()

const isCreateModalOpen = ref(false)

const variables = computed(() => draft.value.variables)
const unsetCount = computed(() => unsetVariables(draft.value).length)

/** Names being typed: a rename is applied when the field is left */
const nameDrafts = reactive<Record<string, string>>({})
const nameErrors = reactive<Record<string, string>>({})

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
  return usage.commandIds.length + usage.providerIds.length
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

const valueRefs = new Map<string, { focus?: () => void; $el?: Element }>()

function setValueRef(id: string, el: Element | ComponentPublicInstance | null) {
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

.variables-notice {
  margin: var(--space-md);
  margin-bottom: 0;
}

.variable-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
}

.variable-row + .variable-row {
  border-top: 1px solid var(--app-border);
}

.variable-row-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
}

.variable-row-head > :first-child {
  flex: 1;
  min-width: 0;
}

.variable-usage {
  color: var(--app-text-muted);
  font-size: var(--text-small);
}

.variables-empty {
  color: var(--app-text-muted);
  font-size: var(--text-small);
  padding: var(--space-md);
  margin: 0;
}
</style>
