fn generate_desktop_contract() {
    let limits_path = "../packages/shared/src/desktop-limits.json";
    let locales_path = "../packages/plugin-sdk/src/locales.json";
    println!("cargo:rerun-if-changed={limits_path}");
    println!("cargo:rerun-if-changed={locales_path}");
    let limits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&std::fs::read_to_string(limits_path).expect("Read desktop limits"))
            .expect("Parse desktop limits");
    let mut source = String::new();
    for (name, value) in limits {
        assert!(name.chars().all(|c| c.is_ascii_uppercase() || c == '_'));
        let rust_type = match name.as_str() {
            "MAX_PROFILE_TEMPERATURE" => "f64",
            "MAX_TOOL_STEP_COUNT" | "MAX_CHAT_IMAGE_DIMENSION" => "u32",
            "MAX_CHAT_IMAGE_PIXELS" => "u64",
            _ if value.is_string() => "&str",
            _ => "usize",
        };
        let literal = if rust_type == "f64" {
            format!("{:?}", value.as_f64().expect("Numeric desktop limit"))
        } else {
            value.to_string()
        };
        source.push_str(&format!("pub const {name}: {rust_type} = {literal};\n"));
    }
    let locales: Vec<String> =
        serde_json::from_str(&std::fs::read_to_string(locales_path).expect("Read plugin locales"))
            .expect("Parse plugin locales");
    source.push_str(&format!(
        "pub const SUPPORTED_PLUGIN_LOCALES: [&str; {}] = {:?};\n",
        locales.len(),
        locales
    ));
    let out =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Build output directory"));
    std::fs::write(out.join("desktop_contract.rs"), source).expect("Write desktop contract");
}

fn main() {
    generate_desktop_contract();
    // the target, not the host this script runs on, decides; they differ
    // when cross-compiling
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-lib=gtk-layer-shell");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "acknowledge_fetch_chunk",
            "acknowledge_settings_shutdown",
            "activate_mode",
            "add_ai_profile_memory_fact",
            "add_editor_history_item",
            "answer_external_access",
            "apply_hotkey",
            "cancel_net_task",
            "cancel_script_action",
            "claim_external_job",
            "clear_ai_profile_memory",
            "clear_chats",
            "clear_editor_history",
            "close_socket",
            "copy_text",
            "create_ai_profile",
            "create_ai_project",
            "delete_ai_profile",
            "delete_ai_project",
            "delete_chat",
            "delete_editor_history_item",
            "delete_secret",
            "execute_script_action",
            "finish_external_job",
            "finish_selection_run",
            "get_ai_profile",
            "get_ai_vault_path",
            "get_chat",
            "get_desktop_state",
            "get_editor_history",
            "get_hotkey_provider_info",
            "get_secret_statuses",
            "get_secret_vault_state",
            "get_storage_info",
            "get_text_insertion_status",
            "inspect_ai_vault_target",
            "hide_quick_window_on_blur",
            "hide_window",
            "install_plugin_package",
            "list_ai_file_roots",
            "list_ai_profile_memory_topics",
            "list_ai_profiles",
            "list_ai_projects",
            "list_chats",
            "list_installed_plugins",
            "log_client_message",
            "log_command_run",
            "log_webhook_call",
            "mark_activation_metric",
            "open_action_log",
            "open_ai_vault_location",
            "open_in_browser",
            "open_in_browser_and_hide",
            "open_main_chat",
            "open_main_editor",
            "open_socket",
            "open_storage_location",
            "open_system_hotkey_settings",
            "paste_into_target_and_hide",
            "patch_session_state",
            "pick_directory",
            "pick_plugin_package",
            "pick_script_file",
            "preview_ai_file_change",
            "read_ai_file_bytes",
            "read_ai_profile_memory",
            "read_ai_profile_soul",
            "read_chat_image",
            "read_dropped_file",
            "rebind_hotkeys",
            "release_deleted_chat_images",
            "relocate_ai_vault",
            "rename_chat",
            "replace_ai_profile_memory",
            "replace_selection_with_command",
            "request_text_insertion_permission",
            "restore_editor_history_item",
            "restore_previous_plugin_package",
            "rewrite_ai_profile_memory",
            "run_ai_file_tool",
            "save_ai_profile",
            "save_ai_project",
            "save_ai_upload",
            "save_chat",
            "save_user_config",
            "search_ai_profile_memory",
            "search_chats",
            "send_socket_binary",
            "send_socket_text",
            "set_editor_history_item_result",
            "set_quick_input_region",
            "set_secret",
            "set_tool_catalog",
            "set_tray_menu_labels",
            "show_desktop_notification",
            "show_status_overlay",
            "start_fetch",
            "start_voice_capture",
            "stop_voice_capture",
            "store_chat_image",
            "submit_activation_metric_value",
            "suspend_hotkeys",
            "sync_chat_images",
            "undo_ai_profile_memory",
            "uninstall_plugin_package",
            "write_ai_profile_soul",
            "write_plugin_note",
        ]),
    ))
    .expect("Failed to build Tauri command permissions")
}
