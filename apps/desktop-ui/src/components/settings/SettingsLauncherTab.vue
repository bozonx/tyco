<template>
  <SettingsSection :description="t('settings.launcherCommandsHint')" bare>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Button
        v-for="(pageItem, index) in props.userConfig.launcherPages"
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
          :key="props.userConfig.launcherPages[page]?.id ?? page"
          :model-value="takesText"
          :label="t('settings.launcherPageTakesText')"
          @update:model-value="setTakesText"
        />
        <InfoTooltip :text="t('settings.launcherPageTakesTextInfo')" />
      </div>
      <Button :disabled="pagesCount <= 1" size="sm" @click="removePage">{{
        t('settings.removeLauncherPage')
      }}</Button>
    </div>
    <ShortcutSlots
      :key="props.userConfig.launcherPages[page]?.id ?? page"
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
            :title="t('commands.editCommand')"
            @click="emit('editCommand', item)"
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
import {
  normalizeCommands,
  normalizeLauncherCommands,
} from '../../lib/commands/command-config'
import {
  commandLabel,
  isCommandAvailable,
} from '../../lib/commands/command-runtime'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import type {
  BuiltinToolId,
  LauncherPageConfig,
  UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:launcherPages', value: LauncherPageConfig[]): void
  /** A new command of the library goes to the slot at `index` */
  (
    event: 'createCommand',
    index: number,
    toolId: BuiltinToolId,
    page: number
  ): void
  (event: 'editCommand', commandId: string): void
}>()

const NEW_COMMAND_PREFIX = 'new:'

const { t } = useI18n()
const toolsStore = useToolsStore()

const commands = computed(() => normalizeCommands(props.userConfig.commands))

const page = ref(0)
const pagesCount = computed(() => props.userConfig.launcherPages.length)
watch(pagesCount, (count) => {
  if (page.value >= count) {
    page.value = Math.max(0, count - 1)
  }
})
function addPage() {
  const pages: LauncherPageConfig[] = [
    ...props.userConfig.launcherPages,
    {
      id: crypto.randomUUID(),
      slots: Array<string | null>(15).fill(null),
      inputMode: 'selection',
    },
  ]
  emit('update:launcherPages', pages)
  page.value = pages.length - 1
}
function removePage() {
  if (pagesCount.value <= 1) return
  emit(
    'update:launcherPages',
    props.userConfig.launcherPages.filter((_, index) => index !== page.value)
  )
  page.value = Math.max(0, page.value - 1)
}
const takesText = computed(
  () => props.userConfig.launcherPages[page.value]?.inputMode === 'selection'
)
function updatePage(values: Partial<LauncherPageConfig>) {
  emit(
    'update:launcherPages',
    props.userConfig.launcherPages.map((item, index) =>
      index === page.value ? { ...item, ...values } : item
    )
  )
}
function setTakesText(value: boolean) {
  updatePage({ inputMode: value ? 'selection' : 'none' })
}
function updateSlots(slots: (string | null)[]) {
  updatePage({ slots })
}
const launcherSlots = computed(() =>
  normalizeLauncherCommands(
    props.userConfig.launcherPages[page.value]?.slots,
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
    { id: `${NEW_COMMAND_PREFIX}script`, name: t('commands.newScript') },
    { id: `${NEW_COMMAND_PREFIX}webhook`, name: t('commands.newWebhook') },
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

  if (value === `${NEW_COMMAND_PREFIX}script`) {
    emit('createCommand', index, 'script', page.value)
    return
  }
  if (value === `${NEW_COMMAND_PREFIX}webhook`) {
    emit('createCommand', index, 'webhook', page.value)
    return
  }

  setSlot(index, typeof value === 'string' && value ? value : null)
}
</script>
