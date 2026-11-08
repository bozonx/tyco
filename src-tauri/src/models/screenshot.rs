use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ScreenshotCaptureMode {
    Screen,
    /// Captures the entire screen, then crops it in TyCo's selector.
    #[default]
    Area,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The encoding of the frozen image the area selector shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum ScreenshotPreviewMediaType {
    #[serde(rename = "image/png")]
    Png,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotAreaSelection {
    /// Echoed by `confirm_screenshot_crop` / `cancel_screenshot_crop`.
    pub selection_id: u64,
    pub image_id: String,
    /// How the bytes of `image_id` are encoded
    pub media_type: ScreenshotPreviewMediaType,
    pub screen_x: i32,
    pub screen_y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}
