import { describe, expect, it, vi } from 'vitest'

import { withWorkspaceUploads } from './chat-workspace-uploads'

const file = new File(['Report'], 'r.txt')
const prepared = {
  attachments: [{ text: 'Report', name: 'r.txt', mediaType: 'text/plain' }],
  images: [],
}

function setup(shouldKeep = true) {
  const deps = {
    shouldKeep: () => shouldKeep,
    saveUpload: vi.fn(async () => 'workspace/uploads/r.txt'),
    warn: vi.fn(),
  }
  const prepare = vi.fn(async () => structuredClone(prepared))
  return { deps, prepare, wrapped: withWorkspaceUploads(prepare, deps) }
}

describe('chat-workspace-uploads', () => {
  it('keeps the file and names its path in the attachment', async () => {
    const { deps, wrapped } = setup()

    const result = await wrapped(file, 4, () => true)

    expect(deps.saveUpload).toHaveBeenCalledWith(file)
    expect(result.attachments[0].workspacePath).toBe('workspace/uploads/r.txt')
  })

  it('keeps nothing without file tools, text or a current draft', async () => {
    const off = setup(false)
    expect(
      (await off.wrapped(file, 4, () => true)).attachments[0].workspacePath
    ).toBeUndefined()

    const imageOnly = setup()
    imageOnly.prepare.mockResolvedValue({ attachments: [], images: [] })
    await imageOnly.wrapped(file, 4, () => true)

    const replaced = setup()
    await replaced.wrapped(file, 4, () => false)

    for (const { deps } of [off, imageOnly, replaced])
      expect(deps.saveUpload).not.toHaveBeenCalled()
  })

  it('still attaches a file it could not keep', async () => {
    const { deps, wrapped } = setup()
    deps.saveUpload.mockRejectedValue(new Error('disk full'))

    const result = await wrapped(file, 4, () => true)

    expect(result).toEqual(prepared)
    expect(deps.warn).toHaveBeenCalledOnce()
  })
})
