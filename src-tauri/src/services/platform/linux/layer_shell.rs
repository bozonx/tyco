//! Minimal bindings for the system GTK3 layer-shell library.

use std::ffi::{c_char, CString};

use gtk::prelude::*;

const LAYER_OVERLAY: u32 = 3;
const EDGE_LEFT: u32 = 0;
const EDGE_RIGHT: u32 = 1;
const EDGE_TOP: u32 = 2;
const EDGE_BOTTOM: u32 = 3;
const KEYBOARD_NONE: u32 = 0;
const KEYBOARD_EXCLUSIVE: u32 = 1;
const KEYBOARD_ON_DEMAND: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Keyboard {
    None,
    /// Takes the keyboard as soon as the surface is mapped, without asking the
    /// compositor to activate it, and keeps it until the mode changes.
    Exclusive,
    /// Unlike exclusive mode, lets the compositor move the focus away when the
    /// user clicks another window, so the panel learns it was left.
    OnDemand,
}

#[link(name = "gtk-layer-shell")]
unsafe extern "C" {
    fn gtk_layer_is_supported() -> i32;
    fn gtk_layer_init_for_window(window: *mut gtk_sys::GtkWindow);
    fn gtk_layer_set_layer(window: *mut gtk_sys::GtkWindow, layer: u32);
    fn gtk_layer_set_anchor(window: *mut gtk_sys::GtkWindow, edge: u32, anchored: i32);
    fn gtk_layer_set_margin(window: *mut gtk_sys::GtkWindow, edge: u32, margin: i32);
    fn gtk_layer_set_exclusive_zone(window: *mut gtk_sys::GtkWindow, zone: i32);
    fn gtk_layer_set_keyboard_mode(window: *mut gtk_sys::GtkWindow, mode: u32);
    fn gtk_layer_set_namespace(window: *mut gtk_sys::GtkWindow, name_space: *const c_char);
}

fn raw(window: &impl IsA<gtk::Window>) -> *mut gtk_sys::GtkWindow {
    let window: &gtk::Window = window.upcast_ref();
    window.as_ptr()
}

pub fn is_supported() -> bool {
    // SAFETY: this function has no arguments and only queries library state.
    unsafe { gtk_layer_is_supported() != 0 }
}

pub fn attach(window: &impl IsA<gtk::Window>) {
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

pub fn set_panel_profile(window: &impl IsA<gtk::Window>, margin_bottom: i32) {
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

pub fn set_sheet_profile(window: &impl IsA<gtk::Window>, margin_top: i32) {
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

pub fn set_keyboard(window: &impl IsA<gtk::Window>, keyboard: Keyboard) {
    let mode = match keyboard {
        Keyboard::None => KEYBOARD_NONE,
        Keyboard::Exclusive => KEYBOARD_EXCLUSIVE,
        Keyboard::OnDemand => KEYBOARD_ON_DEMAND,
    };
    // SAFETY: the window was initialized by `attach` and remains alive.
    unsafe {
        gtk_layer_set_keyboard_mode(raw(window), mode);
    }
}

/// A floating status bubble: on the overlay layer, anchored to the bottom
/// edge, and never taking the keyboard from the focused window.
pub fn attach_status(window: &impl IsA<gtk::Window>, margin_bottom: i32) {
    let pointer = raw(window);
    let name_space = CString::new("tyco-status").expect("namespace has no NUL bytes");
    // SAFETY: `pointer` belongs to a live GTK window that has not been mapped
    // yet, and `name_space` outlives the call, which copies it.
    unsafe {
        gtk_layer_init_for_window(pointer);
        gtk_layer_set_namespace(pointer, name_space.as_ptr());
        gtk_layer_set_layer(pointer, LAYER_OVERLAY);
        gtk_layer_set_exclusive_zone(pointer, 0);
        gtk_layer_set_keyboard_mode(pointer, KEYBOARD_NONE);
    }
    set_panel_profile(window, margin_bottom);
}
