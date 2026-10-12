import type { DesktopInvoke } from '@tyco/shared'
import { invoke } from '@tauri-apps/api/core'
import { normalizeDesktopError } from './ipc-error'

/** Normalize general IPC errors at the boundary while retaining their code. */
export const invokeDesktop: DesktopInvoke = async (...args) => {
  try {
    return await invoke(...args)
  } catch (error) {
    throw normalizeDesktopError(error)
  }
}
