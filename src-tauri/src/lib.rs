mod commands;
mod errors;
mod models;
mod services;
mod state;

use commands::actions::{execute_script_action, pick_script_file};
use commands::app::{
    activate_mode, apply_hotkey, configure_hotkeys, get_hotkey_provider_info, get_init_params,
    get_storage_info, mark_activation_metric, open_main_chat, open_main_editor, patch_local_state,
    save_user_config, submit_activation_metric_value,
};
use commands::history::{
    clear_chat_history, clear_editor_history, get_chat, get_chat_history, get_editor_history,
    remove_from_chat_history, remove_from_editor_history, restore_editor_history_item,
    save_chat_history, save_editor_history, set_editor_history_result,
};
use commands::net::{
    net_cancel, net_fetch, net_socket_close, net_socket_open, net_socket_send_binary,
    net_socket_send_text,
};
use commands::notes::{append_note, save_note};
use commands::secrets::{secrets_remove, secrets_set, secrets_status};
use commands::selection::{
    check_text_injection, finish_selection_run, notify_desktop, show_status_overlay,
};
use commands::voice::{start_voice_capture, stop_voice_capture};
use commands::window::{
    close_window, dismiss_quick_window, open_in_browser_and_close, put_into_clipboard_and_close,
    set_quick_input_region, type_into_window_and_close,
};
use models::default_init_params;
#[cfg(target_os = "linux")]
use services::dbus;
use services::{runtime, storage};
use state::AppState;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_single_instance::init as single_instance;

/// Writes to stdout during development and to the platform log directory in a
/// bundled app, where stderr is not visible to anyone.
fn logger_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let file_target = services::app_paths::dev_paths_from_env("com.tyco.app")
        .expect("TYCO_DEV_HOME must contain a valid absolute path")
        .map_or(TargetKind::LogDir { file_name: None }, |paths| {
            TargetKind::Folder {
                path: paths.log_dir,
                file_name: None,
            }
        });

    tauri_plugin_log::Builder::new()
        .level(level)
        .targets([Target::new(TargetKind::Stdout), Target::new(file_target)])
        .build()
}

/// How long the first activation waits for the KWin window tracker. It
/// normally reports within a few dozen milliseconds.
#[cfg(target_os = "linux")]
const TRACKER_STARTUP_WAIT: std::time::Duration = std::time::Duration::from_millis(800);

/// Runs the activation the command line asks for. Arguments that cannot be
/// parsed still show the application: a launch must never end up without a
/// window and without a word to the user.
fn activate_from_args(app: &tauri::AppHandle, args: &[String]) -> Result<(), errors::AppError> {
    match runtime::Activation::from_args(args) {
        Ok(Some(activation)) => runtime::activate(app, activation),
        Ok(None) => runtime::show_application(app),
        Err(error) => {
            log::error!("Ignoring invalid command line arguments: {error}");
            runtime::show_application(app)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logger_plugin())
        .plugin(single_instance(|app, args, _cwd| {
            if let Err(error) = activate_from_args(app, &args) {
                log::error!("CLI activation failed: {error}");
            }
        }))
        .setup(|app| {
            let user_config = storage::read_or_create_user_config(app.handle())?;
            let _ = storage::cleanup_editor_history(app.handle(), &user_config);
            let local_state = storage::read_or_create_local_state(app.handle())?;
            app.manage(AppState::new(default_init_params(user_config, local_state)));
            app.manage(services::secrets::SecretStore::load_for_app(app.handle())?);
            app.manage(services::net::NetState::new()?);
            services::hotkeys::setup(app)?;
            runtime::setup(app)?;
            services::activation_metrics::setup(app)?;
            // the activation below needs the KWin tracker to know the window
            // Tyco was launched from
            #[cfg(target_os = "linux")]
            {
                dbus::spawn_dbus_server(app.handle().clone());
                if services::kwin_windows::is_kde_wayland_session() {
                    services::kwin_windows::wait_for_startup(TRACKER_STARTUP_WAIT);
                }
            }
            let args = std::env::args().collect::<Vec<_>>();
            activate_from_args(app.handle(), &args)?;
            services::activation_socket::spawn_server(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            runtime::handle_window_event(window.app_handle(), window.label(), event);
        })
        .invoke_handler(tauri::generate_handler![
            get_init_params,
            get_storage_info,
            apply_hotkey,
            configure_hotkeys,
            get_hotkey_provider_info,
            open_main_chat,
            open_main_editor,
            activate_mode,
            mark_activation_metric,
            submit_activation_metric_value,
            save_user_config,
            patch_local_state,
            close_window,
            dismiss_quick_window,
            set_quick_input_region,
            get_editor_history,
            get_chat_history,
            get_chat,
            save_editor_history,
            set_editor_history_result,
            restore_editor_history_item,
            save_chat_history,
            remove_from_editor_history,
            remove_from_chat_history,
            clear_editor_history,
            clear_chat_history,
            start_voice_capture,
            stop_voice_capture,
            open_in_browser_and_close,
            type_into_window_and_close,
            put_into_clipboard_and_close,
            save_note,
            append_note,
            net_fetch,
            net_cancel,
            net_socket_open,
            net_socket_send_text,
            net_socket_send_binary,
            net_socket_close,
            secrets_status,
            secrets_set,
            secrets_remove,
            finish_selection_run,
            show_status_overlay,
            notify_desktop,
            check_text_injection,
            execute_script_action,
            pick_script_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    let params = state.params();
                    let _ = storage::cleanup_editor_history(app, &params.user_config);
                }
                services::kwin_windows::stop_tracker();
            }
        });
}
