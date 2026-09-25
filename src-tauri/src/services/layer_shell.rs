//! Minimal bindings for the system GTK3 layer-shell library.

#![cfg(target_os = "linux")]

use gtk::prelude::*;
use gtk::ApplicationWindow;

const LAYER_OVERLAY: u32 = 3;
const EDGE_LEFT: u32 = 0;
const EDGE_RIGHT: u32 = 1;
const EDGE_TOP: u32 = 2;
const EDGE_BOTTOM: u32 = 3;
const KEYBOARD_NONE: u32 = 0;
// Unlike exclusive mode, on-demand lets the compositor move the focus away when
// the user clicks another window, so the panel learns it was left
const KEYBOARD_ON_DEMAND: u32 = 2;

#[link(name = "gtk-layer-shell")]
unsafe extern "C" {
    fn gtk_layer_is_supported() -> i32;
    fn gtk_layer_init_for_window(window: *mut gtk_sys::GtkWindow);
    fn gtk_layer_set_layer(window: *mut gtk_sys::GtkWindow, layer: u32);
    fn gtk_layer_set_anchor(window: *mut gtk_sys::GtkWindow, edge: u32, anchored: i32);
    fn gtk_layer_set_margin(window: *mut gtk_sys::GtkWindow, edge: u32, margin: i32);
    fn gtk_layer_set_exclusive_zone(window: *mut gtk_sys::GtkWindow, zone: i32);
    fn gtk_layer_set_keyboard_mode(window: *mut gtk_sys::GtkWindow, mode: u32);
}

fn raw(window: &ApplicationWindow) -> *mut gtk_sys::GtkWindow {
    let window: &gtk::Window = window.upcast_ref();
    window.as_ptr()
}

pub fn is_supported() -> bool {
    // SAFETY: this function has no arguments and only queries library state.
    unsafe { gtk_layer_is_supported() != 0 }
}

pub fn attach(window: &ApplicationWindow) {
    let pointer = raw(window);
    // SAFETY: `pointer` belongs to a live GTK application window and setup calls
    // this before the first map, as required by gtk-layer-shell.
    unsafe {
        gtk_layer_init_for_window(pointer);
        gtk_layer_set_layer(pointer, LAYER_OVERLAY);
        gtk_layer_set_exclusive_zone(pointer, 0);
        gtk_layer_set_keyboard_mode(pointer, KEYBOARD_NONE);
    }
}

pub fn set_panel_profile(window: &ApplicationWindow, margin_bottom: i32) {
    let pointer = raw(window);
    // SAFETY: the window was initialized by `attach` and remains alive.
    unsafe {
        gtk_layer_set_anchor(pointer, EDGE_BOTTOM, 1);
        gtk_layer_set_anchor(pointer, EDGE_TOP, 0);
        gtk_layer_set_anchor(pointer, EDGE_LEFT, 0);
        gtk_layer_set_anchor(pointer, EDGE_RIGHT, 0);
        gtk_layer_set_margin(pointer, EDGE_BOTTOM, margin_bottom);
    }
}

pub fn set_sheet_profile(window: &ApplicationWindow, margin_top: i32) {
    let pointer = raw(window);
    // Anchor to top with margin to center vertically; unanchored left/right centers horizontally.
    // SAFETY: the window was initialized by `attach` and remains alive.
    unsafe {
        gtk_layer_set_anchor(pointer, EDGE_TOP, 1);
        gtk_layer_set_anchor(pointer, EDGE_BOTTOM, 0);
        gtk_layer_set_anchor(pointer, EDGE_LEFT, 0);
        gtk_layer_set_anchor(pointer, EDGE_RIGHT, 0);
        gtk_layer_set_margin(pointer, EDGE_TOP, margin_top);
        gtk_layer_set_margin(pointer, EDGE_BOTTOM, 0);
        gtk_layer_set_margin(pointer, EDGE_LEFT, 0);
        gtk_layer_set_margin(pointer, EDGE_RIGHT, 0);
    }
}

pub fn set_keyboard(window: &ApplicationWindow, enabled: bool) {
    // SAFETY: the window was initialized by `attach` and remains alive.
    unsafe {
        gtk_layer_set_keyboard_mode(
            raw(window),
            if enabled {
                KEYBOARD_ON_DEMAND
            } else {
                KEYBOARD_NONE
            },
        );
    }
}
