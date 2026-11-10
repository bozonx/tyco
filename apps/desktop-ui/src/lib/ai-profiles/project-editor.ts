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
  saveProject: (
    fields: ProjectFields,
    expectedRevision?: string
  ) => Promise<string>
  /** `retry` saves the fields again */
  reportError: (message: string, retry: () => void) => void
}

/**
 * The fields of a project. A new project is created on request; an existing one
 * is stored a moment after a change that leaves it valid
 */
export function createProjectEditor(deps: ProjectEditorDependencies) {
  let revision: string | undefined
  let hasInvalidChanges = false
  const name = ref('')
  const description = ref('')
  const isExternal = ref(false)
  const targetPath = ref('')
  /**
   * The project is stored already. Its folder is set on each device: one that
   * has none here is still edited, and gets its folder when the user gives one
   */
  const isStored = ref(false)

  const isValid = computed(
    () =>
      Boolean(name.value.trim()) &&
      (!isExternal.value || isStored.value || Boolean(targetPath.value.trim()))
  )

  const fields = (): ProjectFields => ({
    name: name.value.trim(),
    description: description.value.trim() || undefined,
    isExternal: isExternal.value,
    targetPath:
      isExternal.value && targetPath.value.trim()
        ? targetPath.value.trim()
        : undefined,
  })

  const autosave = createAutosave({
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    delayMs: deps.delayMs,
    save: async () => {
      revision = await deps.saveProject(fields(), revision)
    },
  })
  const autosaves = createAutosaveGroup({
    parts: [autosave],
    reportError: deps.reportError,
  })

  /** Fills the fields from a stored project, or clears them for a new one */
  const load = (project?: AiProject) => {
    autosave.cancel()
    revision = project?.revision
    hasInvalidChanges = false
    name.value = project?.name ?? ''
    description.value = project?.description ?? ''
    isExternal.value = project?.isExternal ?? false
    targetPath.value = project?.targetPath ?? ''
    isStored.value = Boolean(project)
  }

  /** Stores a change of an existing project once it is valid */
  const change = () => {
    hasInvalidChanges = !isValid.value
    if (isValid.value) autosave.schedule()
    else autosave.cancel()
  }

  return {
    name,
    description,
    isExternal,
    targetPath,
    isStored,
    isValid,
    fields,
    saveStatus: autosaves.status,
    load,
    syncFromStored: (project: AiProject) => {
      if (
        !hasInvalidChanges &&
        ['idle', 'saved'].includes(autosave.status.value)
      )
        load(project)
    },
    change,
    flush: autosaves.flush,
    cancel: autosaves.cancel,
  }
}
