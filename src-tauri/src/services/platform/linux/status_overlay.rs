//! The status bubble of `services::status_overlay` as a plain GTK window.

use std::cell::RefCell;
use std::time::Duration;

use gtk::glib;
use gtk::prelude::*;

use crate::services::status_overlay::{StatusOverlayKind, StatusOverlayRequest};

const MARGIN_BOTTOM: i32 = 72;
/// GLib keeps timer intervals in 32-bit milliseconds.
const MAX_TIMER_MS: u64 = u32::MAX as u64;
const KIND_CLASSES: [&str; 4] = ["pending", "success", "info", "error"];
const CSS: &str = "
    window.tyco-status-window { background-color: transparent; }
    .tyco-status {
        background-color: rgba(32, 33, 36, 0.94);
        color: #f1f3f4;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 10px 18px;
    }
    .tyco-status-text { font-size: 10.5pt; }
    .tyco-status-icon { font-size: 12pt; font-weight: bold; }
    .tyco-status.success .tyco-status-icon { color: #81c995; }
    .tyco-status.info .tyco-status-icon { color: #8ab4f8; }
    .tyco-status.error { border-color: rgba(242, 139, 130, 0.6); }
    .tyco-status.error .tyco-status-icon { color: #f28b82; }
";

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

struct Overlay {
    window: gtk::Window,
    frame: gtk::Box,
    spinner: gtk::Spinner,
    icon: gtk::Label,
    label: gtk::Label,
    layer_shell: bool,
    generation: u64,
    visible: bool,
}

/// Without layer-shell a Wayland compositor would place and focus the
/// bubble like any window, so it is left to desktop notifications there.
fn can_show() -> bool {
    crate::services::platform::linux::layer_shell::is_supported()
        || crate::services::platform::session::current().is_x11()
}

pub fn update(request: Option<StatusOverlayRequest>) {
    if !can_show() {
        return;
    }
    OVERLAY.with(|cell| {
        let mut cell = cell.borrow_mut();
        let overlay = cell.get_or_insert_with(Overlay::new);
        overlay.generation += 1;
        let generation = overlay.generation;
        let Some(request) = request else {
            overlay.hide();
            return;
        };
        if request.only_if_visible && !overlay.visible {
            overlay.hide();
            return;
        }

        overlay.set_content(&request);
        let delay = if overlay.visible {
            0
        } else {
            request.delay_ms.min(MAX_TIMER_MS)
        };
        if delay == 0 {
            overlay.present();
        } else {
            glib::timeout_add_local_once(Duration::from_millis(delay), move || {
                with_generation(generation, Overlay::present);
            });
        }
        if let Some(hide_after) = request.hide_after_ms {
            glib::timeout_add_local_once(
                Duration::from_millis(delay.saturating_add(hide_after).min(MAX_TIMER_MS)),
                move || {
                    with_generation(generation, Overlay::hide);
                },
            );
        }
    });
}

/// Runs `action` unless a newer request has replaced the one that
/// scheduled it.
fn with_generation(generation: u64, action: fn(&mut Overlay)) {
    OVERLAY.with(|cell| {
        if let Some(overlay) = cell.borrow_mut().as_mut() {
            if overlay.generation == generation {
                action(overlay);
            }
        }
    });
}

impl Overlay {
    fn new() -> Self {
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_title("Tyco status");
        window.set_decorated(false);
        window.set_resizable(false);
        window.set_skip_taskbar_hint(true);
        window.set_skip_pager_hint(true);
        window.set_accept_focus(false);
        window.set_focus_on_map(false);
        window.set_app_paintable(true);
        window.set_type_hint(gtk::gdk::WindowTypeHint::Notification);
        window.style_context().add_class("tyco-status-window");

        let screen = WidgetExt::screen(&window);
        if let Some(visual) = screen.as_ref().and_then(|screen| screen.rgba_visual()) {
            window.set_visual(Some(&visual));
        }
        if let Some(screen) = &screen {
            let provider = gtk::CssProvider::new();
            if let Err(error) = provider.load_from_data(CSS.as_bytes()) {
                log::warn!("Could not load the status overlay style: {error}");
            }
            gtk::StyleContext::add_provider_for_screen(
                screen,
                &provider,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }

        let layer_shell = crate::services::platform::linux::layer_shell::is_supported();
        if layer_shell {
            crate::services::platform::linux::layer_shell::attach_status(&window, MARGIN_BOTTOM);
        } else {
            window.set_keep_above(true);
        }

        // the window itself stays fully transparent around the bubble
        window.connect_draw(|_, context| {
            context.set_operator(gtk::cairo::Operator::Source);
            context.set_source_rgba(0.0, 0.0, 0.0, 0.0);
            let _ = context.paint();
            context.set_operator(gtk::cairo::Operator::Over);
            glib::Propagation::Proceed
        });
        // clicks go through to the windows below
        window.connect_realize(|window| {
            window.input_shape_combine_region(Some(&gtk::cairo::Region::create()));
        });

        let frame = gtk::Box::new(gtk::Orientation::Horizontal, 10);
        frame.style_context().add_class("tyco-status");
        let spinner = gtk::Spinner::new();
        let icon = gtk::Label::new(None);
        icon.style_context().add_class("tyco-status-icon");
        let label = gtk::Label::new(None);
        label.style_context().add_class("tyco-status-text");
        label.set_line_wrap(true);
        label.set_max_width_chars(60);
        label.set_xalign(0.0);
        frame.pack_start(&spinner, false, false, 0);
        frame.pack_start(&icon, false, false, 0);
        frame.pack_start(&label, true, true, 0);
        window.add(&frame);
        frame.show_all();

        Self {
            window,
            frame,
            spinner,
            icon,
            label,
            layer_shell,
            generation: 0,
            visible: false,
        }
    }

    fn set_content(&self, request: &StatusOverlayRequest) {
        let style = self.frame.style_context();
        for class in KIND_CLASSES {
            style.remove_class(class);
        }
        let (class, glyph) = match request.kind {
            StatusOverlayKind::Pending => ("pending", ""),
            StatusOverlayKind::Success => ("success", "✓"),
            StatusOverlayKind::Info => ("info", "ℹ"),
            StatusOverlayKind::Error => ("error", "⚠"),
        };
        style.add_class(class);
        let pending = request.kind == StatusOverlayKind::Pending;
        self.spinner.set_visible(pending);
        if pending {
            self.spinner.start();
        } else {
            self.spinner.stop();
        }
        self.icon.set_text(glyph);
        self.icon.set_visible(!pending);
        self.label.set_text(&request.text);
        // shrink to the new content
        self.window.resize(1, 1);
    }

    fn present(&mut self) {
        self.window.show();
        if !self.layer_shell {
            self.place_at_bottom();
        }
        self.visible = true;
    }

    fn hide(&mut self) {
        self.window.hide();
        self.spinner.stop();
        self.visible = false;
    }

    /// The X11 fallback: centered above the bottom edge of the monitor
    /// with the pointer.
    fn place_at_bottom(&self) {
        let Some(display) = gtk::gdk::Display::default() else {
            return;
        };
        let monitor = display
            .default_seat()
            .and_then(|seat| seat.pointer())
            .and_then(|pointer| {
                let (_, x, y) = pointer.position();
                display.monitor_at_point(x, y)
            })
            .or_else(|| display.primary_monitor());
        let Some(area) = monitor.map(|monitor| monitor.workarea()) else {
            return;
        };
        let (width, height) = self.window.size();
        self.window.move_(
            area.x() + (area.width() - width) / 2,
            area.y() + area.height() - height - MARGIN_BOTTOM,
        );
    }
}
