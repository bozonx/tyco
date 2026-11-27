use serde_json::json;

use super::*;

fn config() -> Value {
    json!({
        "commands": [
            {
                "id": "backup",
                "name": "Бэкап",
                "operationId": "script",
                "operationConfig": { "command": "backup.sh" },
                "isAvailableExternally": true
            },
            {
                "id": "note",
                "name": "Work  Note",
                "operationId": "webhook",
                "operationConfig": { "url": "https://example.com/?q={{TEXT}}" },
                "afterRun": "showMenu",
                "isAvailableExternally": true
            },
            {
                "id": "hidden",
                "name": "Hidden",
                "operationId": "script",
                "operationConfig": { "command": "x" },
                "isAvailableExternally": false
            },
            {
                "id": "off",
                "name": "Off",
                "operationId": "script",
                "operationConfig": { "command": "x" },
                "isEnabled": false,
                "isAvailableExternally": true
            },
            {
                "id": "plugin",
                "name": "Plugin",
                "operationId": "FastNote.write",
                "isAvailableExternally": true
            },
            {
                "id": "missing-tool",
                "name": "Missing",
                "operationId": "Gone.tool",
                "isAvailableExternally": true
            },
            {
                "id": "translate",
                "name": "Translate",
                "operationId": "core.correct",
                "afterRun": "insertIntoWindow",
                "isAvailableExternally": true
            },
            {
                "id": "lights",
                "name": "Lights",
                "operationId": "Home.lights",
                "isAvailableExternally": true
            },
            {
                "id": "remind",
                "name": "Remind",
                "operationId": "Home.remind",
                "isLlmArgumentParsingEnabled": true,
                "isAvailableExternally": true
            },
            {
                "id": "remind-raw",
                "name": "Remind raw",
                "operationId": "Home.remind",
                "isAvailableExternally": true
            },
            {
                "id": "twin-a",
                "name": "Twin",
                "operationId": "script",
                "operationConfig": { "command": "a" },
                "isAvailableExternally": true
            },
            {
                "id": "twin-b",
                "name": "twin",
                "operationId": "script",
                "operationConfig": { "command": "b" },
                "isAvailableExternally": true
            },
            {
                "id": "twin-c",
                "name": "Twin",
                "operationId": "script",
                "operationConfig": { "command": "c" },
                "isAvailableExternally": false
            },
            {
                "id": "Lamp",
                "name": "Свет",
                "operationId": "webhook",
                "operationConfig": { "url": "https://example.com" },
                "isAvailableExternally": true
            },
            {
                "id": "lamp-2",
                "name": "Lamp",
                "operationId": "webhook",
                "operationConfig": { "url": "https://example.com" },
                "isAvailableExternally": true
            }
        ]
    })
}

fn catalog() -> OperationCatalog {
    let entry = |id: &str, input, available, reason: Option<&str>| OperationCatalogEntry {
        id: id.to_owned(),
        input,
        is_available: available,
        reason: reason.map(str::to_owned),
        input_schema: None,
        command_inputs: HashMap::new(),
    };
    catalog_from(vec![
        entry("script", OperationInputKind::Text, true, None),
        entry("FastNote.write", OperationInputKind::Text, true, None),
        entry(
            "core.correct",
            OperationInputKind::Text,
            false,
            Some("No LLM is configured"),
        ),
        entry("Home.lights", OperationInputKind::None, true, None),
        entry("Home.remind", OperationInputKind::Structured, true, None),
    ])
}

fn find_in(id: &str) -> Result<ExternalCommand, CommandLookupError> {
    find_by_id(&config(), Some(&catalog()), id)
}

fn find_named(name: &str) -> Result<ExternalCommand, CommandLookupError> {
    find_by_name(&config(), Some(&catalog()), name)
}

#[test]
fn configured_input_changes_schema_and_call_capabilities() {
    let command = json!({
        "id": "configured", "operationId": "Plugin.dynamic",
        "operationConfig": {"mode": "structured"}, "isAvailableExternally": true
    });
    let mut tool = OperationCatalogEntry {
        id: "Plugin.dynamic".into(),
        input: OperationInputKind::Text,
        is_available: true,
        reason: None,
        input_schema: None,
        command_inputs: HashMap::new(),
    };
    tool.command_inputs.insert("configured".into(), CommandInputDescription {
        operation_config: command["operationConfig"].clone(), input: OperationInputKind::Structured,
        input_schema: json!({"type":"object", "properties":{"at":{"type":"string"}}, "required":["at"]}),
    });
    assert_eq!(
        command_input(&command, &tool)
            .unwrap()
            .unwrap()
            .input_schema["required"],
        json!(["at"])
    );
    let config = json!({"commands":[command.clone()]});
    let catalog = catalog_from(vec![tool]);
    let found = find_by_id(&config, Some(&catalog), "configured").unwrap();
    assert!(found.has_structured_input);
    assert!(!found.can_take_text);
    let description = describe(&config, Some(&catalog), "configured", false).unwrap();
    assert_eq!(description["inputSchema"]["required"], json!(["at"]));
    assert_eq!(description["textAccepted"], false);
    let listed = list(&config, Some(&catalog));
    assert_eq!(listed[0]["input"], "structured");
    assert_eq!(listed[0]["canReplaceSelection"], false);
    let mut changed = config;
    changed["commands"][0]["operationConfig"]["mode"] = json!("text");
    assert_eq!(
        find_by_id(&changed, Some(&catalog), "configured"),
        Err(CommandLookupError::CatalogStale("configured".into()))
    );
}

#[test]
fn ids_and_names_do_not_stand_for_each_other() {
    assert_eq!(find_named("Lamp").unwrap().id, "lamp-2");
    assert_eq!(find_in("Lamp").unwrap().id, "Lamp");
    assert_eq!(
        find_in("Бэкап"),
        Err(CommandLookupError::NotFound(String::from("Бэкап")))
    );
}

#[test]
fn normalizes_names() {
    assert_eq!(normalize_name("  Ёлка   ЗАПИСЬ "), "елка запись");
    assert_eq!(normalize_name("\tWork\nNote"), "work note");
}

#[test]
fn finds_a_command_by_its_trimmed_id() {
    let found = find_in(" backup ").unwrap();
    assert_eq!(
        found,
        ExternalCommand {
            id: String::from("backup"),
            can_take_text: false,
            has_structured_input: false,
            can_take_selection: false,
        }
    );
}

#[test]
fn finds_a_command_by_its_normalized_name() {
    assert_eq!(find_named("бэкап").unwrap().id, "backup");
    let note = find_named("work note").unwrap();
    assert_eq!(note.id, "note");
    assert!(note.can_take_text);
}

#[test]
fn reports_why_a_command_cannot_be_called() {
    assert_eq!(
        find_in("nothing"),
        Err(CommandLookupError::NotFound(String::from("nothing")))
    );
    assert_eq!(
        find_in(""),
        Err(CommandLookupError::NotFound(String::new()))
    );
    assert_eq!(
        find_in("hidden"),
        Err(CommandLookupError::NotExternal(String::from("hidden")))
    );
    assert_eq!(
        find_named("Off"),
        Err(CommandLookupError::Disabled(String::from("off")))
    );
    assert_eq!(
        find_in("missing-tool"),
        Err(CommandLookupError::Unavailable(
            String::from("missing-tool"),
            None
        ))
    );
    assert_eq!(
        find_in("translate"),
        Err(CommandLookupError::Unavailable(
            String::from("translate"),
            Some(String::from("No LLM is configured"))
        ))
    );
    assert!(find_in("remind-raw").unwrap().has_structured_input);
}

#[test]
fn learns_plugin_tools_from_the_catalog() {
    assert_eq!(
        find_by_id(&config(), None, "plugin"),
        Err(CommandLookupError::ToolsLoading(String::from("plugin")))
    );
    // the backend knows its own tools without the catalog
    assert_eq!(find_by_id(&config(), None, "backup").unwrap().id, "backup");
    let note = find_in("plugin").unwrap();
    assert!(note.can_take_text);
    assert!(!find_in("lights").unwrap().can_take_text);
    // the LLM fills the structured input from the text
    assert!(find_in("remind").unwrap().can_take_text);
}

#[test]
fn a_script_takes_the_text_it_mentions() {
    assert!(script_can_take_text(&json!({ "command": "echo {{TEXT}}" })));
    assert!(!script_can_take_text(
        &json!({ "command": "printf %s \"$TYCO_TEXT\"" })
    ));
    assert!(!script_can_take_text(&json!({ "command": "backup.sh" })));
    assert!(!script_can_take_text(&json!({})));
}

#[test]
fn a_webhook_takes_the_text_where_its_placeholder_stands() {
    assert!(webhook_can_take_text(
        &json!({ "url": "https://x.test/?q={{TEXT}}", "method": "GET" })
    ));
    assert!(webhook_can_take_text(&json!({
        "url": "https://x.test",
        "payloadTemplate": "{\"text\": \"{{TEXT}}\"}"
    })));
    // a GET request sends no body
    assert!(!webhook_can_take_text(&json!({
        "url": "https://x.test",
        "method": "GET",
        "payloadTemplate": "{{TEXT}}"
    })));
    assert!(!webhook_can_take_text(&json!({ "url": "https://x.test" })));
}

#[test]
fn accepts_commands_independently_of_launcher_output_settings() {
    let mut catalog = catalog();
    catalog.get_mut("core.correct").unwrap().is_available = true;
    let found = find_by_id(&config(), Some(&catalog), "translate").unwrap();
    assert!(found.can_take_text);
}

#[test]
fn refuses_a_name_shared_by_callable_commands() {
    // twin-c may not be called from outside, so it does not count
    assert_eq!(
        find_named("TWIN"),
        Err(CommandLookupError::Ambiguous(
            String::from("TWIN"),
            vec![String::from("twin-a"), String::from("twin-b")]
        ))
    );
}

#[test]
fn lists_the_callable_commands() {
    let listed = list(&config(), Some(&catalog()));
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["canReplaceSelection"].is_boolean()
            && item["output"] == "return"
            && item.get("afterRun").is_none()));
    let essential: Vec<Value> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|item| json!({"id":item["id"],"name":item["name"],"input":item["input"]}))
        .collect();
    assert_eq!(
        json!(essential),
        json!([
            { "id": "backup", "name": "Бэкап", "input": "none" },
            { "id": "note", "name": "Work  Note", "input": "text" },
            { "id": "plugin", "name": "Plugin", "input": "text" },
            { "id": "lights", "name": "Lights", "input": "none" },
            { "id": "remind", "name": "Remind", "input": "structured" },
            { "id": "remind-raw", "name": "Remind raw", "input": "structured" },
            { "id": "twin-a", "name": "Twin", "input": "none" },
            { "id": "twin-b", "name": "twin", "input": "none" },
            { "id": "Lamp", "name": "Свет", "input": "none" },
            { "id": "lamp-2", "name": "Lamp", "input": "none" }
        ])
    );
    assert_eq!(list(&json!({}), None), json!([]));
}

#[test]
fn names_normalize_as_the_webview_does() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../../packages/shared/fixtures/command-names.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let [name, expected] = [&case[0], &case[1]].map(|value| value.as_str().unwrap());
        assert_eq!(normalize_name(name), expected, "{name:?}");
    }
}

#[test]
fn a_name_waits_while_a_command_of_that_name_is_loading() {
    let config = json!({"commands": [
        {"id": "a", "name": "Same", "operationId": "script",
         "operationConfig": {"command": "x"}, "isAvailableExternally": true},
        {"id": "b", "name": "Same", "operationId": "Plugin.late", "isAvailableExternally": true},
    ]});
    // the catalog has not come yet: `b` may be callable too
    assert_eq!(
        find_by_name(&config, None, "same"),
        Err(CommandLookupError::ToolsLoading("b".into()))
    );
}

#[test]
fn a_name_that_cannot_be_called_tells_the_most_telling_reason() {
    let config = json!({"commands": [
        {"id": "off", "name": "Same", "operationId": "script",
         "operationConfig": {"command": "x"}, "isEnabled": false, "isAvailableExternally": true},
        {"id": "inside", "name": "Same", "operationId": "script",
         "operationConfig": {"command": "x"}},
    ]});
    assert_eq!(
        find_by_name(&config, None, "same"),
        Err(CommandLookupError::NotExternal("inside".into()))
    );
}

#[test]
fn describe_names_a_command_without_a_name_by_its_id() {
    let config = json!({"commands": [
        {"id": "nameless", "name": "  ", "operationId": "script",
         "operationConfig": {"command": "x"}, "isAvailableExternally": true},
    ]});
    let description = describe(&config, None, "nameless", false).unwrap();
    assert_eq!(description["name"], "nameless");
    assert_eq!(list(&config, None)[0]["name"], "nameless");
}

#[test]
fn a_command_of_another_platform_is_not_called_and_stays_in_the_config() {
    let other = if cfg!(target_os = "windows") {
        "linux"
    } else {
        "windows"
    };
    let config = json!({"commands": [{
        "id": "elsewhere", "name": "Elsewhere", "operationId": "script",
        "operationConfig": {"command": "x"}, "isAvailableExternally": true,
        "platforms": [other]
    }]});
    assert!(matches!(
        find_by_id(&config, None, "elsewhere"),
        Err(CommandLookupError::Unavailable(_, Some(_)))
    ));
    let mut normalized = config.clone();
    normalized["actionPages"] = json!([{
        "inputMode": "selection",
        "slots": {"q": {"type": "command", "commandId": "elsewhere"}}
    }]);
    crate::services::settings::schema::normalize_user_config(&mut normalized);
    assert_eq!(normalized["commands"][0]["id"], "elsewhere");
    assert_eq!(
        normalized["actionPages"][0]["slots"]["q"]["commandId"],
        "elsewhere"
    );
}

#[test]
fn a_script_of_the_selection_alone_accepts_selection() {
    let config = serde_json::json!({"commands": [
        {"id": "sel", "name": "Sel", "operationId": "script", "isAvailableExternally": true,
         "operationConfig": {"command": "echo {{SELECTION}}"}},
        {"id": "hook", "name": "Hook", "operationId": "webhook", "isAvailableExternally": true,
         "operationConfig": {"url": "https://x.test", "method": "GET", "payloadTemplate": "{{SELECTION}}"}},
    ]});
    let sel = find_by_id(&config, None, "sel").unwrap();
    assert!(!sel.can_take_text);
    assert!(sel.accepts_selection());
    // a GET request sends no body, so its template does not count
    assert!(!find_by_id(&config, None, "hook")
        .unwrap()
        .accepts_selection());
    let listed = list(&config, None);
    assert_eq!(listed[0]["canReplaceSelection"], true);
}

#[test]
fn a_bad_platform_entry_does_not_widen_the_command() {
    let other = if cfg!(target_os = "windows") {
        "linux"
    } else {
        "windows"
    };
    let config = serde_json::json!({"commands": [
        {"id": "a", "name": "A", "operationId": "script", "isAvailableExternally": true,
         "operationConfig": {"command": "true"}, "platforms": [other, 5]},
    ]});
    assert!(matches!(
        find_by_id(&config, None, "a"),
        Err(CommandLookupError::Unavailable(..))
    ));
}

#[test]
fn legacy_translate_commands_are_not_callable() {
    let config = serde_json::json!({"commands": [
        {"id": "translate", "name": "T", "operationId": "core.translate", "isAvailableExternally": true},
    ]});
    assert!(matches!(
        find_by_id(&config, None, "translate"),
        Err(CommandLookupError::NotFound(_))
    ));
}

#[test]
fn quiet_runs_refuse_confirmation_in_reachable_command_whitelists() {
    let mut config = json!({
        "commands": [
            {"id": "parent", "operationId": "core.aiTask", "operationConfig": {"tools": [
                {"sourceKind": "commands", "sourceId": "commands", "toolName": "child"}
            ]}},
            {"id": "child", "operationId": "core.aiTask", "operationConfig": {"tools": [
                {"sourceKind": "commands", "sourceId": "commands", "toolName": "parent"},
                {"sourceKind": "plugin", "sourceId": "fixture", "toolName": "run", "policy": "ask"}
            ]}}
        ]
    });
    assert!(!can_run_quietly(&config, "parent"));
    config["commands"][1]["operationConfig"]["tools"][1]["policy"] = json!("allow");
    assert!(can_run_quietly(&config, "parent"));
}
