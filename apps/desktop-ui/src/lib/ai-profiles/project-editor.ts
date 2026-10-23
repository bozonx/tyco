import { computed, ref } from 'vue'
import type { AiProject } from '@tyco/shared'

import {
  createAutosave,
  createAutosaveGroup,
  type AutosaveTimers,
} from '../settings/autosave'

export type ProjectFields = Pick<
  AiProject,
  'name' | 'description' | 'isExternal' | 'targetPath'
>

export interface ProjectEditorDependencies extends AutosaveTimers {
  saveProject: (fields: ProjectFields) => Promise<void>
  /** `retry` saves the fields again */
  reportError: (message: string, retry: () => void) => void
}

/**
 * The fields of a project. A new project is created on request; an existing one
 * is stored a moment after a change that leaves it valid
 */
export function createProjectEditor(deps: ProjectEditorDependencies) {
  const name = ref('')
  const description = ref('')
  const isExternal = ref(false)
  const targetPath = ref('')

  const isValid = computed(
    () =>
      Boolean(name.value.trim()) &&
      (!isExternal.value || Boolean(targetPath.value.trim()))
  )

  const fields = (): ProjectFields => ({
    name: name.value.trim(),
    description: description.value.trim() || undefined,
    isExternal: isExternal.value,
    targetPath: isExternal.value ? targetPath.value.trim() : undefined,
  })

  const autosave = createAutosave({
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    delayMs: deps.delayMs,
    save: () => deps.saveProject(fields()),
  })
  const autosaves = createAutosaveGroup({
    parts: [autosave],
    reportError: deps.reportError,
  })

  /** Fills the fields from a stored project, or clears them for a new one */
  const load = (project?: AiProject) => {
    autosave.cancel()
    name.value = project?.name ?? ''
    description.value = project?.description ?? ''
    isExternal.value = project?.isExternal ?? false
    targetPath.value = project?.targetPath ?? ''
  }

  /** Stores a change of an existing project once it is valid */
  const change = () => {
    if (isValid.value) autosave.schedule()
    else autosave.cancel()
  }

  return {
    name,
    description,
    isExternal,
    targetPath,
    isValid,
    fields,
    saveStatus: autosaves.status,
    load,
    change,
    flush: autosaves.flush,
    cancel: autosaves.cancel,
  }
}
