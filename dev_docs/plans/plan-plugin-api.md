# План: развитие API плагинов

Статус: план, к реализации не приступали.
Обновлено: 2026-11-21.
Связанные заметки: `plugin-packages.md` (рантайм и формат пакета),
`docs/plugins.md` (руководство автора), `architecture.md` (операции, команды,
инструменты), `config-storage.md`, `plan-spellcheck.md`.

## 1. Цель

Сейчас плагин умеет преобразовывать текст редактора, добавлять кнопки и пункты
меню, регистрировать операции для команд и дописывать заметки в выбранную
папку. Пять встроенных плагинов — по сути текстовые преобразователи, и API
ровно под них. Сложный плагин (интеграция с внешним сервисом, проверка
орфографии, ИИ-помощник, менеджер сниппетов) сегодня написать нельзя: у него
нет сети, LLM, хранилища, событий, точек расширения редактора и
пользовательского UI.

Цель плана — сделать плагины полноценным способом расширять TyCo, не
ослабляя изоляцию и офлайн-режим, и навести порядок в уже существующем API.

## 2. Принципы

- **Ядро — платформа, плагины — предметные функции.** Ядро владеет вводом и
  выводом, LLM, STT, командами, горячими клавишами, историей, чатом, секретами
  и безопасностью. Плагины — интеграциями, преобразованиями, проверками,
  шаблонами и провайдерами.
- **Одна возможность за раз, и только с реальным потребителем.** Каждая новая
  возможность выходит вместе с плагином, который её использует (встроенным или
  перенесённым из ядра). API без потребителя не добавляем.
- **Права выдаёт пользователь, и они видны.** Каждая возможность — это
  `PluginCapability` в манифесте, видимая при установке. Если обновление
  расширяет права (новая возможность, новый origin), нужно повторное согласие.
  Где возможно, право выдаёт _сохранённая настройка_, а не код плагина: так уже
  сделана папка заметок (`notesDirectoryField`), так же делаем выбор команд,
  модели LLM и т. п.
- **Хост рисует, плагин отдаёт данные.** Никакого DOM, CSS и кода плагина в
  окне. UI декларативный, как поля настроек сегодня.
- **Безопасность проверяет Rust.** Всё, что выходит за пределы webview (сеть,
  файлы, секреты), проверяется в Rust по идентичности плагина, которую
  назначает хост, а не по аргументам вызова — как `write_plugin_note`.
- **Офлайн и CSP не трогаем.** Сеть — только через `services/net`, ключи —
  только в `services/secrets`, плагин видит лишь `tyco-secret:<id>`.
- **Одинаково для встроенных и внешних плагинов.** Встроенные плагины работают
  в контексте хоста, но получают тот же API с теми же проверками возможностей.
  Каждый встроенный плагин проверяет собой API.

## 3. Текущие проблемы API

Выявлены при разборе `packages/plugin-sdk/src/plugin.ts`,
`operations.ts` и `apps/desktop-ui/src/lib/plugins/`:

1. **Плоский контекст.** В `PluginContext` около 25 методов в одном
   пространстве имён; связь метода с возможностью видна только в коде хоста.
2. **`callApiFunction` со строковым именем и позиционным кортежем.**
   `callApiFunction('saveNote', [dir, fileName, text])`: аргумент `dir` плагин
   передаёт, хотя права определяет настройка; результат —
   `{ success, result?, error?, errorCode? }` без типизации кодов.
3. **Три метода на одно и то же.** `registerEditItems`, `registerCaseItems`,
   `registerFormatItems` различаются только местом в меню.
   `registerActionsItems` — неудачное имя.
4. **Небезопасные и устаревшие методы.** `setEditorInputValue` и
   `replaceEditorInputSelection` меняют редактор без проверки ревизии и ничего
   не возвращают через RPC; `getEditorInputValue` и
   `getEditorInputSelectedText` дублируют снимок. Поля `name`,
   `useFullEditorText`, `preserveWhitespace` остались для совместимости.
5. **Операции плагинов беднее операций ядра.** У хостового
   `OperationDefinition` (`lib/operations/operation-types.ts`) есть
   `inputSchemaFor(config)`, `getUnavailableReasonKey`, `canLogOutput`,
   `voicePhrasesKey`, `voiceOutputAction`, а у параметров — `voiceValuesKey`,
   `voiceVariants`, `preferVoiceValue`, `voiceErrorKey`, `valueLabelKey`. В
   SDK их нет, поэтому плагин не может сделать голосовую команду уровня
   `core.translate`.
6. **Скрытый доступ к LLM.** `OperationParseContext.llm.extract` передаётся в
   `parseText` любого плагина без какой-либо возможности.
7. **Нетипизированные настройки.** `getMyConfig<T>()` возвращает
   `Partial<T>`, тип не выводится из `defaultConfig.fields`, и плагин
   проверяет каждое поле руками.
8. **Ошибки без параметров.** `PluginError(messageKey)` не принимает
   `params`, хотя сообщения поддерживают плейсхолдеры.
9. **Дубли пар «ключ / текст».** `toast`/`toastText`, `label`/`labelKey`,
   `tooltip`/`tooltipKey`.
10. **Вывод только через результат операции.** Скопировать текст, вставить его
    в окно или открыть редактор из фоновой работы (таймер, подписка) нельзя.

## 4. Этапы

Порядок выбран по ценности и зависимостям. Этапы 1 и 2 — фундамент. Этапы 3–6
можно переставлять, если появится более срочный потребитель.

| #   | Этап                               | Новые возможности                 | Первый потребитель          |
| --- | ---------------------------------- | --------------------------------- | --------------------------- |
| 1   | API v3: пространства имён и чистка | —                                 | все встроенные плагины      |
| 2   | Паритет операций с ядром           | —                                 | SearchInInternet, FastNote  |
| 3   | Сеть и секреты                     | `network`                         | плагин-интеграция (см. 4.3) |
| 4   | LLM                                | `llm`                             | см. 4.4                     |
| 5   | Хранилище                          | `storage`                         | проверка орфографии         |
| 6   | Расширения редактора               | — (под `editor`)                  | проверка орфографии         |
| 7   | Диалоги и панели                   | `panel` для панелей               | интеграция из этапа 3       |
| 8   | События и диктовка                 | `stt`                             | см. 4.8                     |
| 9   | Вывод, буфер, команды              | `clipboard`, `output`, `commands` | см. 4.9                     |
| 10  | Провайдеры                         | — (поверх `network`)              | провайдер перевода          |

### 4.1. API v3: пространства имён и чистка

Вводим `PLUGIN_API_VERSION = 3`. Хост и нативная проверка пакета принимают
версии 2 и 3. Контекст v2 становится тонкой обёрткой над v3 в хосте
(`lib/plugins/`) и удаляется, когда внешние пакеты перейдут на v3 (отдельное
решение, не раньше чем через один выпуск). Встроенные плагины переходим сразу.

Контекст v3 группируется по возможностям:

```ts
interface PluginContext {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void | Promise<void>): void
  readonly config: { get(): PluginSettings } // typed, see below
  readonly i18n: { t(key: string, params?: MessageParams): string }
  readonly log: PluginLogger
  readonly ui: {
    toast(message: PluginMessage, level?: ToastLevel): void
    registerToolbarItems(items: ToolbarContribution[]): PluginDisposer
    registerMenuActions(items: ActionContribution[]): PluginDisposer
  }
  readonly operations: {
    register(items: OperationDefinition[]): PluginDisposer
  }
  readonly editor: {
    // 'editor'
    getSnapshot(): Promise<EditorInputSnapshot>
    applyEdit(snapshot, text, scope: 'selection' | 'document'): Promise<boolean>
    focus(): void
    open(text?: string): void // was toEditor
    registerItems(
      placement: 'edit' | 'case' | 'format',
      items: EditContribution[]
    ): PluginDisposer
  }
  readonly browser: { open(url: string): Promise<void> } // 'browser'
  readonly notes: {
    // 'notes'
    append(note: { fileName: string; text: string }): Promise<NoteResult>
    save(note: { fileName: string; text: string }): Promise<NoteResult>
  }
}

type PluginMessage = { key: string; params?: MessageParams } | { text: string }
type NoteResult =
  | { ok: true; path: string }
  | { ok: false; errorCode: NoteErrorCode; detail?: string }
```

Что меняется:

- Пространства `editor`, `browser`, `notes` (и будущие `net`, `llm`, …)
  совпадают с возможностями. Обращение к пространству без возможности —
  ошибка с понятным текстом; в типах SDK каждое пространство помечено
  возможностью в JSDoc.
- `callApiFunction` удаляется. Папку заметок плагин больше не передаёт: хост
  берёт её из действующих настроек (настройки плагина или команды текущего
  вызова) и передаёт в `write_plugin_note` вместе с идентичностью плагина.
- `registerItems(placement, …)` заменяет три метода; `registerMenuActions`
  заменяет `registerActionsItems`.
- Удаляются `setEditorInputValue`, `replaceEditorInputSelection`,
  `getEditorInputValue`, `getEditorInputSelectedText`. Для мгновенной правки
  остаётся `applyEdit` на свежем снимке.
- Удаляются `name`, `preserveWhitespace`; `useFullEditorText` заменяется на
  `input: 'selection' | 'document' | 'selectionOrDocument'`.
- Пары «ключ / текст» сводятся к `PluginMessage` (`{ key }` или `{ text }`)
  в тостах, ошибках и результатах операций. В статических метаданных
  (`labelKey`, `tooltipKey`) пары пока остаются — их проверяет валидатор и
  они видны в манифесте.
- `PluginError(messageKey, params?)` — с параметрами; хост переводит их тем же
  механизмом, что и тосты.
- **Типизированные настройки.** Хелпер `defineSettings(fields)` в SDK выводит
  тип значений из массива полей (`as const`), `ctx.config.get()` возвращает
  полный объект: хост уже подставляет значения по умолчанию и отбрасывает
  неизвестные поля, так что `Partial` не нужен.
- **Типизированные коды ошибок.** Общий `HostErrorCode`
  (`permissionDenied`, `invalidInput`, `resourceLimit`, `notFound`,
  `unavailable`, `cancelled`, `timeout`, `network`) для всех сервисов.

Работа:

- SDK: новые типы, `defineSettings`, `PluginMessage`, обновлённый
  `PluginError`, фейки в `@tyco/plugin-sdk/testing` для каждого пространства.
- Хост: `createPluginContext` строит v3; адаптер v2 → v3; RPC-сервисы
  воркера по пространствам (`editor.getSnapshot` и т. д.) в
  `runtime-protocol.js`.
- Rust: `validation.rs` и `package-format.rs` принимают `apiVersion` 2 и 3;
  общие кейсы в `test-fixtures/manifests.json`.
- Перевести пять встроенных плагинов на v3.
- Документация: `docs/plugins.md` — пример и таблица возможностей;
  `plugin-packages.md` — контракт v3 и судьба v2.

Критерий готовности: все встроенные плагины на v3, тестовый внешний пакет v2
работает через адаптер, `pnpm check:plugins` и `pnpm test:plugin-runtime`
зелёные.

### 4.2. Паритет операций с ядром

Переносим в SDK `OperationDefinition` то, что ядро уже умеет, в виде,
пригодном для RPC (синхронные функции хоста становятся асинхронными или
декларативными):

- `inputSchemaFor(config)` → асинхронная `inputSchemaFor`, результат
  кешируется на время редактирования команды и проверяется
  `validateOperationSchema`.
- `getUnavailableReasonKey()` → `isAvailable(config): Promise<true | PluginMessage>`
  с кешем; хост показывает причину в редакторе команд и меню.
- `canLogOutput`, `voiceOutputAction` — просто поля.
- `voicePhrasesKey` — ключ `local.*` с фразами через `;` и `{name}` для
  параметра, как у ядра; `defaultPhrasesKey` остаётся для подсказки при
  создании команды.
- Параметры: `voiceValuesKey` (объект значений в локалях плагина),
  `voiceErrorKey`, декларативные `voiceVariants` (значение → дополнительные
  произношения, вне зависимости от локали), `preferVoiceValue` как
  асинхронная функция.
- `canRunFromChat`, `commandParameters`, `previewConfig` уже есть — без
  изменений.

Работа: SDK-типы и валидация; адаптер в `plugin-operation-adapter.ts`;
голосовой разбор (`lib/voice-commands/`) не должен различать операции ядра и
плагинов. Тест: операция плагина с параметром-перечислением распознаётся с
голоса так же, как `core.translate`.

Потребители: SearchInInternet (голосовой выбор поисковика), FastNote (выбор
шаблона голосом).

### 4.3. Сеть и секреты (`network`)

Самый ценный этап: без него невозможны интеграции.

**Манифест.** Новая возможность `network` и поле с перечнем origin'ов:

```ts
network?: {
  /** Fixed origins, shown at install time */
  origins?: string[]
  /** Text settings whose saved value is an allowed base URL (self-hosted services) */
  originFields?: string[]
}
```

Origin'ы — только `https://` или `http://localhost`/`127.0.0.1` (для
локальных сервисов вроде Anki-connect), без масок. Поле `originFields`
работает как `notesDirectoryField`: право появляется только после того, как
пользователь сохранил URL; значения по умолчанию и пресеты права не дают.

**Секреты.** Новый тип поля настроек `secret`. Хост хранит значение в
`SecretStore` под id `plugin.<pluginId>.<field>` и привязывает его к
origin'ам плагина (`SecretStore::set(..., origins)`). В настройки и в
`ctx.config.get()` попадает только `tyco-secret:<id>`. Плагин подставляет
ссылку в заголовок или тело запроса, Rust заменяет её на ключ при отправке —
тот же механизм, что у провайдеров.

**API.**

```ts
ctx.net.fetch(url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string | ArrayBuffer
  timeoutMs?: number            // <= 60_000
  signal?: AbortSignal
}): Promise<{ status: number; headers: Record<string, string>; body(): Promise<string>; bytes(): Promise<ArrayBuffer> }>
```

WebSocket и стриминг ответа — позже, когда понадобятся (например, для
стримингового LLM-провайдера плагином; для `llm` они не нужны).

**Проверка в Rust.** Сегодня `NetworkPolicy`
(`src-tauri/src/services/net/authorization.rs`) общая: разрешены origin'ы из
конфига и все origin'ы любых секретов. Для плагинов нужна отдельная политика:

- Новая команда `plugin_fetch` (или владелец задачи `plugin:<id>` в
  `NetState`) принимает id плагина, назначенный хостом, а не аргументом из
  воркера.
- Разрешённые origin'ы = `network.origins` из _установленного_ манифеста
  (для встроенных — таблица рядом с `BUNDLED_NOTES_FIELDS`) ∪ сохранённые
  значения `originFields`.
- Подставлять можно только секреты `plugin.<pluginId>.*`, и только в запросы
  к их origin'ам.
- Лимиты: размер запроса и ответа (по умолчанию 8 MiB, как RPC), число
  одновременных запросов на плагин, таймаут. Редиректы — только в пределах
  разрешённых origin'ов.
- Логи запросов без тел и секретов, с id плагина.

**Установка и обновление.** Окно установки показывает origin'ы. Если в
обновлении появились новые возможности или origin'ы, показывается разница и
требуется повторное согласие (`plugin-installation.ts`, `inspection.rs`).

**Потребитель.** Два варианта, выбрать перед началом этапа:

1. Перенести операцию `webhook` (`lib/operations/script-and-webhook-operations.ts`)
   во встроенный плагин `plugin-webhook`. Плюс — реальная функция и проверка
   секретов. Минус — нужна миграция `operationId` сохранённых команд
   (`webhook` → `Webhook.send`) и переноса секретов из
   `services/secrets/webhook.rs`; URL вебхука произвольный, то есть это
   случай `originFields`.
2. Новый встроенный плагин-интеграция (например, LanguageTool — проверка
   грамматики с выбираемым сервером) — заодно второй потребитель этапа 6.

Рекомендация: вариант 2 для запуска, перенос `webhook` — отдельным решением
после, когда API устоится.

### 4.4. LLM (`llm`)

```ts
ctx.llm.generate(request: {
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxOutputTokens?: number
  signal?: AbortSignal
  onText?: (delta: string) => void     // streaming via RPC callback
}): Promise<{ text: string; finishReason: string }>

ctx.llm.extract(text: string, schema: JsonSchema, instructions?: string):
  Promise<Record<string, unknown>>     // same as parseText today
ctx.llm.isAvailable(): Promise<boolean>
```

- **Модель выбирает пользователь.** Новый тип поля настроек `llmModel` (список
  моделей пользователя, пустое значение — модель по умолчанию). Плагин не
  перечисляет модели и не видит провайдеров и ключей.
- Запрос идёт через `lib/llm/llm-client.ts` с тем же транспортом и
  секретами, что у ядра. Инструментов, файлов и изображений в первой версии
  нет — только текст.
- Лимиты: `maxOutputTokens` не больше настройки модели, ограничение
  параллельных запросов на плагин, учёт в журнале действий с id плагина.
- `OperationParseContext.llm` для плагинов v3 передаётся, только если у
  плагина есть `llm`; для v2 остаётся как есть (совместимость).
- Отмена: `signal` объединяется с жизненным циклом плагина и вызова.

Потребитель: выбрать при старте этапа. Кандидаты — генерация заголовка
заметки в FastNote (опционально, отключено по умолчанию) или новый плагин
«краткое изложение в заметку».

### 4.5. Хранилище (`storage`)

```ts
ctx.storage.kv.get<T>(key): Promise<T | undefined>
ctx.storage.kv.set(key, value: JsonValue): Promise<void>
ctx.storage.kv.delete(key): Promise<void>
ctx.storage.kv.keys(prefix?): Promise<string[]>

ctx.storage.files.read(path, as: 'text' | 'bytes')
ctx.storage.files.write(path, data)
ctx.storage.files.list(dir?)
ctx.storage.files.delete(path)
```

- Две области: `synced` — в папке данных (`docs/data-folder.md`),
  синхронизируется; `device` — кеш на устройстве (словари, загрузки). Область
  выбирается параметром (`ctx.storage.device.files…`).
- Rust-сервис `services/plugin_storage` (имя уточнить): корень
  `plugins-data/<pluginId>/<scope>/`, проверка путей как у заметок (без `..` и
  symlink), атомарная запись (`atomic_file.rs`), квоты (например, 5 MiB на
  KV, 256 MiB на файлы `device`, 32 MiB на `synced`) с кодом
  `resourceLimit`.
- KV — один JSON-файл на плагин; при конфликте синхронизации побеждает
  последняя запись, это документируется. Порядок описать в `config-storage.md`.
- Удаление плагина сохраняет данные (как настройки); в настройках плагина
  кнопка «Удалить данные плагина».

Потребитель: пользовательский словарь проверки орфографии (`synced`) и
скачанные словари Hunspell (`device`).

### 4.6. Расширения редактора

Возможность `editor` уже есть; расширяем её, а не вводим новую.

**Диагностики** — подчёркивания с исправлениями:

```ts
ctx.editor.registerDiagnostics({
  id: string
  debounceMs?: number                  // >= 150
  check(input: { text: string; from: number; to: number; revision: number; signal: AbortSignal }):
    Promise<Array<{
      from: number; to: number
      severity: 'error' | 'warning' | 'info'
      message: PluginMessage
      fixes?: Array<{ label: PluginMessage; replacement: string }>
      actions?: Array<{ id: string; label: PluginMessage }>   // e.g. "Add to dictionary"
    }>>
  onAction?(actionId: string, diagnostic): Promise<void>
})
```

- Хост передаёт видимый диапазон (с запасом), а не весь документ, отбрасывает
  ответы по устаревшей ревизии, рисует через CM6 lint/decorations и показывает
  исправления в контекстном меню (`dev_docs/editor.md`).
- Исправление применяется хостом через снимок и ревизию, как правки меню.
- Лимиты: число диагностик на ответ, таймаут ответа; медленный плагин
  перестаёт вызываться до следующей правки.

**Автодополнение:**

```ts
ctx.editor.registerCompletions({
  id: string
  triggerCharacters?: string[]
  complete(input: { textBefore: string; textAfter: string; signal }):
    Promise<Array<{ label: string; insert: string; detail?: string }>>
})
```

Таймаут короткий (≈150 мс), иначе подсказка не показывается.

**Риск: WASM.** Политика воркера (`services/plugins/protocol.rs`) задаёт
`script-src 'self'` без `'wasm-unsafe-eval'`, поэтому `WebAssembly.compile` во
внешнем воркере, скорее всего, заблокирован. Для Hunspell (`hunspell-asm`) это
нужно решить: разрешить `'wasm-unsafe-eval'` для воркеров плагинов (это не
`eval` JS; оценить отдельно) или взять чистый JS (`nspell`). Встроенный плагин
работает в контексте хоста и подчиняется CSP приложения — проверить, что там
WASM разрешён.

**Потребитель.** Проверка орфографии делается встроенным плагином
`plugin-spellcheck` вместо функции ядра; `plan-spellcheck.md` переписать под
это (словари — через `network` + `storage.device`, пользовательский словарь —
`storage.synced`, подсветка — диагностики).

### 4.7. Диалоги и панели

**Диалоги** (без отдельной возможности, только при видимом окне):

```ts
ctx.ui.pick({ title: PluginMessage, items: Array<{ value: string; label: string; description?: string; icon?: string }>, canFilter?: boolean }): Promise<string | undefined>
ctx.ui.prompt({ title: PluginMessage, fields: InputConfigItem[] }): Promise<Record<string, unknown> | undefined>
ctx.ui.confirm({ message: PluginMessage, danger?: boolean }): Promise<boolean>
```

- Формы — тот же рендер полей, что у настроек (`visibleWhen` и т. д.).
- Если окна нет (внешний вызов, фон), вызов завершается с кодом
  `unavailable` — как `ask` → `deny` в чате.
- Один открытый диалог на плагин; отмена вызова закрывает диалог.

**Панели** (`panel`, позже, после диалогов):

```ts
ctx.ui.registerPanel({ id, label: PluginMessage, icon }): PanelHandle
handle.render(tree: PanelNode)          // markdown | list | table | form | button | progress
handle.onAction((actionId, payload) => …)
```

- Декларативное дерево с ограниченным набором узлов и лимитом размера;
  хост рисует его компонентами `components/common`.
- Где показывать: отдельная вкладка «Плагины» в навигации основного окна или
  боковая панель редактора — решить отдельным мини-проектом UI
  (`ui-system.md`).

Потребитель: интеграция из этапа 3 (выбор проекта или задачи через `pick`,
список результатов — панель).

### 4.8. События и диктовка (`stt`)

```ts
ctx.events.on(event, handler): PluginDisposer
```

| Событие                         | Данные                                     | Возможность |
| ------------------------------- | ------------------------------------------ | ----------- |
| `editorChanged`                 | ревизия; текст — по запросу через снимок   | `editor`    |
| `windowShown` / `windowHidden`  | какое окно                                 | —           |
| `localeChanged`, `themeChanged` | id                                         | —           |
| `dictationFinished`             | итоговый текст, язык                       | `stt`       |
| `commandFinished`               | id команды, id операции, `ok` — без вывода | —           |

- События с debounce и без гарантии доставки каждого изменения.
- Подписки снимаются с жизненным циклом плагина (`ctx.signal`).
- Сырого аудио и промежуточных результатов STT нет (согласно исходному плану).

Потребитель `stt`: выбрать при старте этапа (например, голосовые заметки в
FastNote: итог диктовки сразу в заметку).

### 4.9. Вывод, буфер обмена, команды, переменные

- `clipboard`: `ctx.clipboard.readText()`, `ctx.clipboard.writeText(text)`
  (через `lib/clipboard/`). Чтение — отдельное явное право, поскольку в
  буфере бывают пароли.
- `output`: `ctx.output.insert(text)` — вставка в активное окно тем же путём,
  что у вывода команд (`lib/text-insertion/`); только по действию
  пользователя или внутри вызова операции, не из таймера.
- `commands`: `ctx.commands.run(commandRef, input?)`. Какие команды можно
  запускать, решает пользователь: новый тип поля настроек `command`
  (выбор из своих команд). Цепочка вызовов учитывается через
  `callerCommandIds` для защиты от рекурсии; доступ к чату (`core.askInChat`)
  — тем же путём.
- Переменные: флаг поля `substituteVariables: true` — хост подставляет
  `{{var:…}}` в значение перед передачей плагину (`lib/variables/`).
  Произвольного чтения переменных нет: в них бывают значения устройства и
  адреса. FastNote может отказаться от части своего движка шаблонов.

### 4.10. Провайдеры

После `network`:

- `registerTranslationProvider({ id, label, languages(), translate({ text, source, target, format, signal }) })`
  — провайдер появляется в списке провайдеров перевода рядом с DeepL и Google
  (`lib/translation/machine-providers.ts`). Встроенные провайдеры остаются в
  ядре.
- Провайдеры STT и LLM в плагинах не делаем: аудиопоток и тяжёлая интеграция с
  ai-kit, а реальной потребности нет.
- Инструменты чата плагинам напрямую не даём: решение из `architecture.md`
  («операция становится инструментом только через команду») сохраняется —
  оно встроено в политику `ask`/`allow`.

## 5. Граница ядра и плагинов

| Что                                             | Решение                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Проверка орфографии (ещё не сделана)            | Сразу встроенным плагином (этапы 5–6)                                           |
| Операция `webhook`                              | Кандидат на перенос после этапа 3, отдельным решением с миграцией `operationId` |
| Машинный перевод DeepL/Google                   | Остаётся в ядре; сторонние провайдеры — через этап 10                           |
| `core.styling`, `core.transformation`           | Остаются: тесно связаны с голосом, настройками и LLM ядра                       |
| `script`                                        | Остаётся: запуск процессов — зона доверия Rust                                  |
| Диалог, чат, STT, LLM, история, горячие клавиши | Остаются платформой                                                             |

### Пересмотр диалога как плагина

Когда `llm`, `stt`, `storage` и панели будут готовы и их будут использовать
два-три плагина, проверить, что ещё понадобилось бы диалогу (живые аудиопотоки,
окно-оверлей, высокочастотный пользовательский вид, типизированный блок
истории) и стоят ли эти вещи публичного контракта. До тех пор окно субтитров
остаётся окном только для диалога: обобщать его не для кого.

## 6. Чего не делаем

- Свой DOM, CSS, iframe с кодом плагина в окнах приложения.
- Произвольный доступ к файловой системе, запуск процессов, нативные модули.
- Доступ к глобальному конфигу, другим плагинам, истории, чатам и сырым
  секретам.
- Сырое аудио и инструменты LLM для плагинов (пересмотреть после этапа 8).
- Маски origin'ов и «доступ ко всей сети».

## 7. Общие требования к каждому этапу

- Тип возможности в `PluginCapability`, проверка в Rust-валидаторе манифеста и
  общие кейсы в `test-fixtures/manifests.json`.
- Описание возможности в окне установки и в таблице `docs/plugins.md`
  (простым языком, без деталей реализации).
- Фейк сервиса в `@tyco/plugin-sdk/testing` для модульных тестов плагинов.
- Тесты хостового адаптера (проверка возможности, отмена, лимиты, ошибки) и
  Rust-сервиса (`integration_*` для тестов, которые поднимают сокеты).
- Проверка в `pnpm test:plugin-runtime`: внешний воркер получает сервис через
  порт и не получает его без возможности.
- После изменения команд или IPC — `pnpm generate:desktop`.
- Локали: новые ключи во всех файлах `apps/desktop-ui/src/lib/i18n/locales/`.
- По завершении этапа перенести итог в `plugin-packages.md` и удалить пункт из
  плана; когда план выполнен — удалить файл.

## 8. Открытые вопросы

1. Срок поддержки v2 после выхода v3 и есть ли внешние пакеты, которые
   надо сопровождать.
2. `'wasm-unsafe-eval'` для воркеров плагинов — допустимо ли с точки зрения
   модели угроз.
3. Где живут панели плагинов в навигации.
4. Квоты хранилища и сетевых запросов — подобрать по первому потребителю.
5. Первый потребитель `llm` и `stt`.
