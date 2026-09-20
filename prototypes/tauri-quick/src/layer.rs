//! Тонкая обёртка над системной libgtk-layer-shell (GTK3), той же, на которой
//! сделано большинство wayland-панелей. Биндингов на crates.io не берём:
//! нужных функций шесть, объявить их дешевле, чем тащить зависимость.

#![cfg(all(target_os = "linux", feature = "layer"))]

use gtk::prelude::*;
use gtk::ApplicationWindow;

pub const LAYER_OVERLAY: u32 = 3;
pub const EDGE_LEFT: u32 = 0;
pub const EDGE_RIGHT: u32 = 1;
pub const EDGE_BOTTOM: u32 = 3;

pub const KEYBOARD_NONE: u32 = 0;
pub const KEYBOARD_EXCLUSIVE: u32 = 1;

#[link(name = "gtk-layer-shell")]
extern "C" {
    fn gtk_layer_is_supported() -> i32;
    fn gtk_layer_init_for_window(window: *mut gtk_sys::GtkWindow);
    fn gtk_layer_set_layer(window: *mut gtk_sys::GtkWindow, layer: u32);
    fn gtk_layer_set_anchor(window: *mut gtk_sys::GtkWindow, edge: u32, anchor_to_edge: i32);
    fn gtk_layer_set_margin(window: *mut gtk_sys::GtkWindow, edge: u32, margin_size: i32);
    fn gtk_layer_set_exclusive_zone(window: *mut gtk_sys::GtkWindow, zone: i32);
    fn gtk_layer_set_keyboard_mode(window: *mut gtk_sys::GtkWindow, mode: u32);
}

fn raw(window: &ApplicationWindow) -> *mut gtk_sys::GtkWindow {
    let window: &gtk::Window = window.upcast_ref();
    window.as_ptr()
}

/// Поддерживает ли композитор zwlr_layer_shell_v1. На GNOME вернёт false.
pub fn is_supported() -> bool {
    unsafe { gtk_layer_is_supported() != 0 }
}

/// Обязана быть вызвана до реализации окна. Если Tauri успел его показать,
/// layer-shell молча не применится — это и есть первый вопрос лаборатории.
pub fn attach_bottom(window: &ApplicationWindow, margin_bottom: i32) {
    let pointer = raw(window);
    unsafe {
        gtk_layer_init_for_window(pointer);
        gtk_layer_set_layer(pointer, LAYER_OVERLAY);
        gtk_layer_set_anchor(pointer, EDGE_BOTTOM, 1);
        gtk_layer_set_anchor(pointer, EDGE_LEFT, 0);
        gtk_layer_set_anchor(pointer, EDGE_RIGHT, 0);
        gtk_layer_set_margin(pointer, EDGE_BOTTOM, margin_bottom);
        gtk_layer_set_exclusive_zone(pointer, 0);
        gtk_layer_set_keyboard_mode(pointer, KEYBOARD_NONE);
    }
}

/// Exclusive забирает клавиатуру в момент маппинга, без activation token
/// и без участия политики предотвращения кражи фокуса.
pub fn set_keyboard(window: &ApplicationWindow, grab: bool) {
    unsafe {
        gtk_layer_set_keyboard_mode(
            raw(window),
            if grab { KEYBOARD_EXCLUSIVE } else { KEYBOARD_NONE },
        );
    }
}
