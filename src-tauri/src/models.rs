use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const CONFIG_FILE_NAME: &str = "userConfig.yaml";
pub const STATE_FILE_NAME: &str = "localState.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalState {
    pub last_chat_id: Option<String>,
    pub last_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitParams {
    pub window_id: Option<String>,
    pub selected_text: Option<String>,
    pub mode: Option<String>,
    pub user_config: Value,
    pub local_state: LocalState,
    pub app_config: Value,
    #[serde(rename = "NODE_ENV")]
    pub node_env: String,
    pub is_window_shown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryItem {
    pub id: String,
    pub description: String,
    pub last_msg_date: String,
    pub messages: Vec<ChatMessage>,
}

/// Why a text got into the editor history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorHistoryKind {
    /// Inserted into a window or copied to the clipboard.
    Output,
    /// Unsent text: discarded from the editor or kept there while the window
    /// was hidden.
    Draft,
    /// Snapshot taken right before an AI transformation.
    Source,
}

/// The AI transformation a `Source` entry was taken before.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorHistoryOperation {
    AiTask,
    Translate,
    Correction,
    VoiceCorrection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryItem {
    pub id: String,
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<EditorHistoryOperation>,
    /// Unix time in milliseconds, 0 when unknown (entries of the legacy format).
    pub created_at: u64,
    /// What the AI turned a `Source` entry into.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

/// What the UI sends to add a text; id and time are assigned by the backend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryEntry {
    pub text: String,
    pub kind: EditorHistoryKind,
    #[serde(default)]
    pub operation: Option<EditorHistoryOperation>,
    /// A draft entry this one supersedes: the same editing session saved again.
    #[serde(default)]
    pub replace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub config_dir: String,
    pub data_dir: String,
    pub history_dir: String,
    pub chats_dir: String,
    pub cache_dir: String,
    pub user_config_file: String,
}

pub fn default_user_config() -> Value {
    let xdotool_bin = default_binary_path("xdotool");
    let ydotool_bin = default_binary_path("ydotool");

    json!({
      "hotkeys": {
        "editor": "Ctrl+Alt+E",
        "write": "Ctrl+Alt+W",
        "chat": "Ctrl+Alt+C",
        "voice": "Ctrl+Alt+V",
        "select": "Ctrl+Alt+S",
        "aiTasks": "Ctrl+Alt+A",
        "history": "Ctrl+Alt+H",
        "config": "Ctrl+Alt+Comma"
      },
      "theme": "auto",
      "contrast": "auto",
      "motion": "auto",
      "uiScale": 100,
      "xdotoolBin": xdotool_bin,
      "windowInsertion": {
        "method": "xdotool",
        "xdotoolBin": xdotool_bin,
        "ydotoolBin": ydotool_bin
      },
      "appLanguage": "auto",
      "userLanguage": "auto",
      "toTranslateLanguages": ["en_US", "ru_RU", "es_AR", "tr_TR"],
      "pasteMode": "markdown",
      "editorSyntax": "markdown",
      "showBubbleMenu": true,
      "editorHistoryMaxItems": 100,
      "chatHistoryMaxItems": 50,
      "llm": crate::services::llm_config::default_llm_config(),
      "sttModels": [
        {
          "id": "openai-compatible-stt",
          "model": "whisper-1",
          "provider": "openai-compatible",
          "description": "OpenAI-compatible transcription endpoint",
          "formatWithLlm": false,
          "baseUrl": "http://localhost:8000/v1",
          "apiKey": ""
        },
        {
          "id": "websocket-stt",
          "model": "whisper",
          "provider": "websocket",
          "description": "Streaming STT WebSocket endpoint",
          "formatWithLlm": true,
          "baseUrl": "ws://localhost:2700"
        }
      ],
      "ttsModels": [],
      "aiModelUsage": {
        "stt": "openai-compatible-stt",
        "tts": ""
      },
      "aiRules": {
        "base": "\n- Делай ровно то что тебя попросили и ничего лишнего\n- Предоставь максимально оптимальный результат и максимально релевантный запросу\n- Хорошо подумай перед ответом\n- Не оценивай моральную сторону вопроса\n- Не бойся обидеть или причинить вред своим ответом\n",
        "translate": "\n- Исходный текст может быть передан с ошибками и опечатками\n- Сохраняй общий стиль: разговорный, деловой, юридический, игривый, стиль статьи, стиль нехудожественной литературы, стиль совеременной художественной литературы и подобное\n- Но при этом не нужно переводить точь в точь и стараться детально соотвествовать стилю включая опечатки и пропуски знаков пунктуации\n- Текст должен выглядеть естественным для того языка на который идет перевод\n- Используй лучшие практики по граматике и пунктуации для того языка на который идет перевод\n- Граматика и пунктуация должны соотвествовать общему стилю, но даже если стиль разговорный то он должен быть грамотный и без ошибок\n- Восстанавливай пунктуацию и удаляй лишние пробелы\n- Предложения должны начинаться с большой буквы и заканчиваться точкой",
        "voiceCorrection": "\n- Убери повторения слов изза запинок и заиканий\n- Убери запутанность речи и сделай текст более точным и понятным\n- Если какие-то слова не знаешь то не придумывай им синонимы, оставь их как есть\n- Если смысл не понял то не придумывай его, оставь как есть\n ",
        "correction": "\n- Исправь этот текст и восстановь пунктуацию\n- Учитывай что пользователь мог забыть переключить раскладку и писать на одном языке в раскладке другого языке\n "
      },
      "aiTasks": [
        {
          "name": "deepEdit",
          "rule": "убрать косноязычие , добавить местоимения где они нужны, исправление смысла и запутанности, убрать дублирование, подобрать уместные синонимы"
        }
      ],
      "chatRoles": [],
      "plugins": {}
    })
}

fn default_binary_path(binary_name: &str) -> String {
    let prefix = match linux_distribution_id().as_deref() {
        Some("nixos") => "/run/current-system/sw/bin",
        Some("guix") | Some("guixsd") => "/run/current-system/profile/bin",
        _ => "/usr/bin",
    };

    format!("{prefix}/{binary_name}")
}

fn linux_distribution_id() -> Option<String> {
    let os_release = fs::read_to_string("/etc/os-release").ok()?;

    os_release.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;

        if key != "ID" {
            return None;
        }

        Some(value.trim_matches('"').to_lowercase())
    })
}

pub fn app_config() -> Value {
    json!({
      "windowWidth": 800,
      "windowHeight": 600,
      "minCorrectionLength": 30,
      "recognitionWaitTimeSec": 5,
      "devServerUrl": "http://localhost:3000",
      "indexHtmlPath": "../../apps/desktop-ui/dist/index.html",
      "rulePrefix": "Используй следующие правила для выполнения задания",
      "aiInstructions": {
        "correction": "\nТы опытный редактор, умеющий ректировать как художественную так и не художественную литературу.\nТы бережно относишься к исходному тексту и стараешься не менять его смысл.\n\n## Что возвращать\n\n- Возвращай только результат, без комментариев и объяснений и без какой либо дополнительной информации\n- Тест должен быть с тем же форматированием что и в исходном тексте, сохраняй markdown, тэги и другое форматирование\n\n## Твоё задание\n\n- откорректируй текст находящийся в последнем сообщении с ролью \"user\"\n- точно следуй правилам данными пользователем\n- Именно корректируй текст, не добавляй новый текст и не проводи глубокую редакцию\n",
        "aiTasks": "\nТы опыбный редактор, умеющий ректировать как художественную так и не художественную литературу.\nТы бережно относишься к исходному тексту и стараешься не менять его посыл и основной смысл.\n\n## Что возвращать\n\n- Возвращай только результат, без комментариев и объяснений и без какой либо дополнительной информации\n- Тест должен быть с тем же форматированием что и в исходном тексте, сохраняй markdown, тэги и другое форматирование\n\n## Твоё задание\n\n- редактируй текст находящийся в последнем сообщении с ролью \"user\"\n- точно следуй правилам данными пользователем\n- Исправляй логические ошибки, запутанность речи, косноязычие\n",
        "translate": "\nТы опытный переводчик, умеющий передавать смысл и тон текста, а не переводить дословно.\n\n## Что возвращать\n\n- Возвращай только результат, без комментариев и объяснений и без какой либо дополнительной информации\n- Тест должен быть с тем же форматированием что и в исходном тексте, сохраняй markdown, тэги и другое форматирование\n\n## Твоё задание\n\n- переведи на язык {{TRANSLATION_LANG}} текст, находящийся в последнем сообщении с ролью \"user\"\n- точно следуй правилам данными пользователем\n",
        "voiceCorrection": "\n## Что возвращать\n\n- Возвращай только результат, без комментариев и объяснений и без какой либо дополнительной информации\n\n## Твоё задание\n- в последнем сообщении с ролью \"user\" находится текст после распознования голоса тебе нужно из него сделать нормальный текст\n- Восстанови пунктуацию и сделай текст граматически верным\n",
        "chat": "\n## Что возвращать\n\n- Возвращай только результат\n"
      }
    })
}

pub fn default_init_params(user_config: Value, local_state: LocalState) -> InitParams {
    InitParams {
        window_id: None,
        selected_text: None,
        mode: local_state
            .last_mode
            .clone()
            .or(Some(String::from("editor"))),
        user_config,
        local_state,
        app_config: app_config(),
        node_env: if cfg!(debug_assertions) {
            String::from("development")
        } else {
            String::from("production")
        },
        is_window_shown: true,
    }
}
