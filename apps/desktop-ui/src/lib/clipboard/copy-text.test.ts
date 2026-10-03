import { describe, expect, it, vi } from 'vitest'

import { createCopyText } from './copy-text'

const setup = (writeText = vi.fn().mockResolvedValue(undefined)) => {
  const showToast = vi.fn()
  const saveOutput = vi.fn().mockResolvedValue(undefined)

  return { writeText, showToast, saveOutput }
}

describe('createCopyText', () => {
  it('writes the text, notifies and records the output', async () => {
    const deps = setup()
    const copyText = createCopyText(deps)

    await expect(copyText('hello')).resolves.toBe('copied')

    expect(deps.writeText).toHaveBeenCalledWith('hello')
    expect(deps.showToast).toHaveBeenCalledWith('toast.copied', 'success')
    expect(deps.saveOutput).toHaveBeenCalledWith('hello')
  })

  it('does not record anything without saveOutput', async () => {
    const { writeText, showToast } = setup()
    const copyText = createCopyText({ writeText, showToast })

    await expect(copyText('hello')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('rejects blank text', async () => {
    const deps = setup()
    const copyText = createCopyText(deps)

    await expect(copyText('  \n')).resolves.toBe('empty')

    expect(deps.writeText).not.toHaveBeenCalled()
    expect(deps.saveOutput).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'toast.textNotSelected',
      'error'
    )
  })

  it('reports an unavailable clipboard and records nothing', async () => {
    const deps = setup(vi.fn().mockRejectedValue(new Error('denied')))
    const copyText = createCopyText(deps)

    await expect(copyText('hello')).resolves.toBe('failed')

    expect(deps.saveOutput).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith(
      'editor.menu.clipboardUnavailable',
      'error'
    )
  })
})
