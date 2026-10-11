import { computed, ref, watch } from 'vue'
import type {
  ChatImage,
  ChatMessage,
  ChatParams,
  ChatAttachment,
} from '@tyco/shared'

import {
  createChatFileInput,
  importDroppedChatFiles,
  type ChatFileErrorKind,
  type PreparedChatFile,
} from './chat-file-input'

export interface ChatFileControllerDeps {
  getDraft: () => ChatParams
  getMessages: () => ChatMessage[]
  getSavingImages: () => ChatImage[]
  isGenerating: () => boolean
  prepare: (
    file: File,
    availableImages: number,
    isCurrent: () => boolean
  ) => Promise<PreparedChatFile>
  addAttachment: (attachment: ChatAttachment) => void
  readDroppedFile: (path: string) => Promise<File>
  syncImages: (ids: string[]) => Promise<void>
  report: (name: string, kind: ChatFileErrorKind) => void
  reportSyncError: () => void
}

/** Owns import queues and image lifetimes independently of Pinia and native IO. */
export function createChatFileController(deps: ChatFileControllerDeps) {
  const importing = ref(0)
  const opening = ref(0)
  const pendingImages = computed(() => deps.getDraft().images || [])
  let fileQueue = Promise.resolve()
  let imageSync = Promise.resolve()
  let disposed = false
  const imageIds = () =>
    [
      ...pendingImages.value,
      ...deps.getSavingImages(),
      ...deps.getMessages().flatMap((message) => message.images || []),
    ].map((image) => image.id)
  const stopOwnership = watch(
    () => ({ busy: importing.value + opening.value, ids: imageIds() }),
    ({ busy }) => {
      if (busy || disposed) return
      imageSync = imageSync
        .catch(() => undefined)
        .then(() => {
          if (importing.value || opening.value || disposed) return
          return deps.syncImages([...new Set(imageIds())])
        })
        .catch(deps.reportSyncError)
    }
  )

  async function addFiles(files: File[]) {
    if (!files.length || deps.isGenerating() || disposed) return
    const draft = deps.getDraft()
    importing.value++
    const isCurrent = () =>
      !disposed && !deps.isGenerating() && deps.getDraft() === draft
    const input = createChatFileInput({
      prepare: deps.prepare,
      imageCount: () => (draft.images || []).length,
      fileCount: () =>
        (draft.attachments || []).filter((item) => item.name).length +
        (draft.images || []).length,
      accept: (prepared) => {
        for (const attachment of prepared.attachments)
          deps.addAttachment(attachment)
        const images = [...(draft.images || [])]
        for (const image of prepared.images)
          if (!images.some((item) => item.id === image.id)) images.push(image)
        draft.images = images
      },
      report: deps.report,
    })
    const task = fileQueue.then(async () => {
      if (!isCurrent()) return
      // Release a replaced draft before new bytes compete for the session quota.
      await deps
        .syncImages([...new Set(imageIds())])
        .catch(deps.reportSyncError)
      if (isCurrent()) await input.add(files, isCurrent)
    })
    fileQueue = task.catch(() => undefined)
    try {
      await task
    } finally {
      importing.value--
    }
  }

  async function addDroppedFiles(paths: string[]) {
    if (deps.isGenerating() || disposed) return
    const draft = deps.getDraft()
    importing.value++
    try {
      await importDroppedChatFiles(
        paths,
        { read: deps.readDroppedFile, accept: addFiles, report: deps.report },
        () => !disposed && !deps.isGenerating() && deps.getDraft() === draft
      )
    } finally {
      importing.value--
    }
  }

  async function whileOpening<T>(operation: () => Promise<T>): Promise<T> {
    opening.value++
    try {
      return await operation()
    } finally {
      opening.value--
    }
  }

  return {
    importing,
    pendingImages,
    addFiles,
    addDroppedFiles,
    whileOpening,
    removeImage: (id: string) => {
      deps.getDraft().images = pendingImages.value.filter(
        (image) => image.id !== id
      )
    },
    whenSynced: async () => {
      await fileQueue
      await imageSync
    },
    dispose: () => {
      disposed = true
      stopOwnership()
    },
  }
}
