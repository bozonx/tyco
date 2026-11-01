import { describe, expect, it, vi } from 'vitest'

import { createMemoryCompactionModel } from './memory-compaction-model'

function setup() {
  const deps = {
    read: vi.fn(async () => 'Original'),
    compact: vi.fn(async () => 'Compact'),
    write: vi.fn(async () => {}),
    reportError: vi.fn(),
    onUnchanged: vi.fn(),
    onApplied: vi.fn(),
  }
  return { deps, model: createMemoryCompactionModel(deps) }
}

describe('memory compaction', () => {
  it('writes only after approval, using the profile and file of the diff', async () => {
    const { deps, model } = setup()
    await model.startCompaction('writer', 'a.md', 'Unsaved text')
    expect(deps.read).not.toHaveBeenCalled()
    expect(deps.compact).toHaveBeenCalledWith('a.md', 'Unsaved text')
    expect(deps.write).not.toHaveBeenCalled()
    await model.applyCompaction()
    expect(deps.write).toHaveBeenCalledWith('writer', 'a.md', 'Compact')
    expect(deps.onApplied).toHaveBeenCalledWith(
      'writer',
      'a.md',
      'Unsaved text',
      'Compact'
    )
    expect(model.isDiffModalOpen.value).toBe(false)
    model.dispose()
  })

  it('discards a late result after cancellation', async () => {
    const { deps, model } = setup()
    let finish!: (text: string) => void
    deps.compact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = model.startCompaction('writer', 'a.md', 'Original')
    model.closeDiffModal()
    finish('Late result')
    await pending
    expect(model.isDiffModalOpen.value).toBe(false)
    expect(deps.write).not.toHaveBeenCalled()
    model.dispose()
  })

  it('keeps a failed diff available for retry and blocks duplicate writes', async () => {
    const { deps, model } = setup()
    await model.startCompaction('writer', 'a.md')
    let fail!: (error: Error) => void
    deps.write.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    const pending = model.applyCompaction()
    await model.applyCompaction()
    expect(deps.write).toHaveBeenCalledOnce()
    fail(new Error('Disk full'))
    await pending
    expect(model.isDiffModalOpen.value).toBe(true)
    await model.applyCompaction()
    expect(deps.onApplied).toHaveBeenCalledOnce()
    model.dispose()
  })

  it('does not offer an unchanged result', async () => {
    const { deps, model } = setup()
    deps.compact.mockResolvedValue('Original\n')
    await model.startCompaction('writer', 'a.md')
    expect(deps.onUnchanged).toHaveBeenCalledOnce()
    expect(model.isDiffModalOpen.value).toBe(false)
    model.dispose()
  })
})
