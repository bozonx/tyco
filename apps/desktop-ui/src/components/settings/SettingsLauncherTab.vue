<template>
  <SettingsSection :description="t('settings.launcherCommandsHint')" bare>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Button
        v-for="(_, index) in pagesCount"
        :key="index"
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
        <FieldCheckbox
          :value="takesText"
          :label="t('settings.launcherPageTakesText')"
          @update:value="setTakesText"
        />
        <InfoTooltip :text="t('settings.launcherPageTakesTextInfo')" />
      </div>
      <Button :disabled="page === 0" size="sm" @click="removePage">{{
        t('settings.removeLauncherPage')
      }}</Button>
    </div>
    <ShortcutSlots
      :items="launcherSlots"
      @move="moveSlot"
      @add="addSlot"
      @remove="removeSlot"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :value="item ?? ''"
            :options="commandOptions"
            @update:value="updateSlot(index, $event)"
          />
          <Button
            v-if="item"
            type="button"
            variant="ghost"
            square
            size="sm"
            :title="t('commands.editCommand')"
            @click="emit('editCommand', item)"
          >
            <Icon icon="mdi:pencil-outline" width="16" height="16" />
          </Button>
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  commandLabel,
  isCommandAvailable,
  normalizeCommands,
  normalizeLauncherCommands,
} from '../../lib/commands/command-config'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldSelect from '../common/FieldSelect.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import { Icon } from '@iconify/vue'
import type { BuiltinToolId, UserConfig } from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:launcherPages', value: (string | null)[][]): void
  (event: 'update:launcherCommands', value: (string | null)[]): void
  (event: 'update:launcherPagesWithoutText', value: number[]): void
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
const pagesCount = computed(
  () => 1 + (props.userConfig.launcherPages?.length ?? 0)
)
watch(pagesCount, (count) => {
  if (page.value >= count) {
    page.value = Math.max(0, count - 1)
  }
})
function addPage() {
  const pages = [
    ...(props.userConfig.launcherPages ?? []),
    Array<string | null>(15).fill(null),
  ]
  emit('update:launcherPages', pages)
  page.value = pages.length
}
function removePage() {
  if (!page.value) return
  emit(
    'update:launcherPages',
    (props.userConfig.launcherPages ?? []).filter(
      (_, index) => index !== page.value - 1
    )
  )
  page.value = Math.max(0, page.value - 1)
}
/** The commands of the page get the selection of the window */
const takesText = computed(
  () => !props.userConfig.launcherPagesWithoutText?.includes(page.value)
)
function setTakesText(value: boolean) {
  const pages = (props.userConfig.launcherPagesWithoutText ?? []).filter(
    (item) => item !== page.value
  )
  if (!value) pages.push(page.value)
  emit(
    'update:launcherPagesWithoutText',
    pages.sort((a, b) => a - b)
  )
}
function updateSlots(slots: (string | null)[]) {
  if (!page.value) emit('update:launcherCommands', slots)
  else {
    const pages = [...(props.userConfig.launcherPages ?? [])]
    pages[page.value - 1] = slots
    emit('update:launcherPages', pages)
  }
}
const launcherSlots = computed(() =>
  normalizeLauncherCommands(
    page.value
      ? props.userConfig.launcherPages?.[page.value - 1]
      : props.userConfig.launcherCommands,
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
