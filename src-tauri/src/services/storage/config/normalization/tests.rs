use super::*;
use crate::models::default_user_config;
use serde_json::{json, Value};

#[test]
fn window_insertion_defaults_follow_the_injected_session() {
    use super::window_insertion::normalize_window_insertion_for_session;
    use crate::services::platform::session::{Desktop, DisplayServer, Session};

    for (display, expected_method) in [
        (DisplayServer::X11, "xdotool"),
        (DisplayServer::Wayland, "ydotool"),
        (DisplayServer::Native, "xdotool"),
        (DisplayServer::Unknown, "xdotool"),
    ] {
        let session = Session {
            display,
            desktop: Desktop::Other,
        };
        for mut config in [
            json!({}),
            json!({ "windowInsertion": { "method": "wtype" } }),
        ] {
            assert!(normalize_window_insertion_for_session(&mut config, session));
            assert_eq!(config["windowInsertion"]["method"], expected_method);
            assert_eq!(config["windowInsertion"]["pasteShortcut"], "ctrl+v");
            assert!(!normalize_window_insertion_for_session(
                &mut config,
                session
            ));
        }
        let mut custom = json!({ "windowInsertion": { "xdotoolBin": "/opt/bin/xdotool" } });
        normalize_window_insertion_for_session(&mut custom, session);
        assert_eq!(custom["windowInsertion"]["xdotoolBin"], "/opt/bin/xdotool");
        assert_eq!(custom["windowInsertion"]["ydotoolBin"], "/usr/bin/ydotool");
        for method in ["xdotool", "ydotool"] {
            let mut config = json!({ "windowInsertion": { "method": method } });
            normalize_window_insertion_for_session(&mut config, session);
            assert_eq!(config["windowInsertion"]["method"], method);
        }
    }
}

#[test]
fn normalize_window_insertion_is_idempotent() {
    let mut config = json!({});

    assert!(normalize_window_insertion_config(&mut config));
    assert!(!normalize_window_insertion_config(&mut config));
}

#[test]
fn normalize_stt_keeps_one_model_per_known_provider_with_its_settings() {
    let mut config = json!({
        "sttModels": [
            { "id": "assemblyai-stt", "provider": "assemblyai", "providerModelId": "universal-3-pro" },
            {
                "id": "deepgram-stt",
                "provider": "deepgram",
                "providerModelId": "nova-3-general",
                "formatWithLlm": false
            },
            {
                "id": "custom",
                "provider": "sherpa-onnx",
                "baseUrl": "ws://speech.lan:6006",
                "formatWithLlm": true
            }
        ],
        "selectedSttModelId": "assemblyai-stt"
    });

    assert!(normalize_stt_config(&mut config));
    assert_eq!(
        config["sttModels"],
        json!([
            {
                "id": "deepgram-stt",
                "provider": "deepgram",
                "providerModelId": "nova-3-general",
                "description": "Deepgram speech recognition",
                "formatWithLlm": false,
                "language": "auto"
            },
            {
                "id": "sherpa-onnx-stt",
                "provider": "sherpa-onnx",
                "providerModelId": "sherpa-onnx",
                "description": "Self-hosted sherpa-onnx streaming server",
                "formatWithLlm": true,
                "baseUrl": "ws://speech.lan:6006"
            }
        ])
    );
    assert_eq!(config["selectedSttModelId"], json!("deepgram-stt"));
    assert!(!normalize_stt_config(&mut config));
}

#[test]
fn normalize_stt_keeps_the_chosen_provider() {
    let mut config = json!({ "selectedSttModelId": "sherpa-onnx-stt"  });

    assert!(normalize_stt_config(&mut config));
    assert_eq!(config["selectedSttModelId"], json!("sherpa-onnx-stt"));
}

#[test]
fn normalize_stt_fills_a_missing_section() {
    let mut config = json!({});

    assert!(normalize_stt_config(&mut config));
    assert_eq!(config["sttModels"], default_user_config()["sttModels"]);
    assert_eq!(config["selectedSttModelId"], json!("deepgram-stt"));
    assert!(!normalize_stt_config(&mut config));
}

#[test]
fn normalize_hotkeys_adds_defaults_and_keeps_overrides() {
    let mut config = json!({ "hotkeys": { "editor": "Super+Space" } });

    assert!(normalize_hotkeys_config(&mut config));
    assert_eq!(config["hotkeys"]["editor"], json!("Super+Space"));
    assert_eq!(config["hotkeys"]["voice"], json!("Ctrl+Alt+V"));
    assert_eq!(config["submitKey"], json!("enter"));
    assert_eq!(config["quickCorrectionPrefetch"], json!(false));
    assert_eq!(config["quickHideOnBlur"], json!(true));
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_hotkeys_drops_unknown_selection_hotkeys() {
    let mut config = json!({
        "selectionHotkeys": { "correction": "Ctrl+Alt+X", "translate.0": "Ctrl+Alt+1" },
    });

    assert!(normalize_hotkeys_config(&mut config));
    assert_eq!(
        config["selectionHotkeys"],
        json!({ "correction": "Ctrl+Alt+X" })
    );
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_hotkeys_repairs_an_invalid_submit_key() {
    let mut kept = json!({ "submitKey": "ctrlEnter" });
    normalize_hotkeys_config(&mut kept);
    assert_eq!(kept["submitKey"], json!("ctrlEnter"));

    let mut invalid = json!({ "submitKey": "Ctrl+Enter" });
    assert!(normalize_hotkeys_config(&mut invalid));
    assert_eq!(invalid["submitKey"], json!("enter"));
}

#[test]
fn appearance_choices_survive_restart_with_shared_enum_names() {
    let mut config = json!({"theme":"e-ink","motion":"reduce","contrast":"more","uiScale":175});
    assert!(!normalize_appearance_config(&mut config));
    assert_eq!(config["theme"], "e-ink");
    assert_eq!(config["motion"], "reduce");
}

#[test]
fn normalize_appearance_and_language_fills_defaults() {
    let mut config = json!({ "theme": "invalid-theme" });

    assert!(normalize_appearance_config(&mut config));
    assert_eq!(config["theme"], json!("auto"));
    assert_eq!(config["uiScale"], json!(100));
    assert!(!normalize_appearance_config(&mut config));

    assert!(normalize_language_config(&mut config));
    assert_eq!(config["appLanguage"], json!("auto"));
    assert_eq!(
        config["toTranslateLanguages"],
        json!(["en_US", "ru_RU", "es_AR", "tr_TR"])
    );
    assert!(!normalize_language_config(&mut config));
}

#[test]
fn normalize_editor_and_translation_fills_defaults() {
    let mut config = json!({});

    assert!(normalize_editor_config(&mut config));
    assert_eq!(config["editorHistoryStorage"], json!("disk"));
    assert_eq!(config["editorHistoryMaxItems"], json!(1000));
    assert_eq!(config["editorHistoryRetentionDays"], json!(30));
    assert_eq!(config["sanitizeSecretsInEditorHistory"], json!(true));
    assert!(!normalize_editor_config(&mut config));

    assert!(normalize_translation_config(&mut config));
    assert_eq!(config["translation"]["provider"], json!("llm"));
    assert_eq!(config["translation"]["qualityGate"], json!("off"));
    assert_eq!(config["translation"]["correctionPrompt"], json!(""));
    assert!(!normalize_translation_config(&mut config));
}

#[test]
fn normalize_ai_rules_and_tasks_fills_defaults() {
    let mut config = json!({ "aiRules": {} });

    assert!(normalize_ai_rules_and_tasks(&mut config));
    assert_eq!(config["aiRules"]["chat"], json!(""));
    assert!(config["aiTasks"].as_array().is_some());
    assert!(!normalize_ai_rules_and_tasks(&mut config));
}

#[test]
fn normalize_ai_rules_and_tasks_gives_tasks_ids() {
    let mut config = json!({
        "aiTasks": [
            { "name": "a", "rule": "x" },
            null,
            { "id": "task-1", "name": "b", "rule": "y" },
            { "id": " ", "name": "c", "rule": "z" }
        ]
    });

    assert!(normalize_ai_rules_and_tasks(&mut config));
    assert_eq!(config["aiTasks"][0]["id"], json!("task-2"));
    assert_eq!(config["aiTasks"][1], Value::Null);
    assert_eq!(config["aiTasks"][2]["id"], json!("task-1"));
    assert_eq!(config["aiTasks"][3]["id"], json!("task-3"));
    assert!(!normalize_ai_rules_and_tasks(&mut config));
}

#[test]
fn normalize_main_actions_preserves_custom_entries_and_repairs_invalid_sections() {
    let mut config = json!({ "mainActions": "invalid", "commands": null });
    assert!(normalize_main_actions_config(&mut config));
    assert_eq!(
        config["mainActions"],
        crate::models::default_user_config()["mainActions"]
    );
    assert_eq!(config["commands"], json!([]));
    assert!(!normalize_main_actions_config(&mut config));

    let mut custom = json!({ "mainActions": ["custom"], "commands": [{ "id": "custom" }] });
    let original = custom.clone();
    assert!(!normalize_main_actions_config(&mut custom));
    assert_eq!(custom, original);
}

#[test]
fn domain_normalizers_ignore_non_mapping_configs() {
    let normalizers: [fn(&mut Value) -> bool; 9] = [
        normalize_window_insertion_config,
        normalize_hotkeys_config,
        normalize_appearance_config,
        normalize_language_config,
        normalize_editor_config,
        normalize_translation_config,
        normalize_main_actions_config,
        normalize_stt_config,
        normalize_ai_rules_and_tasks,
    ];
    for normalize in normalizers {
        for mut config in [Value::Null, json!([]), json!("invalid")] {
            let original = config.clone();
            assert!(!normalize(&mut config));
            assert_eq!(config, original);
        }
    }
}

#[test]
fn normalization_repairs_invalid_fields_without_overwriting_valid_values() {
    let defaults = default_user_config();
    let mut config = json!({
        "theme": "dark",
        "contrast": null,
        "motion": "unknown",
        "uiScale": 201,
        "appLanguage": "es_AR",
        "userLanguage": false,
        "toTranslateLanguages": [],
        "editorHistoryMaxItems": -1,
        "editorHistoryRetentionDays": 1.5,
        "sanitizeSecretsInEditorHistory": "true",
        "chatHistoryEnabled": false,
        "chatHistoryRetentionDays": 0,
        "translation": {
            "provider": "google",
            "qualityGate": "invalid",
            "deeplEndpoint": 1,
            "glossary": {},
            "correctionPrompt": "custom prompt"
        },
        "customField": "preserved"
    });
    assert!(normalize_appearance_config(&mut config));
    assert!(normalize_language_config(&mut config));
    assert!(normalize_editor_config(&mut config));
    assert!(normalize_translation_config(&mut config));

    for key in [
        "contrast",
        "motion",
        "uiScale",
        "userLanguage",
        "toTranslateLanguages",
        "editorHistoryMaxItems",
        "editorHistoryRetentionDays",
        "sanitizeSecretsInEditorHistory",
    ] {
        assert_eq!(config[key], defaults[key], "{key}");
    }
    for key in ["qualityGate", "deeplEndpoint", "glossary"] {
        assert_eq!(
            config["translation"][key], defaults["translation"][key],
            "{key}"
        );
    }
    assert_eq!(config["theme"], "dark");
    assert_eq!(config["appLanguage"], "es_AR");
    assert_eq!(config["chatHistoryEnabled"], false);
    assert_eq!(config["chatHistoryRetentionDays"], 0);
    assert_eq!(config["translation"]["provider"], "google");
    assert_eq!(config["translation"]["correctionPrompt"], "custom prompt");
    assert_eq!(config["customField"], "preserved");

    assert!(!normalize_appearance_config(&mut config));
    assert!(!normalize_language_config(&mut config));
    assert!(!normalize_editor_config(&mut config));
    assert!(!normalize_translation_config(&mut config));
}
