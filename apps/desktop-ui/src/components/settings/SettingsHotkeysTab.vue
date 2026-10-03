<template>
  <SettingsSection
    :title="t('settings.appHotkeysTitle')"
    :description="t('settings.appHotkeysHint')"
  >
    <FieldRow :label="t('settings.submitKey.label')">
      <FieldSelect
        class="w-full"
        :value="submitKey"
        :options="options"
        @update:value="setSubmitKey"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { resolveSubmitKey } from '../../lib/input-keys/input-keys'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { UserConfig } from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const { t } = useI18n()

const submitKey = computed(() => resolveSubmitKey(props.userConfig.submitKey))
const options = computed(() => [
  { id: 'enter', name: t('settings.submitKey.enter') },
  { id: 'ctrlEnter', name: t('settings.submitKey.ctrlEnter') },
])

function setSubmitKey(value: number | string | undefined) {
  props.userConfig.submitKey = resolveSubmitKey(value)
}
</script>
