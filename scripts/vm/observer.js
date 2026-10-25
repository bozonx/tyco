/* global workspace, callDBus */
function observeWindows() {
  const windows = workspace
    .windowList()
    .map((window) => ({
      id: window.internalId.toString(),
      title: window.caption,
      pid: window.pid,
      resourceClass: window.resourceClass,
      normalWindow: window.normalWindow,
      dialog: window.dialog,
      fullScreen: window.fullScreen,
      clientGeometry: {
        x: window.clientGeometry.x,
        y: window.clientGeometry.y,
        width: window.clientGeometry.width,
        height: window.clientGeometry.height,
      },
      geometry: {
        x: window.frameGeometry.x,
        y: window.frameGeometry.y,
        width: window.frameGeometry.width,
        height: window.frameGeometry.height,
      },
    }))
  callDBus(
    'org.tyco.VmObserver',
    '/org/tyco/VmObserver',
    'org.tyco.VmObserver',
    'Observe',
    JSON.stringify({
      activeWindowId: workspace.activeWindow?.internalId.toString() ?? null,
      windows,
    })
  )
}
workspace.windowActivated.connect(observeWindows)
/** @param {VmKwinWindow} window */
function observeWindow(window) {
  window.fullScreenChanged.connect(observeWindows)
  window.captionChanged.connect(observeWindows)
  window.frameGeometryChanged.connect(observeWindows)
}
workspace.windowList().forEach(observeWindow)
workspace.windowAdded.connect((window) => {
  observeWindow(window)
  observeWindows()
})
workspace.windowRemoved.connect(observeWindows)
observeWindows()
