use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

pub use super::activation::Activation;
use super::activation::{StartMode, WindowProfile, WINDOW_SIZE};
use super::platform::{InputRegion, PanelKeyboard};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::errors::AppError;
use crate::state::AppState;
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";
pub const PARAMS_CHANGED_EVENT: &str = "app://params-changed";
pub const CONTEXT_CAPTURED_EVENT: &str = "app://context-captured";
pub const OPEN_MAIN_EDITOR_EVENT: &str = "app://open-main-editor";
pub const OPEN_MAIN_CHAT_EVENT: &str = "app://open-main-chat";
/// The user closed the main window, as opposed to hiding it with a hotkey or
/// the tray: what was open in it is done with.
pub const MAIN_WINDOW_CLOSED_EVENT: &str = "app://main-window-closed";
const TRAY_SHOW_ID: &str = "show";
const TRAY_CORRECT_ID: &str = "correct-selection";
const TRAY_QUIT_ID: &str = "quit";
const WARMUP_ENV: &str = "TYCO_QUICK_WARMUP";
const DEFAULT_WARMUP_CYCLES: u32 = 3;
const WARMUP_DELAY: Duration = Duration::from_millis(400);
const WARMUP_STEP: Duration = Duration::from_millis(250);

pub fn emit_params(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let params = state.params();
    let label = app.state::<RuntimeWindows>().active_label();

    if let Some(window) = app.get_webview_window(label) {
        window.emit(PARAMS_CHANGED_EVENT, params)?;
    }

    Ok(())
}

fn emit_captured_context(app: &AppHandle, selected_text: Option<String>) -> Result<(), AppError> {
    let label = app.state::<RuntimeWindows>().active_label();
    if let Some(window) = app.get_webview_window(label) {
        window.emit(
            CONTEXT_CAPTURED_EVENT,
            serde_json::json!({ "selectedText": selected_text }),
        )?;
    }
    Ok(())
}

#[derive(Default)]
struct ContextCapture {
    generation: AtomicU64,
    /// The selection seen by the previous capture; `None` until the first one.
    last_selection: Mutex<Option<Option<String>>>,
}

impl ContextCapture {
    /// Records `captured` and returns it unless the previous capture already
    /// saw it. The primary selection outlives a deselection in most apps, so an
    /// unchanged one is most likely a leftover rather than a fresh selection.
    fn fresh_selection(&self, captured: Option<String>) -> Option<String> {
        let mut last = self.last_selection.lock().expect("selection lock poisoned");
        let previous = last.replace(captured.clone());
        match previous {
            Some(previous) if previous == captured => None,
            _ => captured,
        }
    }

    fn seed_selection(&self, captured: Option<String>) {
        self.last_selection
            .lock()
            .expect("selection lock poisoned")
            .get_or_insert(captured);
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct LayerShell {
    supported: bool,
    keyboard: PanelKeyboard,
}

/// Keyboard mode of the quick window's layer surface, `None` when it is a
/// regular window.
fn panel_layer(app: &AppHandle) -> Option<PanelKeyboard> {
    #[cfg(target_os = "linux")]
    {
        let layer = app.state::<LayerShell>();
        layer.supported.then_some(layer.keyboard)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        None
    }
}

struct RuntimeWindows {
    active_label: Mutex<&'static str>,
}

impl Default for RuntimeWindows {
    fn default() -> Self {
        Self {
            active_label: Mutex::new(MAIN_WINDOW_LABEL),
        }
    }
}

impl RuntimeWindows {
    fn active_label(&self) -> &'static str {
        *self
            .active_label
            .lock()
            .expect("window label lock poisoned")
    }

    fn set_active_label(&self, label: &'static str) {
        *self
            .active_label
            .lock()
            .expect("window label lock poisoned") = label;
    }
}

/// Execute window operations serially and return their actual result to the caller.
/// Tauri executes this closure inline when already on the main thread.
fn on_main_thread(
    app: &AppHandle,
    action: impl FnOnce(&AppHandle) -> Result<(), AppError> + Send + 'static,
) -> Result<(), AppError> {
    let handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(action(&handle));
    })?;
    receiver
        .recv()
        .map_err(|error| AppError::Message(error.to_string()))?
}

pub fn activate(app: &AppHandle, mut activation: Activation) -> Result<(), AppError> {
    let source = if activation.window_id.is_none() {
        super::platform::capture_source()
    } else {
        activation.window_id.clone()
    };
    if activation.window_id.is_none() {
        activation.window_id.clone_from(&source);
    }
    let editor_mode = activation.mode == StartMode::Editor;
    // a voice question continues the open chat, so only a selection made
    // since the previous activation becomes its context
    let fresh_only = editor_mode || activation.mode == StartMode::VoiceChat;
    // the editor must not take over a selection made in Tyco itself
    let capture_selection =
        activation.selected_text.is_none() && !(editor_mode && has_focused_window(app));
    let generation = app
        .state::<ContextCapture>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    on_main_thread(app, move |app| activate_on_main_thread(app, activation))?;

    if capture_selection {
        let handle = app.clone();
        thread::spawn(move || {
            let captured =
                tauri::async_runtime::block_on(super::platform::capture_selection(source));
            let fresh = handle
                .state::<ContextCapture>()
                .fresh_selection(captured.clone());
            // the editor takes the selection over, so only a fresh one may replace its text
            let selected_text = if fresh_only { fresh } else { captured };
            if let Err(error) = on_main_thread(&handle, move |app| {
                if app
                    .state::<ContextCapture>()
                    .generation
                    .load(Ordering::SeqCst)
                    != generation
                {
                    return Ok(());
                }
                let state = app.state::<AppState>();
                state.update_params(|params| params.selected_text.clone_from(&selected_text));
                emit_captured_context(app, selected_text)
            }) {
                log::warn!("Could not publish captured foreground context: {error}");
            }
        });
    }
    Ok(())
}

/// Waits until no Tyco window has keyboard focus. Once the compositor takes
/// it away, it has handed it to another window, so input can follow. Gives up
/// silently after `timeout`: the caller still waits for its target window.
pub fn wait_until_unfocused(app: &AppHandle, timeout: std::time::Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while has_focused_window(app) && std::time::Instant::now() < deadline {
        thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn has_focused_window(app: &AppHandle) -> bool {
    app.webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
}

/// The target window was closed: nothing can be inserted into it any more.
pub fn forget_target_window(app: &AppHandle, window_id: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    if state.params().window_id.as_deref() != Some(window_id) {
        return Ok(());
    }
    state.update_params(|params| {
        if params.window_id.as_deref() == Some(window_id) {
            params.window_id = None;
        }
    });
    emit_params(app, &state)
}

/// While the main window is shown, text goes to the application window the
/// user worked in last rather than the one Tyco was opened from: the main
/// window stays open while the user switches between applications. Only a
/// known window replaces the target; focusing the desktop or a panel keeps it.
pub fn follow_target_window(app: &AppHandle) -> Result<(), AppError> {
    let Some(target) = super::platform::window_tracker::tracker().target() else {
        return Ok(());
    };
    let active_label = app.state::<RuntimeWindows>().active_label();
    let state = app.state::<AppState>();
    let mut changed = false;
    state.update_params(|params| {
        if is_main_window_shown(active_label, params.is_window_shown)
            && params.window_id.as_ref() != Some(&target)
        {
            params.window_id = Some(target);
            changed = true;
        }
    });
    if changed {
        emit_params(app, &state)?;
    }
    Ok(())
}

fn is_main_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == MAIN_WINDOW_LABEL && is_window_shown
}

fn activate_on_main_thread(app: &AppHandle, activation: Activation) -> Result<(), AppError> {
    let window_label = window_label_for_mode(activation.mode);
    let is_quick_window = window_label == QUICK_WINDOW_LABEL;
    app.state::<RuntimeWindows>().set_active_label(window_label);
    hide_inactive_window(app, window_label)?;
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| AppError::Message(format!("Window {window_label} not found")))?;
    let state = app.state::<AppState>();

    // the warmup may have left the window transparent
    #[cfg(target_os = "linux")]
    window.gtk_window()?.set_opacity(1.0);

    let (width, height) = WINDOW_SIZE;
    if is_quick_window {
        let layer = panel_layer(app);
        // a layer surface takes its size from `apply_panel_surface`
        if layer.is_none() {
            window.set_size(tauri::LogicalSize::new(width, height))?;
            window.set_decorations(false)?;
        }
        // a region left by the previous session must not hide the new content
        super::platform::set_panel_input_region(&window, None)?;
        super::platform::apply_panel_surface(&window, activation.mode.profile(), layer)?;
    } else if !(activation.mode == StartMode::VoiceChat && window.is_visible()?) {
        // a follow-up voice question must not move the chat the user placed
        window.set_size(tauri::LogicalSize::new(width, height))?;
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.center()?;
    }
    window.set_focusable(true)?;
    window.show()?;
    super::activation_metrics::mark_show(app);
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window: {error}");
    }

    state.update_params(|params| {
        params.activation_id = params.activation_id.wrapping_add(1);
        params.mode = Some(activation.mode.as_str().into());
        params.window_id = activation.window_id;
        params.selected_text = activation.selected_text;
        params.launcher_request = activation.launcher_request;
        params.is_window_shown = true;
        params.window_profile = activation.mode.profile();
    });
    log::debug!(
        "Activated {:?} from {:?}",
        activation.mode,
        activation.source
    );
    emit_params(app, &state)
}

fn window_label_for_mode(mode: StartMode) -> &'static str {
    match mode {
        StartMode::Write
        | StartMode::Voice
        | StartMode::Select
        | StartMode::AiTasks
        | StartMode::CommandLauncher
        | StartMode::Correction => QUICK_WINDOW_LABEL,
        StartMode::Editor
        | StartMode::Chat
        | StartMode::VoiceChat
        | StartMode::History
        | StartMode::Config => MAIN_WINDOW_LABEL,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum TrayClickAction {
    HideActiveWindow,
    ShowApplication,
}

fn tray_click_action(is_window_shown: bool) -> TrayClickAction {
    if is_window_shown {
        TrayClickAction::HideActiveWindow
    } else {
        TrayClickAction::ShowApplication
    }
}

fn hide_inactive_window(app: &AppHandle, active_label: &str) -> Result<(), AppError> {
    let inactive_label = if active_label == MAIN_WINDOW_LABEL {
        QUICK_WINDOW_LABEL
    } else {
        MAIN_WINDOW_LABEL
    };
    let Some(window) = app.get_webview_window(inactive_label) else {
        return Ok(());
    };

    #[cfg(target_os = "linux")]
    if inactive_label == QUICK_WINDOW_LABEL && app.state::<LayerShell>().supported {
        super::platform::disable_panel_keyboard(&window)?;
    }

    window.hide()?;
    Ok(())
}

/// Shows the main window from the tray or a launch without a mode. The window
/// Tyco was last activated from may be long gone from the user's mind, so the
/// target is taken anew, the way an activation takes it.
pub fn show_application(app: &AppHandle) -> Result<(), AppError> {
    let window_id = super::platform::capture_source();
    on_main_thread(app, move |app| {
        app.state::<AppState>()
            .update_params(|params| params.window_id = window_id);
        show_application_on_main_thread(app)
    })
}

pub fn open_main_editor(
    app: &AppHandle,
    text: Option<String>,
    source_text: Option<String>,
) -> Result<(), AppError> {
    show_main_with(
        app,
        OPEN_MAIN_EDITOR_EVENT,
        serde_json::json!({ "text": text, "sourceText": source_text }),
    )
}

pub fn open_main_chat(app: &AppHandle, text: Option<String>) -> Result<(), AppError> {
    show_main_with(
        app,
        OPEN_MAIN_CHAT_EVENT,
        serde_json::json!({ "text": text }),
    )
}

/// Shows the main window and hands `payload` over to it.
fn show_main_with(
    app: &AppHandle,
    event: &'static str,
    payload: serde_json::Value,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        show_application_on_main_thread(app)?;
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| AppError::Message("Main window not found".into()))?;
        window.emit(event, payload)?;
        Ok(())
    })
}

/// Limits pointer input of the visible quick window to `region`; the rest of
/// the window lets clicks through to the windows below. `None` restores input
/// over the whole window.
pub fn set_quick_input_region(
    app: &AppHandle,
    region: Option<InputRegion>,
) -> Result<(), AppError> {
    on_main_thread(app, move |app| {
        let is_shown = app.state::<AppState>().params().is_window_shown;
        let active_label = app.state::<RuntimeWindows>().active_label();
        // a late request must not narrow the window of the next session
        if region.is_some() && !is_quick_window_shown(active_label, is_shown) {
            return Ok(());
        }
        let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
            return Ok(());
        };
        super::platform::set_panel_input_region(&window, region)
    })
}

fn is_quick_window_shown(active_label: &str, is_window_shown: bool) -> bool {
    active_label == QUICK_WINDOW_LABEL && is_window_shown
}

fn show_application_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    app.state::<RuntimeWindows>()
        .set_active_label(MAIN_WINDOW_LABEL);
    hide_inactive_window(app, MAIN_WINDOW_LABEL)?;

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    let state = app.state::<AppState>();

    window.set_decorations(true)?;
    window.set_resizable(true)?;
    window.set_focusable(true)?;
    window.show()?;
    if let Err(error) = window.unminimize() {
        log::warn!("Could not unminimize window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window: {error}");
    }

    state.update_params(|params| {
        params.activation_id = params.activation_id.wrapping_add(1);
        params.selected_text = None;
        params.mode = Some(StartMode::Editor.as_str().into());
        params.is_window_shown = true;
        params.window_profile = WindowProfile::Sheet;
    });
    log::debug!("Showed main application from tray");
    emit_params(app, &state)
}

pub fn dismiss_quick_window(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, |app| {
        let is_shown = app.state::<AppState>().params().is_window_shown;
        let active_label = app.state::<RuntimeWindows>().active_label();
        if !is_quick_window_shown(active_label, is_shown) {
            return Ok(());
        }
        hide_on_main_thread(app)
    })
}

/// Hides whichever Tyco window is active.
pub fn hide_active_window(app: &AppHandle) -> Result<(), AppError> {
    on_main_thread(app, hide_on_main_thread)
}

fn hide_on_main_thread(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let label = app.state::<RuntimeWindows>().active_label();
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| AppError::Message(format!("Window {label} not found")))?;

    #[cfg(target_os = "linux")]
    if label == QUICK_WINDOW_LABEL && app.state::<LayerShell>().supported {
        super::platform::disable_panel_keyboard(&window)?;
    }

    state.update_params(|params| {
        params.is_window_shown = false;
    });

    window.hide()?;
    emit_params(app, &state)
}

/// Number of warmup cycles; `TYCO_QUICK_WARMUP=0` turns the warmup off.
fn warmup_cycles(value: Option<&str>) -> u32 {
    value
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(DEFAULT_WARMUP_CYCLES)
}

/// The first one or two shows of a window after process start take the slow
/// path: the focus comes late or not at all, and the keys typed meanwhile go to
/// the window below (see dev_docs/quick-input-report.md). The warmup goes
/// through them before the user presses a hotkey. It leaves `AppState` and the
/// webview alone and gives way to a real activation at any step.
fn spawn_quick_warmup(app: AppHandle) {
    let cycles = warmup_cycles(std::env::var(WARMUP_ENV).ok().as_deref());
    if cycles == 0 {
        return;
    }
    thread::spawn(move || {
        thread::sleep(WARMUP_DELAY);
        for _ in 0..cycles {
            let shown = on_main_thread(&app, warmup_show);
            thread::sleep(WARMUP_STEP);
            let hidden = on_main_thread(&app, warmup_hide);
            if let Err(error) = shown.and(hidden) {
                log::warn!("Quick window warmup stopped: {error}");
                return;
            }
            thread::sleep(WARMUP_STEP);
        }
        log::debug!("Quick window warmup finished after {cycles} cycles");
    });
}

fn quick_window_in_use(app: &AppHandle) -> bool {
    is_quick_window_shown(
        app.state::<RuntimeWindows>().active_label(),
        app.state::<AppState>().params().is_window_shown,
    )
}

/// Shows the quick window the way an activation of the write mode does, but
/// transparent and without touching the state.
fn warmup_show(app: &AppHandle) -> Result<(), AppError> {
    if quick_window_in_use(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
    #[cfg(target_os = "linux")]
    window.gtk_window()?.set_opacity(0.0);
    let layer = panel_layer(app);
    if layer.is_none() {
        let (width, height) = WINDOW_SIZE;
        window.set_size(tauri::LogicalSize::new(width, height))?;
    }
    super::platform::apply_panel_surface(&window, WindowProfile::Panel, layer)?;
    window.set_focusable(true)?;
    window.show()?;
    if let Err(error) = window.set_focus() {
        log::warn!("Could not focus window during warmup: {error}");
    }
    Ok(())
}

fn warmup_hide(app: &AppHandle) -> Result<(), AppError> {
    // the user called the window in between: it is theirs now
    if quick_window_in_use(app) {
        return Ok(());
    }
    let window = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
    if panel_layer(app).is_some() {
        super::platform::disable_panel_keyboard(&window)?;
    }
    window.hide()?;
    // the main window shown at startup gets back the focus the warmup took
    if app.state::<AppState>().params().is_window_shown {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            if let Err(error) = main.set_focus() {
                log::warn!("Could not return focus after warmup: {error}");
            }
        }
    }
    Ok(())
}

/// Creates the windows of `tauri.conf.json`, which does not create them
/// itself: it cannot know where the webviews keep their storage, and would
/// put a development build's into the user's data directory.
pub fn create_windows(app: &App) -> Result<(), AppError> {
    let paths = super::app_paths::AppPaths::resolve(app.handle())?;
    for config in &app.config().app.windows {
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
        if let Some(dir) = paths.webview_dir() {
            builder = builder.data_directory(dir.to_path_buf());
        }
        builder.build()?;
    }
    Ok(())
}

pub fn setup(app: &mut App) -> Result<(), AppError> {
    app.manage(ContextCapture::default());
    app.manage(super::selection_replace::SelectionRuns::default());
    app.manage(RuntimeWindows::default());
    let handle = app.handle().clone();
    thread::spawn(move || {
        let selection = tauri::async_runtime::block_on(super::platform::capture_selection(None));
        handle.state::<ContextCapture>().seed_selection(selection);
    });
    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::Message("Main window not found".into()))?;
    super::platform::enable_titlebar_buttons(&main_window)?;
    #[cfg(target_os = "linux")]
    {
        let supported = super::platform::panel_surface_supported();
        if supported {
            let window = app
                .get_webview_window(QUICK_WINDOW_LABEL)
                .ok_or_else(|| AppError::Message("Quick window not found".into()))?;
            super::platform::attach_panel_surface(&window)?;
            log::info!("Using gtk-layer-shell for the quick window");
        } else {
            log::info!("gtk-layer-shell is unavailable; using a regular window");
        }
        app.manage(LayerShell {
            supported,
            keyboard: PanelKeyboard::from_env(),
        });
    }
    setup_tray(app)?;
    spawn_quick_warmup(app.handle().clone());
    Ok(())
}

fn setup_tray(app: &mut App) -> Result<(), AppError> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show Tyco").build(app)?;
    let correct_item =
        MenuItemBuilder::with_id(TRAY_CORRECT_ID, "Correct selected text").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &correct_item])
        .separator()
        .items(&[&quit_item])
        .build()?;

    let tray_icon = app.default_window_icon().cloned();

    let mut builder = TrayIconBuilder::with_id("main-tray");

    if let Some(icon) = tray_icon {
        builder = builder.icon(icon);
    }

    builder
        .menu(&menu)
        .tooltip("TyCo - typing companion")
        .on_menu_event(move |app, event| {
            if let Some(state) = app.try_state::<AppState>() {
                match event.id.as_ref() {
                    TRAY_SHOW_ID => {
                        if let Err(error) = show_application(app) {
                            log::error!("Could not show the application: {error}");
                        }
                    }
                    TRAY_CORRECT_ID => {
                        if let Err(error) = super::selection_replace::trigger(
                            app,
                            "correction",
                            super::selection_replace::TriggerWait::Delay(
                                super::selection_replace::TRAY_MENU_DELAY,
                            ),
                        ) {
                            log::error!("Could not correct the selection: {error}");
                        }
                    }
                    TRAY_QUIT_ID => {
                        state.set_quitting(true);
                        app.exit(0);
                    }
                    _ => {}
                }
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    let params = state.params();
                    let result = match tray_click_action(params.is_window_shown) {
                        TrayClickAction::HideActiveWindow => hide_active_window(app),
                        TrayClickAction::ShowApplication => show_application(app),
                    };
                    if let Err(error) = result {
                        log::error!("Tray click failed: {error}");
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub fn handle_window_event(app: &AppHandle, window_label: &str, event: &WindowEvent) {
    if let Some(state) = app.try_state::<AppState>() {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !state.is_quitting() {
                    api.prevent_close();
                    if window_label == MAIN_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(MAIN_WINDOW_LABEL);
                        if let Err(error) =
                            app.emit_to(MAIN_WINDOW_LABEL, MAIN_WINDOW_CLOSED_EVENT, ())
                        {
                            log::warn!("Could not report the closed main window: {error}");
                        }
                    } else if window_label == QUICK_WINDOW_LABEL {
                        app.state::<RuntimeWindows>()
                            .set_active_label(QUICK_WINDOW_LABEL);
                    }
                    if let Err(error) = hide_active_window(app) {
                        log::error!("Could not hide the {window_label} window: {error}");
                    }
                }
            }
            WindowEvent::Focused(true) => {
                super::activation_metrics::mark_os_focus(app);
                #[cfg(target_os = "linux")]
                if window_label == QUICK_WINDOW_LABEL {
                    settle_quick_keyboard(app);
                }
            }
            WindowEvent::Focused(false) => {}
            _ => {}
        }
    }
}

/// Leaves the exclusive grab once the quick window has the focus. Runs on the
/// main thread, as window events do.
#[cfg(target_os = "linux")]
fn settle_quick_keyboard(app: &AppHandle) {
    let Some(keyboard) = panel_layer(app) else {
        return;
    };
    if let Some(window) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        if let Err(error) = super::platform::settle_panel_keyboard(&window, keyboard) {
            log::warn!("Could not release the keyboard grab: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warmup_runs_three_cycles_unless_configured() {
        assert_eq!(warmup_cycles(None), 3);
        assert_eq!(warmup_cycles(Some("0")), 0);
        assert_eq!(warmup_cycles(Some(" 1 ")), 1);
        assert_eq!(warmup_cycles(Some("many")), 3);
    }

    #[test]
    fn quick_modes_use_the_quick_window_and_main_modes_use_the_main_window() {
        for mode in [
            StartMode::Write,
            StartMode::Voice,
            StartMode::Select,
            StartMode::AiTasks,
            StartMode::CommandLauncher,
            StartMode::Correction,
        ] {
            assert_eq!(window_label_for_mode(mode), QUICK_WINDOW_LABEL);
        }
        for mode in [
            StartMode::Editor,
            StartMode::Chat,
            StartMode::VoiceChat,
            StartMode::History,
            StartMode::Config,
        ] {
            assert_eq!(window_label_for_mode(mode), MAIN_WINDOW_LABEL);
        }
    }

    #[test]
    fn only_a_changed_selection_is_fresh() {
        let capture = ContextCapture::default();
        assert_eq!(
            capture.fresh_selection(Some("a".into())).as_deref(),
            Some("a")
        );
        assert_eq!(capture.fresh_selection(Some("a".into())), None);
        assert_eq!(
            capture.fresh_selection(Some("b".into())).as_deref(),
            Some("b")
        );
        assert_eq!(capture.fresh_selection(None), None);
        assert_eq!(
            capture.fresh_selection(Some("b".into())).as_deref(),
            Some("b")
        );
    }

    #[test]
    fn the_selection_present_at_startup_is_not_fresh() {
        let capture = ContextCapture::default();
        capture.seed_selection(Some("old".into()));
        assert_eq!(capture.fresh_selection(Some("old".into())), None);

        let captured_first = ContextCapture::default();
        assert_eq!(
            captured_first.fresh_selection(Some("a".into())).as_deref(),
            Some("a")
        );
        captured_first.seed_selection(Some("b".into()));
        assert_eq!(captured_first.fresh_selection(Some("a".into())), None);
    }

    #[test]
    fn tray_click_hides_a_visible_window_and_shows_the_application_otherwise() {
        assert_eq!(tray_click_action(true), TrayClickAction::HideActiveWindow);
        assert_eq!(tray_click_action(false), TrayClickAction::ShowApplication);
    }

    #[test]
    fn follows_the_target_only_while_the_main_window_is_shown() {
        assert!(is_main_window_shown(MAIN_WINDOW_LABEL, true));
        assert!(!is_main_window_shown(MAIN_WINDOW_LABEL, false));
        assert!(!is_main_window_shown(QUICK_WINDOW_LABEL, true));
    }

    #[test]
    fn detects_only_the_visible_active_quick_window() {
        assert!(is_quick_window_shown(QUICK_WINDOW_LABEL, true));
        assert!(!is_quick_window_shown(QUICK_WINDOW_LABEL, false));
        assert!(!is_quick_window_shown(MAIN_WINDOW_LABEL, true));
    }
}
