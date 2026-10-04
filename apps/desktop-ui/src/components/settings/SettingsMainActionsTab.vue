<template>
  <SettingsSection :description="t('settings.mainActionsHint')" bare>
    <ShortcutSlots
      :items="actionSlots"
      @move="moveAction"
      @add="addAction"
      @remove="removeAction"
    >
      <template #item="{ item, index }">
        <div class="flex flex-col gap-2 w-full">
          <FieldSelect
            class="w-full"
            :value="optionId(item)"
            :options="actionOptions"
            @update:value="updateAction(index, $event)"
          />

          <CustomActionFields
            v-if="item.type === 'script' || item.type === 'webhook'"
            :key="item.id"
            :item="item"
            @update="(field, value) => updateCustomField(index, field, value)"
          />
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { normalizeMainActions } from '../../lib/action-menu/main-actions'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { useActionMenuStore } from '../../stores/actionMenu'
import { useLlmStore } from '../../stores/llm'
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import CustomActionFields from './CustomActionFields.vue'
import {
  type MainActionConfig,
  STANDARD_ACTION_IDS,
  type UserConfig,
  webhookSecretId,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
}>()

const { t } = useI18n()
const actionMenuStore = useActionMenuStore()
const llmStore = useLlmStore()

const actionSlots = computed(() =>
  normalizeMainActions(props.userConfig.mainActions)
)

const optionId = (item: MainActionConfig | null | undefined): string => {
  if (!item) return ''
  if (item.type === 'standard' || item.type === 'plugin') {
    return `${item.type}:${item.actionId}`
  }
  return `custom:${item.type}`
}

const availableActions = computed(() => [
  ...STANDARD_ACTION_IDS.map((actionId) => ({
    config: { type: 'standard' as const, actionId },
    name: t(`action.${actionId}`),
  })),
  ...actionMenuStore
    .getRegisteredActions()
    .flatMap((action) =>
      action.id
        ? [
            {
              config: { type: 'plugin' as const, actionId: action.id },
              name: action.labelKey
                ? t(action.labelKey)
                : (action.name ?? action.id),
            },
          ]
        : []
    ),
])

const actionOptions = computed(() => {
  const options = [
    ...availableActions.value.map(({ config, name }) => ({
      id: optionId(config),
      name,
    })),
    { id: 'custom:script', name: t('action.script') },
    { id: 'custom:webhook', name: t('action.webhook') },
  ]
  for (const slot of actionSlots.value) {
    if (slot && !options.some((option) => option.id === optionId(slot))) {
      options.push({
        id: optionId(slot),
        name: 'actionId' in slot ? slot.actionId : slot.name || slot.type,
      })
    }
  }
  return options
})

function moveAction(from: number, to: number) {
  emit('update:mainActions', moveShortcutSlot(actionSlots.value, from, to))
}

function addAction(index: number) {
  const slots = [...actionSlots.value]
  slots[index] = { type: 'standard', actionId: STANDARD_ACTION_IDS[0] }
  emit('update:mainActions', slots)
}

function newActionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `action-${Date.now()}`
}

/** The slot's webhook token goes with it */
function forgetSlot(index: number) {
  const current = actionSlots.value[index]
  if (current?.type === 'webhook' && current.authSecret) {
    llmStore.removeSecret(webhookSecretId(current.id)).catch(() => {
      // a leftover token is bound to its origin and harmless
    })
  }
}

function setSlot(index: number, value: MainActionConfig | null) {
  forgetSlot(index)
  const slots = [...actionSlots.value]
  slots[index] = value
  emit('update:mainActions', slots)
}

function removeAction(index: number) {
  setSlot(index, null)
}

function updateAction(index: number, value: string | number | undefined) {
  if (value === optionId(actionSlots.value[index])) return

  if (value === 'custom:script') {
    setSlot(index, {
      type: 'script',
      id: newActionId(),
      name: '',
      command: '',
      workingDir: '',
      afterRun: 'none',
      logOutput: false,
    })
    return
  }

  if (value === 'custom:webhook') {
    setSlot(index, {
      type: 'webhook',
      id: newActionId(),
      name: '',
      url: '',
      method: 'POST',
      headers: {},
      payloadTemplate: '',
      authSecret: false,
      afterRun: 'none',
      logOutput: false,
    })
    return
  }

  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (selected) setSlot(index, selected.config)
}

function updateCustomField(index: number, field: string, value: unknown) {
  const current = actionSlots.value[index]
  if (!current || (current.type !== 'script' && current.type !== 'webhook'))
    return
  const slots = [...actionSlots.value]
  slots[index] = { ...current, [field]: value } as MainActionConfig
  emit('update:mainActions', slots)
}
</script>
