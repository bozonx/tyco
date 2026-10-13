import { describe, expect, it, vi } from 'vitest'

import { createChatFileDropTarget } from './chat-file-drop-target'

function setup() {
  const deps = {
    getBounds: () => ({ left: 10, right: 100, top: 20, bottom: 80 }),
    getScale: () => 2,
    canAccept: vi.fn(() => true),
    setDragging: vi.fn(),
    accept: vi.fn(async (_paths: string[]) => {}),
  }
  return { deps, target: createChatFileDropTarget(deps) }
}

describe('chat file drop target', () => {
  it('converts physical pixels and accepts drops only inside the composer', async () => {
    const { deps, target } = setup()
    await target.handle({ type: 'over', position: { x: 100, y: 100 } })
    expect(deps.setDragging).toHaveBeenLastCalledWith(true)
    await target.handle({
      type: 'drop',
      position: { x: 100, y: 100 },
      paths: ['a.txt'],
    })
    expect(deps.accept).toHaveBeenCalledWith(['a.txt'])
    expect(deps.setDragging).toHaveBeenLastCalledWith(false)
    await target.handle({
      type: 'drop',
      position: { x: 100, y: 10 },
      paths: ['b.txt'],
    })
    expect(deps.accept).toHaveBeenCalledTimes(1)
  })

  it('clears the hint on leaving or entering a disabled composer', async () => {
    const { deps, target } = setup()
    await target.handle({ type: 'enter', position: { x: 100, y: 100 } })
    await target.handle({ type: 'leave' })
    expect(deps.setDragging).toHaveBeenLastCalledWith(false)
    deps.canAccept.mockReturnValue(false)
    await target.handle({
      type: 'drop',
      position: { x: 100, y: 100 },
      paths: ['a.txt'],
    })
    expect(deps.accept).not.toHaveBeenCalled()
  })

  it('ignores late events after disposal', async () => {
    const { deps, target } = setup()
    target.dispose()
    deps.setDragging.mockClear()
    await target.handle({ type: 'enter', position: { x: 100, y: 100 } })
    await target.handle({
      type: 'drop',
      position: { x: 100, y: 100 },
      paths: ['a.txt'],
    })
    expect(deps.setDragging).not.toHaveBeenCalled()
    expect(deps.accept).not.toHaveBeenCalled()
  })
})
