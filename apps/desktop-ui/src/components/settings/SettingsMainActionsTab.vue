<template>
  <SettingsSection :description="t('settings.actionsHint')" bare>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Button
        v-for="(_, index) in actionPages"
        :key="index"
        size="sm"
        :variant="page === index ? 'primary' : 'neutral'"
        class="min-w-8"
        :title="t('settings.actionPage', { page: index + 1 })"
        :aria-label="t('settings.actionPage', { page: index + 1 })"
        @click="page = index"
      >
        {{ index + 1 }}
      </Button>
      <Button size="sm" @click="addPage">
        {{ t('settings.addActionPage') }}
      </Button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-4 mb-3">
      <div class="flex items-center gap-2">
        <FieldSwitch
          :key="page"
          :model-value="takesText"
          :disabled="page === 0"
          :label="t('settings.actionPageTakesText')"
          @update:model-value="setTakesText"
        />
        <InfoTooltip :text="t('settings.actionPageTakesTextInfo')" />
      </div>
      <Button
        variant="ghost"
        class="ml-auto"
        :disabled="pagesCount <= 1"
        size="sm"
        icon="mdi:trash-can-outline"
        @click="removePage"
        >{{ t('settings.removeActionPage') }}</Button
      >
    </div>
    <ShortcutSlots
      :key="page"
      :items="visibleActionSlots"
      @move="moveAction"
      @add="addAction"
      @remove="removeAction"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :model-value="optionId(item)"
            :options="actionOptions"
            @update:model-value="updateAction(index, $event)"
          />
          <IconButton
            v-if="item.type === 'command'"
            variant="ghost"
            size="sm"
            @click="editCommand(item.commandId)"
            :label="t('commands.editCommand')"
            icon="mdi:pencil-outline"
          />
        </div>
      </template>
    </ShortcutSlots>
    <ConfirmModal
      :open="isRemoveConfirmOpen"
      :title="t('settings.removeActionPage')"
      :message="t('settings.removeActionPageConfirm')"
      :confirm-text="t('common.remove')"
      danger
      @confirm="deletePage"
      @cancel="isRemoveConfirmOpen = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMainActionChoices } from '../../composables/use-main-action-choices'
import { useSettingsContext } from '../../composables/use-settings-context'
import { normalizeMainActions } from '../../lib/action-menu/main-actions'
import {
  moveShortcutSlot,
  slotsFromList,
} from '../../lib/shortcut-slots/shortcut-slots'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import {
  type ActionPageConfig,
  type MainActionConfig,
  STANDARD_ACTION_IDS,
} from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, operations, editCommand } = useSettingsContext()

const page = ref(0)
const isRemoveConfirmOpen = ref(false)
const actionPages = computed(() => userConfig.value.actionPages ?? [])
const pagesCount = computed(() => actionPages.value.length)

watch(pagesCount, (count) => {
  if (page.value >= count) {
    page.value = Math.max(0, count - 1)
  }
})

function addPage() {
  const pages: ActionPageConfig[] = [
    ...actionPages.value,
    { inputMode: 'selection', slots: {} },
  ]
  operations.updateActionPages(pages)
  page.value = pages.length - 1
}

function removePage() {
  if (pagesCount.value <= 1) return
  if (Object.values(actionPages.value[page.value]?.slots ?? {}).some(Boolean)) {
    isRemoveConfirmOpen.value = true
    return
  }
  deletePage()
}

function deletePage() {
  isRemoveConfirmOpen.value = false
  operations.updateActionPages(
    actionPages.value.filter((_, index) => index !== page.value)
  )
  page.value = Math.max(0, page.value - 1)
}

const takesText = computed(
  () => page.value === 0 || actionPages.value[page.value]?.inputMode !== 'none'
)

function setTakesText(value: boolean) {
  if (page.value === 0) return
  const pages = actionPages.value.map((item, index) =>
    index === page.value
      ? {
          ...item,
          inputMode: value ? ('selection' as const) : ('none' as const),
        }
      : item
  )
  operations.updateActionPages(pages)
}

const actionSlots = computed(() =>
  normalizeMainActions(actionPages.value[page.value]?.slots)
)

const visibleActionSlots = computed(() =>
  actionSlots.value.map((action) =>
    action && isVisible(action) ? action : null
  )
)

const { actionOptions, availableActions, optionId, isVisible } =
  useMainActionChoices(visibleActionSlots)

function updatePageSlots(slots: (MainActionConfig | null)[]) {
  const pages = actionPages.value.map((item, index) =>
    index === page.value ? { ...item, slots: slotsFromList(slots) } : item
  )
  operations.updateActionPages(pages)
}

function moveAction(from: number, to: number) {
  updatePageSlots(moveShortcutSlot(actionSlots.value, from, to))
}

function setSlot(index: number, value: MainActionConfig | null) {
  const slots = [...actionSlots.value]
  slots[index] = value
  updatePageSlots(slots)
}

function addAction(index: number) {
  setSlot(index, { type: 'standard', actionId: STANDARD_ACTION_IDS[0] })
}

/** Removing a command from the menu keeps it in the library */
function removeAction(index: number) {
  setSlot(index, null)
}

function updateAction(index: number, value: string | number | undefined) {
  if (value === optionId(actionSlots.value[index])) return

  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (selected) setSlot(index, selected.config)
}
</script>
