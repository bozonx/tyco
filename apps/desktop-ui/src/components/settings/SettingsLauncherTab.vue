<template>
  <SettingsSection :description="t('settings.launcherCommandsHint')" bare>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Button
        v-for="(pageItem, index) in userConfig.launcherPages"
        :key="pageItem.id"
        size="sm"
        :variant="page === index ? 'primary' : 'neutral'"
        class="min-w-8"
        :title="t('settings.launcherPage', { page: index + 1 })"
        :aria-label="t('settings.launcherPage', { page: index + 1 })"
        @click="page = index"
      >
        {{ index + 1 }}
      </Button>
      <Button size="sm" @click="addPage">
        {{ t('settings.addLauncherPage') }}
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <div class="flex items-center gap-2">
        <FieldSwitch
          :key="userConfig.launcherPages[page]?.id ?? page"
          :model-value="takesText"
          :label="t('settings.launcherPageTakesText')"
          @update:model-value="setTakesText"
        />
        <InfoTooltip :text="t('settings.launcherPageTakesTextInfo')" />
      </div>
      <Button
        variant="danger-ghost"
        :disabled="pagesCount <= 1"
        size="sm"
        @click="removePage"
        >{{ t('settings.removeLauncherPage') }}</Button
      >
    </div>
    <ShortcutSlots
      :key="userConfig.launcherPages[page]?.id ?? page"
      :items="launcherSlots"
      @move="moveSlot"
      @add="addSlot"
      @remove="removeSlot"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :model-value="item ?? ''"
            :options="commandOptions"
            @update:model-value="updateSlot(index, $event)"
          />
          <IconButton
            v-if="item"
            variant="ghost"
            size="sm"
            @click="editCommand(item)"
            :label="t('commands.editCommand')"
            icon="mdi:pencil-outline"
          />
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  normalizeCommands,
  normalizeLauncherCommands,
} from '../../lib/commands/command-config'
import {
  commandLabel,
  isCommandAvailable,
} from '../../lib/commands/command-runtime'
import {
  moveShortcutSlot,
  slotsFromList,
} from '../../lib/shortcut-slots/shortcut-slots'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import type { LauncherPageConfig } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, operations, editCommand } = useSettingsContext()
const toolsStore = useToolsStore()

const commands = computed(() => normalizeCommands(userConfig.value.commands))

const page = ref(0)
const pagesCount = computed(() => userConfig.value.launcherPages.length)
watch(pagesCount, (count) => {
  if (page.value >= count) {
    page.value = Math.max(0, count - 1)
  }
})
function addPage() {
  const pages: LauncherPageConfig[] = [
    ...userConfig.value.launcherPages,
    {
      id: crypto.randomUUID(),
      inputMode: 'selection',
      hotkey: '',
      slots: {},
    },
  ]
  operations.updateLauncherPages(pages)
  page.value = pages.length - 1
}
function removePage() {
  if (pagesCount.value <= 1) return
  operations.updateLauncherPages(
    userConfig.value.launcherPages.filter((_, index) => index !== page.value)
  )
  page.value = Math.max(0, page.value - 1)
}
const takesText = computed(
  () => userConfig.value.launcherPages[page.value]?.inputMode === 'selection'
)
function updatePage(values: Partial<LauncherPageConfig>) {
  operations.updateLauncherPages(
    userConfig.value.launcherPages.map((item, index) =>
      index === page.value ? { ...item, ...values } : item
    )
  )
}
function setTakesText(value: boolean) {
  updatePage({ inputMode: value ? 'selection' : 'none' })
}
function updateSlots(slots: (string | null)[]) {
  updatePage({ slots: slotsFromList(slots) })
}
const launcherSlots = computed(() =>
  normalizeLauncherCommands(
    userConfig.value.launcherPages[page.value]?.slots,
    commands.value
  )
)

const availableCommands = computed(() =>
  commands.value.map((command) => ({
    id: command.id,
    name: commandLabel(command),
    available: isCommandAvailable(command, toolsStore),
  }))
)

function unavailableName(commandId: string): string {
  const command = commands.value.find((item) => item.id === commandId)
  return t('commands.unavailableInMenu', {
    name: command ? commandLabel(command) : commandId,
  })
}

const commandOptions = computed(() => {
  const options = [
    ...availableCommands.value.map(({ id, name }) => ({ id, name })),
  ]
  for (const commandId of launcherSlots.value) {
    if (commandId && !options.some((option) => option.id === commandId)) {
      options.push({ id: commandId, name: unavailableName(commandId) })
    }
  }
  return options
})

function moveSlot(from: number, to: number) {
  updateSlots(moveShortcutSlot(launcherSlots.value, from, to))
}

function setSlot(index: number, value: string | null) {
  const slots = [...launcherSlots.value]
  slots[index] = value
  updateSlots(slots)
}

function addSlot(index: number) {
  const first = availableCommands.value[0]?.id ?? null
  setSlot(index, first)
}

function removeSlot(index: number) {
  setSlot(index, null)
}

function updateSlot(index: number, value: string | number | undefined) {
  const current = launcherSlots.value[index]
  if (value === current) return

  setSlot(index, typeof value === 'string' && value ? value : null)
}
</script>
