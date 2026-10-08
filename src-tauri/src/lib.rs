mod commands;
mod errors;
mod models;
mod services;
mod state;

use commands::actions::{
    cancel_script_action, execute_script_action, log_client_message, log_command_run,
    log_custom_action, pick_directory, pick_script_file, set_tool_catalog,
};
use commands::app::{
    activate_mode, apply_hotkey, configure_hotkeys, get_hotkey_provider_info, get_init_params,
    get_storage_info, get_user_config, mark_activation_metric, open_main_chat, open_main_editor,
    open_storage_location, patch_local_state, rebind_hotkeys, save_user_config,
    submit_activation_metric_value, suspend_hotkeys,
};
use commands::history::{
    clear_chat_history, clear_editor_history, get_chat, get_chat_history, get_editor_history,
    remove_from_chat_history, remove_from_editor_history, rename_chat, restore_editor_history_item,
    save_chat_history, save_editor_history, search_chat_history, set_editor_history_result,
};
use commands::net::{
    net_cancel, net_fetch, net_socket_close, net_socket_open, net_socket_send_binary,
    net_socket_send_text,
};
use commands::notes::{append_note, save_note};
use commands::secrets::{secrets_remove, secrets_set, secrets_status};
use commands::selection::{
    check_text_injection, finish_selection_run, notify_desktop, replace_selection_with_command,
    show_status_overlay,
};
use commands::voice::{start_voice_capture, stop_voice_capture};
use commands::window::{
    close_window, copy_text, dismiss_quick_window, open_in_browser_and_close,
    put_into_clipboard_and_close, set_quick_input_region, type_into_window_and_close,
};
use models::default_init_params;
#[cfg(target_os = "linux")]
use services::dbus;
use services::{runtime, storage};
use state::AppState;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_single_instance::init as single_instance;

const LOG_FILE_NAME: &str = "tyco";
const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;
const LOG_ROTATION_KEEP_FILES: usize = 5;

/// Writes to stdout during development and to the platform log directory in a
/// bundled app, where stderr is not visible to anyone.
fn logger_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let file_target = services::app_paths::early_log_dir("com.tyco.app")
        .expect("TYCO_DEV_HOME must contain a valid absolute path")
        .map_or(
            TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.to_string()),
            },
            |path| TargetKind::Folder {
                path,
                file_name: Some(LOG_FILE_NAME.to_string()),
            },
        );

    tauri_plugin_log::Builder::new()
        .level(level)
        .level_for("reqwest", log::LevelFilter::Info)
        .level_for("tungstenite", log::LevelFilter::Info)
        .level_for("tokio_tungstenite", log::LevelFilter::Info)
        .level_for("hyper", log::LevelFilter::Info)
        .level_for("h2", log::LevelFilter::Info)
        .level_for("tracing", log::LevelFilter::Info)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_ROTATION_KEEP_FILES))
        .targets([Target::new(TargetKind::Stdout), Target::new(file_target)])
        .build()
}

/// How long the first activation waits for the window tracker. It normally
/// reports within a few dozen milliseconds.
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

/// Follows window changes on X11 the way `dbus` follows the KWin tracker.
#[cfg(target_os = "linux")]
fn spawn_x11_tracker(app: tauri::AppHandle) {
    use services::platform::window_tracker::TrackerChange;

    // GTK puts the program name into WM_CLASS
    let own_class = gtk::glib::prgname().unwrap_or_default().to_string();
    services::platform::linux::x11::spawn_tracker(own_class, move |change| {
        let result = match change {
            TrackerChange::Activated => runtime::follow_target_window(&app),
            TrackerChange::Closed(id) => runtime::forget_target_window(&app, &id),
        };
        if let Err(error) = result {
            log::warn!("Could not follow the window change: {error}");
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logger_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(single_instance(|app, args, _cwd| {
            if let Err(error) = activate_from_args(app, &args) {
                log::error!("CLI activation failed: {error}");
            }
        }))
        .setup(|app| {
            runtime::create_windows(app)?;
            let user_config = storage::read_or_create_user_config(app.handle())?;
            if let Err(error) =
                storage::apply_history_settings_on_startup(app.handle(), &user_config)
            {
                log::error!("Could not apply the history settings: {error}");
            }
            let local_state = storage::read_or_create_local_state(app.handle())?;
            app.manage(AppState::new(default_init_params(user_config, local_state)));
            app.manage(services::secrets::SecretStore::load_for_app(app.handle())?);
            app.manage(services::net::NetState::new()?);
            services::hotkeys::setup(app)?;
            runtime::setup(app)?;
            services::activation_metrics::setup(app)?;
            // the activation below needs the window tracker to know the
            // window Tyco was launched from
            #[cfg(target_os = "linux")]
            {
                dbus::spawn_dbus_server(app.handle().clone());
                let session = services::platform::session::current();
                if session.is_x11() {
                    spawn_x11_tracker(app.handle().clone());
                }
                if session.is_wayland() {
                    services::platform::linux::primary_selection::spawn_watcher();
                }
                if session.is_x11() || session.is_kde_wayland() {
                    services::platform::window_tracker::wait_for_startup(TRACKER_STARTUP_WAIT);
                }
            }
            let args = std::env::args().collect::<Vec<_>>();
            activate_from_args(app.handle(), &args)?;
            services::activation_socket::spawn_server(app.handle().clone());
            services::signals::spawn_signal_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            runtime::handle_window_event(window.app_handle(), window.label(), event);
        })
        .invoke_handler(tauri::generate_handler![
            get_init_params,
            get_user_config,
            get_storage_info,
            open_storage_location,
            apply_hotkey,
            configure_hotkeys,
            rebind_hotkeys,
            suspend_hotkeys,
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
            rename_chat,
            search_chat_history,
            remove_from_editor_history,
            remove_from_chat_history,
            clear_editor_history,
            clear_chat_history,
            start_voice_capture,
            stop_voice_capture,
            open_in_browser_and_close,
            type_into_window_and_close,
            put_into_clipboard_and_close,
            copy_text,
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
            replace_selection_with_command,
            show_status_overlay,
            notify_desktop,
            check_text_injection,
            execute_script_action,
            cancel_script_action,
            pick_script_file,
            pick_directory,
            log_custom_action,
            log_command_run,
            log_client_message,
            set_tool_catalog,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                runtime::shutdown(app);
            }
        });
}
