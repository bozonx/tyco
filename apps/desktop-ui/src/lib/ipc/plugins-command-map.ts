import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { PluginsFunctions } from './functions/plugins'
import type { DomainCommandMap } from './command-types'

export function createPluginsCommandMap(): DomainCommandMap<
  keyof PluginsFunctions
> {
  return {
    writePluginNote: {
      command: DESKTOP_COMMANDS.WRITE_PLUGIN_NOTE,
      buildArgs: ([pluginId, dir, fileName, text, append]) =>
        ({
          pluginId,
          dir,
          fileName,
          text,
          append,
        }) satisfies DesktopCommandArgs<'write_plugin_note'>,
    },
    inspectPluginPackage: { command: DESKTOP_COMMANDS.INSPECT_PLUGIN_PACKAGE },
    listInstalledPlugins: { command: DESKTOP_COMMANDS.LIST_INSTALLED_PLUGINS },
    installPluginPackage: {
      command: DESKTOP_COMMANDS.INSTALL_PLUGIN_PACKAGE,
      buildArgs: ([preview]) =>
        ({
          path: preview.path,
          manifest: preview.manifest,
          digest: preview.digest,
        }) satisfies DesktopCommandArgs<'install_plugin_package'>,
    },
    restorePluginPackage: {
      command: DESKTOP_COMMANDS.RESTORE_PLUGIN_PACKAGE,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'restore_plugin_package'>,
    },
    removePluginPackage: {
      command: DESKTOP_COMMANDS.REMOVE_PLUGIN_PACKAGE,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'remove_plugin_package'>,
    },
  }
}
