#[cfg(test)]
mod bindings;
mod commands;
mod errors;
mod events;
mod ipc;
mod locks;
mod models;
mod services;
mod state;

use services::settings::defaults::default_desktop_snapshot;
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

    let file_target = services::storage::app_paths::early_log_dir("com.tyco.app")
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

/// Follows the window the user works in, to insert text there later.
fn follow_window_change(
    app: &tauri::AppHandle,
    change: services::platform::window_tracker::TrackerChange,
) {
    use services::platform::window_tracker::TrackerChange;
    let result = match change {
        TrackerChange::Activated => runtime::follow_target_window(app),
        TrackerChange::Closed(id) => runtime::forget_target_window(app, &id),
    };
    if let Err(error) = result {
        log::warn!("Could not follow the window change: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // state that needs nothing to be built exists before any window or
    // event can ask for it; what needs the config or a window is managed in
    // `setup`
    let builder = services::hotkeys::manage_state(runtime::manage_state(
        tauri::Builder::default()
            .manage(services::background::BackgroundServices::default())
            .manage(services::custom_actions::ScriptRuns::default())
            .manage(services::external::jobs::ExternalJobs::default())
            .manage(services::external::command_library::ToolCatalogState::default())
            .manage(services::chat_images::ChatImages::default())
            .manage(services::dropped_files::DroppedFiles::default())
            .manage(commands::plugins::PluginInspection::default())
            .manage(services::voice::session::VoiceSessionState::default())
            .manage(services::external::access::AccessPrompt::default()),
    ));
    let app = builder
        // reading a package may take a while; the main thread must not wait
        .register_asynchronous_uri_scheme_protocol(
            services::plugins::protocol::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(services::plugins::protocol::respond(&app, &request));
                });
            },
        )
        .plugin(logger_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(single_instance(|app, args, _cwd| {
            if let Err(error) = activate_from_args(app, &args) {
                log::error!("CLI activation failed: {error}");
            }
        }))
        .setup(|app| {
            app.manage(services::plugins::PluginStore::new(
                storage::app_data_dir(app.handle())?.join("plugins"),
            ));
            let user_config =
                services::settings::persist::read_or_create_user_config(app.handle())?;
            let history_cleanup_failed = match storage::apply_history_settings_on_startup(
                app.handle(),
                &user_config.value,
            ) {
                Ok(()) => false,
                Err(error) => {
                    log::error!("Could not apply the history settings: {error}");
                    true
                }
            };
            // the state every command and window event reads exists before
            // the first webview can call one
            app.manage(AppState::new(default_desktop_snapshot(
                user_config.value.clone(),
                crate::models::SessionState::default(),
            )));
            if history_cleanup_failed {
                app.state::<AppState>().history.mark_cleanup_pending();
            }
            app.manage(services::secrets::SecretStore::load_for_app(app.handle())?);
            // reaching the system store may wait for an unlock prompt, which
            // must not hold up the start
            let secrets_app = app.handle().clone();
            app.state::<services::background::BackgroundServices>()
                .spawn_thread("secret-vault-warmup", move |_| {
                    let store = secrets_app.state::<services::secrets::SecretStore>();
                    store.vault_state();
                    if !user_config.is_on_disk {
                        return;
                    }
                    // A settings save meanwhile may have left secrets for its
                    // undo; the next start cleans up after it.
                    let state = secrets_app.state::<AppState>();
                    let _settings = state.lock_settings_update();
                    if *state.user_config() == user_config.value {
                        services::secrets::webhook::cleanup_after_startup(
                            &store,
                            &user_config.value,
                        );
                    }
                })?;
            runtime::create_windows(app)?;
            app.manage(services::net::NetState::new()?);
            services::hotkeys::setup(app)?;
            runtime::setup(app)?;
            services::activation::metrics::setup(app)?;
            // the activation below needs the window tracker to know the
            // window Tyco was launched from
            services::platform::start_session_services(app.handle(), follow_window_change)?;
            let args = std::env::args().collect::<Vec<_>>();
            activate_from_args(app.handle(), &args)?;
            services::external::api::spawn_reaper(app.handle().clone())?;
            services::activation::socket::spawn_server(app.handle().clone())?;
            services::signals::spawn_signal_watcher(app.handle().clone())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            runtime::handle_window_event(window.app_handle(), window.label(), event);
        })
        // a webview of a plain window reports its drops here, a webview
        // window above
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                webview
                    .state::<services::dropped_files::DroppedFiles>()
                    .record(webview.label(), paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::action_logs::log_client_message,
            commands::action_logs::log_command_run,
            commands::action_logs::log_webhook_call,
            commands::action_logs::open_action_log,
            commands::activation::activate_mode,
            commands::activation::open_main_chat,
            commands::activation::open_main_editor,
            commands::ai_files::list_ai_file_roots,
            commands::ai_files::preview_ai_file_change,
            commands::ai_files::read_ai_file_bytes,
            commands::ai_files::run_ai_file_tool,
            commands::ai_files::save_ai_upload,
            commands::ai_vault::create_ai_profile,
            commands::ai_vault::create_ai_project,
            commands::ai_vault::delete_ai_profile,
            commands::ai_vault::delete_ai_project,
            commands::ai_vault::get_ai_profile,
            commands::ai_vault::get_ai_vault_path,
            commands::ai_vault::list_ai_profiles,
            commands::ai_vault::list_ai_projects,
            commands::ai_vault::open_ai_vault_location,
            commands::ai_vault::read_ai_profile_soul,
            commands::ai_vault::save_ai_profile,
            commands::ai_vault::save_ai_project,
            commands::ai_vault::write_ai_profile_soul,
            commands::chat_images::read_chat_image,
            commands::chat_images::read_dropped_file,
            commands::chat_images::release_deleted_chat_images,
            commands::chat_images::store_chat_image,
            commands::chat_images::sync_chat_images,
            commands::chats::clear_chats,
            commands::chats::delete_chat,
            commands::chats::get_chat,
            commands::chats::list_chats,
            commands::chats::rename_chat,
            commands::chats::save_chat,
            commands::chats::search_chats,
            commands::desktop_state::get_desktop_state,
            commands::diagnostics::mark_activation_metric,
            commands::diagnostics::submit_activation_metric_value,
            commands::editor_history::add_editor_history_item,
            commands::editor_history::clear_editor_history,
            commands::editor_history::delete_editor_history_item,
            commands::editor_history::get_editor_history,
            commands::editor_history::restore_editor_history_item,
            commands::editor_history::set_editor_history_item_result,
            commands::external_jobs::answer_external_access,
            commands::external_jobs::claim_external_job,
            commands::external_jobs::finish_external_job,
            commands::external_jobs::set_tool_catalog,
            commands::hotkeys::apply_hotkey,
            commands::hotkeys::get_hotkey_provider_info,
            commands::hotkeys::open_system_hotkey_settings,
            commands::hotkeys::rebind_hotkeys,
            commands::hotkeys::suspend_hotkeys,
            commands::net::acknowledge_fetch_chunk,
            commands::net::cancel_net_task,
            commands::net::close_socket,
            commands::net::open_socket,
            commands::net::send_socket_binary,
            commands::net::send_socket_text,
            commands::net::start_fetch,
            commands::plugins::install_plugin_package,
            commands::plugins::list_installed_plugins,
            commands::plugins::pick_plugin_package,
            commands::plugins::restore_previous_plugin_package,
            commands::plugins::uninstall_plugin_package,
            commands::plugins::write_plugin_note,
            commands::script_actions::cancel_script_action,
            commands::script_actions::execute_script_action,
            commands::script_actions::pick_directory,
            commands::script_actions::pick_script_file,
            commands::secrets::delete_secret,
            commands::secrets::get_secret_statuses,
            commands::secrets::get_secret_vault_state,
            commands::secrets::set_secret,
            commands::selection::check_text_injection,
            commands::selection::finish_selection_run,
            commands::selection::replace_selection_with_command,
            commands::settings::acknowledge_settings_shutdown,
            commands::settings::patch_session_state,
            commands::settings::save_user_config,
            commands::storage::get_storage_info,
            commands::storage::open_storage_location,
            commands::system::copy_text,
            commands::system::open_in_browser,
            commands::system::show_desktop_notification,
            commands::system::show_status_overlay,
            commands::voice::start_voice_capture,
            commands::voice::stop_voice_capture,
            commands::window::hide_quick_window_on_blur,
            commands::window::hide_window,
            commands::window::open_in_browser_and_hide,
            commands::window::paste_into_target_and_hide,
            commands::window::set_quick_input_region,
        ])
        .build(tauri::generate_context!());
    // a failed start ends with a word in the log and on stderr rather than
    // with an abort, which `panic = "abort"` would make of an `expect`
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            log::error!("Tyco could not start: {error}");
            eprintln!("Tyco could not start: {error}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            if let Some(state) = app.try_state::<AppState>() {
                if !state.is_quitting() {
                    api.prevent_exit();
                    runtime::settings_shutdown::request(app);
                }
            }
        }
        tauri::RunEvent::Exit => runtime::shutdown(app),
        _ => {}
    });
}
