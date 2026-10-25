/** Minimal runtime contracts used by the VM's independent KWin observer. */
interface VmKwinSignal<T extends unknown[] = []> {
  connect(callback: (...args: T) => void): void
}

interface VmKwinWindow {
  internalId: { toString(): string }
  caption: string
  pid: number
  resourceClass: string
  normalWindow: boolean
  dialog: boolean
  fullScreen: boolean
  clientGeometry: { x: number; y: number; width: number; height: number }
  frameGeometry: { x: number; y: number; width: number; height: number }
  fullScreenChanged: VmKwinSignal
  captionChanged: VmKwinSignal
  frameGeometryChanged: VmKwinSignal
}

declare const workspace: {
  windowList(): VmKwinWindow[]
  activeWindow: VmKwinWindow | null
  windowActivated: VmKwinSignal
  windowAdded: VmKwinSignal<[VmKwinWindow]>
  windowRemoved: VmKwinSignal
}

declare function callDBus(
  service: string,
  path: string,
  interfaceName: string,
  method: string,
  payload: string
): void
