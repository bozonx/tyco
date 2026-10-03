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

          <template v-if="item.type === 'script'">
            <FieldInput
              :value="item.name"
              :placeholder="t('settings.actionName')"
              class="font-medium"
              @update:value="updateCustomField(index, 'name', $event)"
            />
            <div class="flex gap-2 items-center w-full">
              <FieldInput
                :value="item.command"
                :placeholder="t('settings.actionCommand')"
                class="flex-1"
                @update:value="updateCustomField(index, 'command', $event)"
              />
              <Button
                type="button"
                ghost
                square
                sm
                :title="t('settings.browseScriptFile')"
                @click="browseScript(index)"
              >
                <Icon icon="mdi:folder-open-outline" width="18" height="18" />
              </Button>
            </div>
            <FieldCheckbox
              :value="Boolean(item.logOutput)"
              :label="t('settings.actionLogOutput')"
              @update:value="updateCustomField(index, 'logOutput', $event)"
            />
          </template>

          <template v-else-if="item.type === 'webhook'">
            <FieldInput
              :value="item.name"
              :placeholder="t('settings.actionName')"
              class="font-medium"
              @update:value="updateCustomField(index, 'name', $event)"
            />
            <div class="flex gap-2 items-center w-full">
              <SegmentedControl
                :value="item.method || 'POST'"
                label="HTTP Method"
                :options="[
                  { id: 'POST', name: 'POST' },
                  { id: 'GET', name: 'GET' },
                ]"
                @update:value="updateCustomField(index, 'method', $event)"
              />
              <FieldInput
                :value="item.url"
                :placeholder="t('settings.actionWebhookUrl')"
                class="flex-1"
                @update:value="updateCustomField(index, 'url', $event)"
              />
            </div>
            <template v-if="(item.method || 'POST') === 'POST'">
              <FieldTextArea
                :value="item.payloadTemplate"
                :placeholder="t('settings.actionWebhookPayloadPlaceholder')"
                autoResize
                @update:value="
                  updateCustomField(index, 'payloadTemplate', $event)
                "
              />
            </template>
            <FieldCheckbox
              :value="Boolean(item.logOutput)"
              :label="t('settings.actionLogOutput')"
              @update:value="updateCustomField(index, 'logOutput', $event)"
            />
          </template>
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
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import { Icon } from '@iconify/vue'
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
const ipcStore = useIpcStore()

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

function removeAction(index: number) {
  const slots = [...actionSlots.value]
  slots[index] = null
  emit('update:mainActions', slots)
}

function updateAction(index: number, value: string | number | undefined) {
  if (value === 'custom:script') {
    const slots = [...actionSlots.value]
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `script-${Date.now()}`
    slots[index] = {
      type: 'script',
      id,
      name: '',
      command: '',
      logOutput: false,
    }
    emit('update:mainActions', slots)
    return
  }

  if (value === 'custom:webhook') {
    const slots = [...actionSlots.value]
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `webhook-${Date.now()}`
    slots[index] = {
      type: 'webhook',
      id,
      name: '',
      url: '',
      method: 'POST',
      logOutput: false,
    }
    emit('update:mainActions', slots)
    return
  }

  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (!selected) return
  const slots = [...actionSlots.value]
  slots[index] = selected.config
  emit('update:mainActions', slots)
}

function updateCustomField(index: number, field: string, value: unknown) {
  const current = actionSlots.value[index]
  if (!current || (current.type !== 'script' && current.type !== 'webhook'))
    return
  const slots = [...actionSlots.value]
  slots[index] = { ...current, [field]: value } as MainActionConfig
  emit('update:mainActions', slots)
}

async function browseScript(index: number) {
  try {
    const path = await ipcStore.callFunctionOrNotify('pickScriptFile', [])
    if (path && typeof path === 'string') {
      updateCustomField(index, 'command', path)
    }
  } catch {
    // ignore
  }
}
</script>
