mod commands;
mod errors;
mod models;
mod services;
mod state;

use commands::app::{get_init_params, get_storage_info, save_local_state, save_user_config};
use commands::history::{
    clear_chat_history, clear_editor_history, clear_main_input_tmp, clear_transform_history,
    get_chat, get_chat_history, get_editor_history, get_transform_history,
    remove_from_chat_history, remove_from_editor_history, remove_from_transform_history,
    save_chat_history, save_editor_history, save_main_input_tmp, save_transform_history,
};
use commands::llm::{
    complete_llm_model_download, delete_llm_model, get_llm_model_file_size, get_llm_model_metadata,
    get_llm_model_path, is_llm_model_downloaded, save_llm_model_file, save_llm_model_file_chunk,
};
use commands::voice::{
    start_local_voice_recording, start_voice_recognition, stop_local_voice_recording,
    stop_voice_recognition,
};
use commands::whisper::{
    complete_whisper_model_download, delete_whisper_model, get_whisper_model_file_size,
    get_whisper_model_metadata, get_whisper_model_path, is_whisper_model_downloaded,
    save_whisper_model_file, save_whisper_model_file_chunk,
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
        .plugin(single_instance(|app, _args, _cwd| {
            if let Some(state) = app.try_state::<AppState>() {
                let _ = runtime::show_main_window(app, &state, None);
            }
        }))
        .setup(|app| {
            let user_config = storage::read_or_create_user_config(app.handle())?;
            let local_state = storage::read_or_create_local_state(app.handle())?;
            app.manage(AppState::new(default_init_params(user_config, local_state)));
            runtime::setup(app)?;
            #[cfg(target_os = "linux")]
            dbus::spawn_dbus_server(app.handle().clone());
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
            get_transform_history,
            get_chat_history,
            get_chat,
            save_main_input_tmp,
            clear_main_input_tmp,
            save_editor_history,
            save_transform_history,
            save_chat_history,
            remove_from_editor_history,
            remove_from_transform_history,
            remove_from_chat_history,
            clear_editor_history,
            clear_transform_history,
            clear_chat_history,
            start_voice_recognition,
            stop_voice_recognition,
            start_local_voice_recording,
            stop_local_voice_recording,
            open_in_browser_and_close,
            type_into_window_and_close,
            put_into_clipboard_and_close,
            is_whisper_model_downloaded,
            save_whisper_model_file,
            save_whisper_model_file_chunk,
            complete_whisper_model_download,
            get_whisper_model_metadata,
            delete_whisper_model,
            get_whisper_model_path,
            get_whisper_model_file_size,
            is_llm_model_downloaded,
            save_llm_model_file,
            save_llm_model_file_chunk,
            complete_llm_model_download,
            get_llm_model_metadata,
            delete_llm_model,
            get_llm_model_path,
            get_llm_model_file_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
