mod commands;
mod errors;
mod models;
mod services;
mod state;

use commands::app::{get_init_params, get_storage_info, save_local_state, save_user_config};
use commands::history::{
    clear_chat_history, clear_editor_history, get_chat, get_chat_history, get_editor_history,
    remove_from_chat_history, remove_from_editor_history, restore_editor_history_item,
    save_chat_history, save_editor_history, set_editor_history_result,
};
use commands::notes::save_note;
use commands::voice::{
    start_local_voice_recording, start_voice_recognition, stop_local_voice_recording,
    stop_voice_recognition,
};
use commands::window::{
    close_window, open_in_browser_and_close, put_into_clipboard_and_close,
    type_into_window_and_close,
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

    tauri_plugin_log::Builder::new()
        .level(level)
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir { file_name: None }),
        ])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logger_plugin())
        .plugin(single_instance(|app, args, _cwd| {
            let activation = runtime::Activation::from_args(&args).map(|value| {
                value.unwrap_or_else(|| {
                    let mode = app
                        .try_state::<AppState>()
                        .and_then(|state| state.params().mode)
                        .and_then(|mode| runtime::StartMode::parse(&mode).ok())
                        .unwrap_or(runtime::StartMode::Editor);
                    runtime::Activation::new(mode, runtime::ActivationSource::Cli)
                })
            });
            match activation.and_then(|activation| runtime::activate(app, activation)) {
                Ok(()) => {}
                Err(error) => log::error!("CLI activation failed: {error}"),
            }
        }))
        .setup(|app| {
            let user_config = storage::read_or_create_user_config(app.handle())?;
            let local_state = storage::read_or_create_local_state(app.handle())?;
            app.manage(AppState::new(default_init_params(user_config, local_state)));
            #[cfg(target_os = "linux")]
            services::hotkeys::setup(app)?;
            runtime::setup(app)?;
            let args = std::env::args().collect::<Vec<_>>();
            match runtime::Activation::from_args(&args) {
                Ok(Some(activation)) => runtime::activate(app.handle(), activation)?,
                Ok(None) => {}
                Err(error) => log::error!("CLI activation failed: {error}"),
            }
            #[cfg(target_os = "linux")]
            dbus::spawn_dbus_server(app.handle().clone());
            services::activation_socket::spawn_server(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            runtime::handle_window_event(window.app_handle(), event);
        })
        .invoke_handler(tauri::generate_handler![
            get_init_params,
            get_storage_info,
            save_user_config,
            save_local_state,
            close_window,
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
            start_voice_recognition,
            stop_voice_recognition,
            start_local_voice_recording,
            stop_local_voice_recording,
            open_in_browser_and_close,
            type_into_window_and_close,
            put_into_clipboard_and_close,
            save_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
