use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const CONFIG_FILE_NAME: &str = "userConfig.yaml";
pub const STATE_FILE_NAME: &str = "localState.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalState {
    pub last_chat_id: Option<String>,
    pub last_mode: Option<String>,
}

impl Default for LocalState {
    fn default() -> Self {
        Self {
            last_chat_id: None,
            last_mode: None,
        }
    }
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryItem {
    pub id: String,
    pub description: String,
    pub last_msg_date: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub config_dir: String,
    pub data_dir: String,
    pub history_dir: String,
    pub chats_dir: String,
    pub models_dir: String,
    pub cache_dir: String,
    pub user_config_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelFileMetadata {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelMetadata {
    pub model_name: String,
    pub version: String,
    pub downloaded_at: String,
    pub complete: bool,
    pub files: Vec<WhisperModelFileMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelFileMetadata {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelMetadata {
    pub model_name: String,
    pub version: String,
    pub downloaded_at: String,
    pub complete: bool,
    pub files: Vec<LlmModelFileMetadata>,
}

pub fn default_user_config() -> Value {
    let xdotool_bin = default_binary_path("xdotool");
    let ydotool_bin = default_binary_path("ydotool");

    json!({
      "theme": "auto",
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
      "editorHistoryMaxItems": 50,
      "transformHistoryMaxItems": 50,
      "chatHistoryMaxItems": 50,
      "llmModels": [
        {
          "id": "browser-llm-local-default",
          "name": "Local browser model",
          "model": "browser-local",
          "provider": "browser-local",
          "description": "Browser local LLM via Transformers.js",
          "localModel": "HuggingFaceTB/SmolLM2-360M-Instruct",
          "temperature": 0.2,
          "maxTokens": 256
        }
      ],
      "sttModels": [
        {
          "id": "browser-whisper-local",
          "model": "whisper-local",
          "provider": "whisper-local",
          "description": "Browser Whisper via Transformers.js",
          "formatWithLlm": false,
          "restorePunctuation": true,
          "localModel": "Xenova/whisper-tiny"
        },
        {
          "id": "system-vosk",
          "model": "vosk",
          "provider": "vosk",
          "description": "Системный Vosk WebSocket сервер",
          "formatWithLlm": true,
          "baseUrl": "ws://localhost:2700"
        }
      ],
      "ttsModels": [],
      "aiModelUsage": {
        "stt": "system-vosk",
        "tts": "",
        "translate": "browser-llm-local-default",
        "voiceCorrection": "browser-llm-local-default",
        "correction": "browser-llm-local-default",
        "aiTasks": "browser-llm-local-default",
        "chat": "browser-llm-local-default"
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
        mode: local_state.last_mode.clone().or(Some(String::from("editor"))),
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
