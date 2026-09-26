<template>
  <SettingsSection :description="t('settings.mainActionsHint')" bare>
    <ShortcutSlots
      :items="actionSlots"
      @move="moveAction"
      @add="addAction"
      @remove="removeAction"
    >
      <template #item="{ item, index }">
        <FieldSelect
          class="w-full"
          :value="optionId(item)"
          :options="actionOptions"
          @update:value="updateAction(index, $event)"
        />
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
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import {
  type MainActionConfig,
  STANDARD_ACTION_IDS,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
}>()

const { t } = useI18n()
const actionMenuStore = useActionMenuStore()

const actionSlots = computed(() =>
  normalizeMainActions(props.userConfig.mainActions)
)

const optionId = (item: MainActionConfig) => `${item.type}:${item.actionId}`

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
  const options = availableActions.value.map(({ config, name }) => ({
    id: optionId(config),
    name,
  }))
  for (const slot of actionSlots.value) {
    if (slot && !options.some((option) => option.id === optionId(slot))) {
      options.push({ id: optionId(slot), name: slot.actionId })
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

function removeAction(index: number) {
  const slots = [...actionSlots.value]
  slots[index] = null
  emit('update:mainActions', slots)
}

function updateAction(index: number, value: string | number | undefined) {
  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (!selected) return
  const slots = [...actionSlots.value]
  slots[index] = selected.config
  emit('update:mainActions', slots)
}
</script>
