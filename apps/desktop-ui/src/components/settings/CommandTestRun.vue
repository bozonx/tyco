<template>
  <div class="test-run">
    <FieldTextArea
      v-if="takesText"
      class="test-run-text"
      :value="text"
      :placeholder="t('commands.testTextPlaceholder')"
      @update:value="text = $event"
    />
    <div class="test-run-actions">
      <Button
        v-if="!isRunning"
        size="sm"
        icon="mdi:play"
        :disabled="hasIssues"
        @click="run"
      >
        {{ t('commands.testRun') }}
      </Button>
      <Button v-else size="sm" icon="mdi:stop" @click="stop">
        {{ t('commands.testStop') }}
      </Button>
      <span v-if="isRunning" class="test-run-status">
        {{ t('commands.testRunning') }}
      </span>
      <span v-else-if="hasIssues" class="test-run-status">
        {{ t('commands.testFixIssues') }}
      </span>
    </div>

    <template v-if="result?.kind === 'script'">
      <p
        class="test-run-status"
        :class="result.result.success ? 'is-success' : 'is-error'"
      >
        {{
          result.result.exitCode === null
            ? t('commands.testNoExitCode')
            : t('commands.testExitCode', { code: result.result.exitCode })
        }}
      </p>
      <div class="test-run-stream">
        <span class="test-run-stream-label">stdout</span>
        <pre class="test-run-output">{{ result.result.stdout || '—' }}</pre>
      </div>
      <div v-if="result.result.stderr" class="test-run-stream">
        <span class="test-run-stream-label">stderr</span>
        <pre class="test-run-output is-error">{{ result.result.stderr }}</pre>
      </div>
    </template>
    <div v-else-if="result?.kind === 'output'" class="test-run-stream">
      <span class="test-run-stream-label">{{ t('commands.testOutput') }}</span>
      <pre class="test-run-output">{{ result.output || '—' }}</pre>
    </div>
    <p v-else-if="result?.kind === 'error'" class="test-run-status is-error">
      {{ errorText }}
    </p>
    <p v-else-if="result?.kind === 'cancelled'" class="test-run-status">
      {{ t('commands.testCancelled') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  commandTakesText,
  validateCommand,
} from '../../lib/commands/command-runtime'
import {
  type CommandTestResult,
  runCommandTest,
} from '../../lib/commands/command-test-run'
import { createScriptActionClient } from '../../lib/custom-actions/script-action-client'
import { useIpcStore } from '../../stores/ipc'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import type { CommandConfig } from '@tyco/shared'

/** Runs a script or a webhook from its editor and shows what came out */
const props = defineProps<{ command: CommandConfig }>()

const { t } = useI18n()
const ipcStore = useIpcStore()
const toolsStore = useToolsStore()

const text = ref('')
const result = ref<CommandTestResult | null>(null)
const isRunning = ref(false)
let controller: AbortController | null = null
let runCounter = 0

const takesText = computed(() => commandTakesText(props.command, toolsStore))
/** A name alone does not keep the command from running */
const hasIssues = computed(() =>
  validateCommand(props.command, toolsStore).some(
    (issue) => issue.field !== 'name'
  )
)

const errorText = computed(() => {
  if (result.value?.kind !== 'error') return ''
  const { messageKey, message } = result.value
  return [messageKey ? t(messageKey) : '', message].filter(Boolean).join(': ')
})

async function run() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  isRunning.value = true
  result.value = null
  try {
    result.value = await runCommandTest(
      props.command,
      text.value,
      toolsStore,
      {
        ...createScriptActionClient(ipcStore.callFunction),
        newRunId: () => `command-test-${Date.now()}-${++runCounter}`,
      },
      current.signal
    )
  } finally {
    if (controller === current) {
      controller = null
      isRunning.value = false
    }
  }
}

function stop() {
  controller?.abort()
}

// a result of another configuration would mislead
watch(
  () => props.command.toolConfig,
  () => {
    if (!isRunning.value) result.value = null
  }
)

onUnmounted(stop)
</script>

<style scoped>
.test-run {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 0.5rem);
}

.test-run-text {
  min-height: 4.5rem;
}

.test-run-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
}

.test-run-status {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.test-run-status.is-success {
  color: var(--color-success);
}

.test-run-status.is-error {
  color: var(--color-error);
}

.test-run-stream {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.test-run-stream-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.test-run-output {
  max-height: 12rem;
  margin: 0;
  padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem);
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  background-color: var(--app-surface-sunken);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  word-break: break-word;
}

.test-run-output.is-error {
  color: var(--color-error);
}
</style>
