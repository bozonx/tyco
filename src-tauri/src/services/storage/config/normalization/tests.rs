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
    let mut config = json!({"stt":{"models":[
            {"id":"assemblyai-stt","provider":"assemblyai","providerModelId":"universal-3-pro" },
            {"id":"deepgram-stt","provider":"deepgram","providerModelId":"nova-3-general","formatWithLlm":false
            },
            {"id":"custom","provider":"sherpa-onnx","baseUrl":"ws://speech.lan:6006","formatWithLlm":true
            }
        ],"selectedModelId":"assemblyai-stt"
    }});

    assert!(normalize_stt_config(&mut config));
    assert_eq!(
        config["stt"]["models"],
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
    assert_eq!(config["stt"]["selectedModelId"], json!("deepgram-stt"));
    assert!(!normalize_stt_config(&mut config));
}

#[test]
fn normalize_stt_keeps_the_chosen_provider() {
    let mut config = json!({"stt":{"selectedModelId":"sherpa-onnx-stt"  }});

    assert!(normalize_stt_config(&mut config));
    assert_eq!(config["stt"]["selectedModelId"], json!("sherpa-onnx-stt"));
}

#[test]
fn normalize_stt_fills_a_missing_section() {
    let mut config = json!({});

    assert!(normalize_stt_config(&mut config));
    assert_eq!(
        config["stt"]["models"],
        default_user_config()["stt"]["models"]
    );
    assert_eq!(config["stt"]["selectedModelId"], json!("deepgram-stt"));
    assert!(!normalize_stt_config(&mut config));
}

#[test]
fn normalize_hotkeys_adds_defaults_and_keeps_overrides() {
    let mut config = json!({ "hotkeys": { "editor": "Super+Space" } });

    assert!(normalize_hotkeys_config(&mut config));
    assert_eq!(config["hotkeys"]["editor"], json!("Super+Space"));
    assert_eq!(config["hotkeys"]["voice"], json!("Ctrl+Alt+V"));
    assert_eq!(
        config["selectionHotkeys"],
        default_user_config()["selectionHotkeys"]
    );
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_hotkeys_drops_unknown_modes() {
    let mut config = json!({
        "hotkeys": { "history": "Ctrl+H", "config": "Ctrl+,", "correction": "Ctrl+Alt+C" },
    });

    assert!(normalize_hotkeys_config(&mut config));
    assert!(config["hotkeys"].get("history").is_none());
    assert!(config["hotkeys"].get("config").is_none());
    assert_eq!(config["hotkeys"]["correction"], json!("Ctrl+Alt+C"));
    assert!(!normalize_hotkeys_config(&mut config));
}

#[test]
fn normalize_language_restores_the_translation_slots() {
    let mut config = json!({"translation":{"targetLanguages": []}});

    assert!(normalize_language_config(&mut config));
    assert_eq!(config["translation"]["targetLanguages"], json!(["en_US"]));
    assert!(!normalize_language_config(&mut config));

    let mut preserves = json!({"translation":{"targetLanguages": ["en_US", "es_AR"]}});
    assert!(!normalize_language_config(&mut preserves));
    assert_eq!(
        preserves["translation"]["targetLanguages"],
        json!(["en_US", "es_AR"])
    );
}

#[test]
fn domain_normalizers_ignore_non_mapping_configs() {
    let normalizers: [fn(&mut Value) -> bool; 4] = [
        normalize_window_insertion_config,
        normalize_hotkeys_config,
        normalize_language_config,
        normalize_stt_config,
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
fn loaded_config_fills_missing_sections_from_defaults() {
    let defaults = default_user_config();
    let mut config = json!({});

    assert!(super::super::normalize_loaded_config(&mut config));
    for key in [
        "appearance",
        "appLanguage",
        "submitKey",
        "quickCorrectionPrefetch",
        "quickHideOnBlur",
        "editorHistory",
        "translation",
        "mainActions",
        "commands",
        "aiRules",
        "aiTasks",
        "plugins",
    ] {
        assert_eq!(config[key], defaults[key], "{key}");
    }
    assert!(!super::super::normalize_loaded_config(&mut config));
}

#[test]
fn loaded_config_repairs_invalid_fields_without_overwriting_valid_values() {
    let defaults = default_user_config();
    let mut config = json!({"appLanguage":"es_AR","userLanguage":false,"submitKey":"Ctrl+Enter","selectionHotkeys":{ "correction": "Ctrl+Alt+X", "translate.0": "Ctrl+Alt+1" },"translation":{"provider":"google","qualityGate":"invalid","deeplEndpoint":1,"glossary":{},"correctionPrompt":"custom prompt","targetLanguages":[]},"mainActions":"invalid","chatRoles":["legacy"]
    ,"appearance":{"theme":"e-ink","contrast":null,"motion":"unknown","uiScale":201},"editorHistory":{"maxItems":-1,"retentionDays":1.5,"sanitizeSecrets":"true"},"chat":{"isHistoryEnabled":false,"historyRetentionDays":0}});
    assert!(super::super::normalize_loaded_config(&mut config));

    for path in [
        "/appearance/contrast",
        "/appearance/motion",
        "/appearance/uiScale",
        "/userLanguage",
        "/translation/targetLanguages",
        "/submitKey",
        "/editorHistory/maxItems",
        "/editorHistory/retentionDays",
        "/editorHistory/sanitizeSecrets",
        "/mainActions",
    ] {
        assert_eq!(config.pointer(path), defaults.pointer(path), "{path}");
    }
    for key in ["qualityGate", "deeplEndpoint", "glossary"] {
        assert_eq!(
            config["translation"][key], defaults["translation"][key],
            "{key}"
        );
    }
    assert_eq!(config["appearance"]["theme"], "e-ink");
    assert_eq!(config["appLanguage"], "es_AR");
    assert_eq!(config["chat"]["isHistoryEnabled"], false);
    assert_eq!(config["chat"]["historyRetentionDays"], 0);
    assert_eq!(
        config["selectionHotkeys"],
        json!({ "correction": "Ctrl+Alt+X" })
    );
    assert_eq!(config["translation"]["provider"], "google");
    assert_eq!(config["translation"]["correctionPrompt"], "custom prompt");
    assert!(config.get("chatRoles").is_none());

    assert!(!super::super::normalize_loaded_config(&mut config));
}
