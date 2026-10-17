import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { ChatParams } from '@tyco/shared'

import { createChatFileController } from './chat-file-controller'

const image = {
  id: 'image',
  mediaType: 'image/webp' as const,
  width: 1,
  height: 1,
  size: 1,
}
function setup(isGenerating = false) {
  const draft = ref<ChatParams>({})
  const syncImages = vi.fn(async () => undefined)
  const prepare = vi.fn(async () => ({ attachments: [], images: [image] }))
  const report = vi.fn()
  const reportBusy = vi.fn()
  const controller = createChatFileController({
    getDraft: () => draft.value,
    getMessages: () => [],
    getSavingImages: () => [],
    isGenerating: () => isGenerating,
    prepare,
    addAttachment: vi.fn(),
    readDroppedFile: async () => new File(['file'], 'a.png'),
    syncImages,
    report,
    notify: vi.fn(),
    reportSyncError: vi.fn(),
    reportBusy,
  })
  return { controller, draft, syncImages, prepare, report, reportBusy }
}

describe('chat file controller ownership', () => {
  it('deduplicates accepted images and releases ownership when removed', async () => {
    const { controller, draft, syncImages } = setup()
    await controller.addFiles([
      new File(['file'], 'a.png'),
      new File(['file'], 'b.png'),
    ])
    await nextTick()
    await controller.whenSynced()
    expect(draft.value.images).toEqual([image])
    expect(syncImages).toHaveBeenLastCalledWith(['image'])
    controller.removeImage('image')
    await nextTick()
    await controller.whenSynced()
    expect(syncImages).toHaveBeenLastCalledWith([])
    controller.dispose()
  })
  it('releases a replaced draft before storing its next import', async () => {
    const { controller, draft, syncImages, prepare } = setup()
    draft.value = { images: [image] }
    await nextTick()
    await controller.whenSynced()
    draft.value = {}
    prepare.mockImplementationOnce(async () => {
      expect(syncImages).toHaveBeenLastCalledWith([])
      return { attachments: [], images: [image] }
    })
    await controller.addFiles([new File(['file'], 'new.png')])
    controller.dispose()
  })
  it('waits for history opening before reconciling window ownership', async () => {
    const { controller, draft, syncImages } = setup()
    let finish!: () => void
    const opening = controller.whileOpening(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      draft.value = { images: [image] }
    })
    await nextTick()
    expect(syncImages).not.toHaveBeenCalled()
    finish()
    await opening
    await nextTick()
    await controller.whenSynced()
    expect(syncImages).toHaveBeenLastCalledWith(['image'])
    controller.dispose()
  })
  it('keeps the import busy during a native read and rejects a replaced draft', async () => {
    const draft = ref<ChatParams>({})
    let finish!: (file: File) => void
    const prepare = vi.fn()
    const controller = createChatFileController({
      getDraft: () => draft.value,
      getMessages: () => [],
      getSavingImages: () => [],
      isGenerating: () => false,
      prepare,
      addAttachment: vi.fn(),
      readDroppedFile: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      syncImages: vi.fn(async () => undefined),
      report: vi.fn(),
      notify: vi.fn(),
      reportSyncError: vi.fn(),
      reportBusy: vi.fn(),
    })
    const importing = controller.addDroppedFiles(['/tmp/a.png'])
    expect(controller.importing.value).toBe(1)
    draft.value = {}
    finish(new File(['file'], 'a.png'))
    await importing
    expect(prepare).not.toHaveBeenCalled()
    expect(controller.importing.value).toBe(0)
    controller.dispose()
  })
  it('tells why files are not taken while an answer is generated', async () => {
    const { controller, prepare, reportBusy } = setup(true)
    await controller.addFiles([new File(['file'], 'a.png')])
    await controller.addDroppedFiles(['/tmp/a.png'])
    expect(reportBusy).toHaveBeenCalledTimes(2)
    expect(prepare).not.toHaveBeenCalled()
    controller.dispose()
  })
})
