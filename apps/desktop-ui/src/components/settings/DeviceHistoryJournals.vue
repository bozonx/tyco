<template>
  <div class="device-journals">
    <FieldRow
      vertical
      :separator="false"
      :label="t('settings.userData.deviceHistory')"
      :hint="t('settings.userData.deviceHistoryHint')"
    >
      <StateMessage
        v-if="!journals.length"
        density="compact"
        :message="t('settings.userData.deviceHistoryEmpty')"
      />
      <div v-else class="settings-entity-list">
        <SettingsEntityItem
          v-for="journal in journals"
          :key="journal.deviceId"
          :title="journalTitle(journal)"
          :description="journalDescription(journal)"
          :data-testid="`journal-${journal.deviceId}`"
        >
          <template v-if="!journal.isCurrentDevice" #actions>
            <Button
              size="sm"
              variant="ghost"
              icon="mdi:trash-can-outline"
              @click="journalToDelete = journal"
            >
              {{ t('settings.userData.deleteDeviceHistory') }}
            </Button>
          </template>
        </SettingsEntityItem>
      </div>
    </FieldRow>
    <ConfirmModal
      :open="journalToDelete !== null"
      :title="t('settings.userData.deleteDeviceHistory')"
      :message="t('settings.userData.deleteDeviceHistoryConfirm')"
      :confirm-text="t('settings.userData.deleteDeviceHistory')"
      danger
      @confirm="remove"
      @cancel="journalToDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { resultOrThrow } from '../../lib/ipc/ipc-model'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import type { DeviceHistoryJournal } from '@tyco/shared'

const { t, locale } = useI18n()
const { toastError } = useToast()
const { call } = useIpcStore()

const journals = ref<DeviceHistoryJournal[]>([])
const journalToDelete = ref<DeviceHistoryJournal | null>(null)

async function load() {
  try {
    journals.value = resultOrThrow(await call('list_device_history_journals'))
  } catch (error) {
    toastError(error)
  }
}
onMounted(load)

function journalTitle(journal: DeviceHistoryJournal): string {
  if (journal.isCurrentDevice) return t('settings.userData.thisDevice')
  return journal.deviceName || journal.deviceId.slice(0, 8)
}

function journalDescription(journal: DeviceHistoryJournal): string {
  const count = t('settings.userData.deviceHistoryEntries', {
    count: journal.entryCount,
  })
  if (!journal.lastWrittenMs) return count
  const date = new Date(Number(journal.lastWrittenMs)).toLocaleString(
    locale.value
  )
  return `${count} · ${date}`
}

async function remove() {
  const journal = journalToDelete.value
  journalToDelete.value = null
  if (!journal) return
  try {
    resultOrThrow(
      await call('delete_device_history', { deviceId: journal.deviceId })
    )
    await load()
  } catch (error) {
    toastError(error)
  }
}
</script>
