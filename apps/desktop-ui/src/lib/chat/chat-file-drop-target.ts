interface DropPosition {
  x: number
  y: number
}
interface DropBounds {
  left: number
  right: number
  top: number
  bottom: number
}
type FileDropEvent =
  | { type: 'leave' }
  | { type: 'enter' | 'over'; position: DropPosition }
  | { type: 'drop'; position: DropPosition; paths: string[] }

/** Native positions are physical pixels; DOM bounds are CSS pixels. */
export function createChatFileDropTarget(deps: {
  getBounds: () => DropBounds | null
  getScale: () => number
  canAccept: () => boolean
  setDragging: (value: boolean) => void
  accept: (paths: string[]) => Promise<void>
}) {
  let disposed = false
  return {
    async handle(event: FileDropEvent) {
      if (disposed) return
      const bounds = deps.getBounds()
      const scale = deps.getScale()
      const inside =
        event.type !== 'leave' &&
        bounds !== null &&
        scale > 0 &&
        event.position.x / scale >= bounds.left &&
        event.position.x / scale <= bounds.right &&
        event.position.y / scale >= bounds.top &&
        event.position.y / scale <= bounds.bottom
      const accepted = inside && deps.canAccept()
      deps.setDragging(
        accepted && (event.type === 'enter' || event.type === 'over')
      )
      if (accepted && event.type === 'drop') await deps.accept(event.paths)
    },
    dispose() {
      disposed = true
      deps.setDragging(false)
    },
  }
}
