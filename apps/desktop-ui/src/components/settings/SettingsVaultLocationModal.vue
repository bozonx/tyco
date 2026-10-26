<template>
  <BaseDialog :open="open" :labelledby="titleId" @close="close">
    <div class="vault-modal">
      <h3 :id="titleId" class="vault-modal-title">
        {{ t('settings.vaultChangeTitle') }}
      </h3>

      <div class="vault-modal-row">
        <span class="vault-modal-label">{{ t('settings.vaultCurrent') }}</span>
        <code class="vault-modal-path">{{ currentPath || '—' }}</code>
      </div>

      <div class="vault-modal-actions vault-modal-actions--start">
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:folder-search-outline"
          :disabled="isBusy"
          @click="pickFolder"
        >
          {{ t('settings.selectFolder') }}
        </Button>
        <Button
          v-if="isCustom"
          size="sm"
          variant="ghost"
          icon="mdi:restore"
          :disabled="isBusy"
          @click="inspect(undefined)"
        >
          {{ t('settings.vaultUseDefault') }}
        </Button>
      </div>

      <template v-if="target && relocation">
        <div class="vault-modal-row">
          <span class="vault-modal-label">{{ t('settings.vaultNew') }}</span>
          <code class="vault-modal-path">{{ target.path }}</code>
        </div>
        <InlineNotice
          density="compact"
          appearance="surface"
          :kind="relocation.notice.kind"
          :message="
            t(relocation.notice.messageKey, {
              current: currentPath,
              ...relocation.notice.params,
            })
          "
        />
        <FieldCheckbox
          v-if="relocation.canMove"
          v-model="wantsMove"
          :label="t('settings.vaultMoveData')"
        />
        <div v-if="relocation.subfolderPath" class="vault-modal-actions">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-plus-outline"
            :disabled="isBusy"
            @click="inspect(relocation.subfolderPath)"
          >
            {{ t('settings.vaultUseSubfolder') }}
          </Button>
        </div>
      </template>

      <InlineNotice
        v-if="errorMessage"
        density="compact"
        kind="error"
        :message="errorMessage"
      />

      <div class="vault-modal-actions">
        <Button size="sm" variant="ghost" :disabled="isApplying" @click="close">
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          :icon="relocation?.isMoving ? 'mdi:folder-move-outline' : undefined"
          :disabled="!relocation?.canApply || isBusy"
          @click="apply"
        >
          {{
            relocation?.isMoving
              ? t('settings.vaultApplyMove')
              : t('settings.vaultApplySwitch')
          }}
        </Button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { describeVaultRelocation } from '../../lib/ai-profiles/vault-relocation'
import { describeError } from '../../lib/errors/describe-error'
import { translate } from '../../lib/i18n'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import InlineNotice from '../common/InlineNotice.vue'
import type { VaultTarget } from '@tyco/shared'

const props = defineProps<{
  open: boolean
  currentPath: string
  /** The vault is in a folder the user chose, not the default one */
  isCustom: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const titleId = useId()
const aiProfilesStore = useAiProfilesStore()

const target = ref<VaultTarget | null>(null)
const wantsMove = ref(true)
const isInspecting = ref(false)
const isApplying = ref(false)
const errorMessage = ref('')
const isBusy = computed(() => isInspecting.value || isApplying.value)

const hasCurrentData = computed(
  () =>
    aiProfilesStore.profiles.length > 0 || aiProfilesStore.projects.length > 0
)

const relocation = computed(() =>
  target.value
    ? describeVaultRelocation(target.value, {
        hasCurrentData: hasCurrentData.value,
        wantsMove: wantsMove.value,
      })
    : null
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    target.value = null
    wantsMove.value = true
    errorMessage.value = ''
  }
)

function close() {
  if (!isApplying.value) emit('close')
}

async function inspect(path: string | undefined) {
  isInspecting.value = true
  errorMessage.value = ''
  try {
    target.value = await aiProfilesStore.inspectVaultTarget(path)
  } catch (error) {
    target.value = null
    errorMessage.value = describeError(error, translate)
  } finally {
    isInspecting.value = false
  }
}

async function pickFolder() {
  try {
    const picked = await aiProfilesStore.pickFolder()
    if (picked) await inspect(picked)
  } catch (error) {
    errorMessage.value = describeError(error, translate)
  }
}

async function apply() {
  if (!target.value || !relocation.value?.canApply) return
  isApplying.value = true
  errorMessage.value = ''
  try {
    await aiProfilesStore.relocateVault(
      target.value.isDefault ? undefined : target.value.path,
      relocation.value.isMoving
    )
    isApplying.value = false
    emit('close')
  } catch (error) {
    errorMessage.value = describeError(error, translate)
  } finally {
    isApplying.value = false
  }
}
</script>

<style scoped>
.vault-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: min(32rem, 80vw);
}

.vault-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
}

.vault-modal-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.vault-modal-label {
  color: var(--app-text-muted);
  font-size: var(--text-control);
}

.vault-modal-path {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}

.vault-modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.vault-modal-actions--start {
  justify-content: flex-start;
}
</style>
