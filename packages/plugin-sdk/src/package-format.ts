/**
 * Bounds of the plugin package format, checked both here and by the host.
 * `src-tauri/src/services/plugins/package_format.rs` mirrors the shared ones; a
 * test there fails when a value drifts apart from this file.
 */

/** Plugin IDs and setting names: up to this many characters */
export const MAX_PLUGIN_ID_LENGTH = 128
export const MAX_SETTING_NAME_LENGTH = 128
/** IDs of actions, edits, toolbar items and tools */
export const MAX_CONTRIBUTION_ID_LENGTH = 128

export const MAX_CONFIG_FIELDS = 256
export const MAX_SETTINGS_RENAMES = 256
export const MAX_TOOL_SCHEMA_PROPERTIES = 256
/** Contributions a plugin may register in one call */
export const MAX_CONTRIBUTION_BATCH = 256

export const MAX_ICONS = 4096
/** 128 KiB of SVG per icon */
export const MAX_ICON_BODY_BYTES = 131_072
export const MAX_ICON_DIMENSION = 4096

/** The ID the host keeps for its own messages and settings */
export const RESERVED_PLUGIN_ID = 'core'

const PLUGIN_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9 _-]{0,${MAX_PLUGIN_ID_LENGTH - 1}}$`
)
const CONTRIBUTION_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${MAX_CONTRIBUTION_ID_LENGTH}}$`
)
const SETTING_NAME_PATTERN = new RegExp(
  `^[A-Za-z][A-Za-z0-9_-]{0,${MAX_SETTING_NAME_LENGTH - 1}}$`
)

/** The form of a plugin ID; whether it is reserved is a separate check */
export const hasPluginIdFormat = (id: string): boolean =>
  PLUGIN_ID_PATTERN.test(id)

export const hasContributionIdFormat = (id: string): boolean =>
  CONTRIBUTION_ID_PATTERN.test(id)

export const hasSettingNameFormat = (name: string): boolean =>
  SETTING_NAME_PATTERN.test(name)
