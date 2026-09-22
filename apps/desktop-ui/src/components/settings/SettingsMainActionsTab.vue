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
          :value="item.actionId"
          :options="standardActionOptions"
          @update:value="updateAction(index, $event)"
        />
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  isStandardActionId,
  normalizeMainActions,
} from '../../lib/action-menu/main-actions'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
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

const actionSlots = computed(() =>
  normalizeMainActions(props.userConfig.mainActions)
)

const standardActionOptions = computed(() =>
  STANDARD_ACTION_IDS.map((actionId) => ({
    id: actionId,
    name: t(`action.${actionId}`),
  }))
)

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
  if (!isStandardActionId(value)) return
  const slots = [...actionSlots.value]
  slots[index] = { type: 'standard', actionId: value }
  emit('update:mainActions', slots)
}
</script>
