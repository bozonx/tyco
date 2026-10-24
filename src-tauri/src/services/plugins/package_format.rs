//! Bounds of the plugin package format that the SDK checks too. They mirror
//! `packages/plugin-sdk/src/package-format.ts`; the test below fails when the
//! two drift apart.

pub(super) const MAX_PLUGIN_ID_LENGTH: usize = 128;
pub(super) const MAX_SETTING_NAME_LENGTH: usize = 128;
pub(super) const MAX_CONFIG_FIELDS: usize = 256;
pub(super) const MAX_SETTINGS_RENAMES: usize = 256;
pub(super) const MAX_ICONS: usize = 4096;
pub(super) const MAX_ICON_BODY_BYTES: usize = 128 * 1024;
pub(super) const MAX_ICON_DIMENSION: f64 = 4096.0;
pub(super) const RESERVED_PLUGIN_ID: &str = "core";

#[cfg(test)]
mod tests {
    use super::*;

    /// The value of `export const NAME = <value>` in a TypeScript source.
    fn ts_constant(source: &str, name: &str) -> String {
        let prefix = format!("export const {name} = ");
        source
            .lines()
            .find_map(|line| line.trim().strip_prefix(&prefix))
            .unwrap_or_else(|| panic!("{name} is not exported by the SDK"))
            .trim()
            .trim_matches('\'')
            .replace('_', "")
    }

    #[test]
    fn bounds_match_the_sdk() {
        let sdk = include_str!("../../../../packages/plugin-sdk/src/package-format.ts");
        let numbers = [
            ("MAX_PLUGIN_ID_LENGTH", MAX_PLUGIN_ID_LENGTH),
            ("MAX_SETTING_NAME_LENGTH", MAX_SETTING_NAME_LENGTH),
            ("MAX_CONFIG_FIELDS", MAX_CONFIG_FIELDS),
            ("MAX_SETTINGS_RENAMES", MAX_SETTINGS_RENAMES),
            ("MAX_ICONS", MAX_ICONS),
            ("MAX_ICON_BODY_BYTES", MAX_ICON_BODY_BYTES),
            ("MAX_ICON_DIMENSION", MAX_ICON_DIMENSION as usize),
        ];
        for (name, value) in numbers {
            assert_eq!(ts_constant(sdk, name), value.to_string(), "{name}");
        }
        assert_eq!(ts_constant(sdk, "RESERVED_PLUGIN_ID"), RESERVED_PLUGIN_ID);
    }

    #[test]
    fn versions_match_the_sdk() {
        let plugin = include_str!("../../../../packages/plugin-sdk/src/plugin.ts");
        let validation = include_str!("../../../../packages/plugin-sdk/src/validation.ts");
        assert_eq!(
            ts_constant(plugin, "PLUGIN_API_VERSION"),
            super::super::API_VERSION.to_string()
        );
        assert_eq!(
            ts_constant(validation, "PLUGIN_PACKAGE_FORMAT_VERSION"),
            super::super::FORMAT_VERSION.to_string()
        );
    }
}
