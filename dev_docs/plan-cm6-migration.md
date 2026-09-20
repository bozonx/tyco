# План перехода редактора TyCo на CodeMirror 6

Статус: этап 1 реализован, этапы 2-6 не начаты.
Дата: 2026-09-20

## 1. Зачем уходим с `<textarea>`

Сейчас основной ввод — это `ui/src/components/EditorInput.vue` → `ui/src/components/common/FieldTextArea.vue`,
то есть обычная `<textarea>`. Состояние живёт в `ui/src/stores/editorInput.ts`
(`value`, `selectionStart`, `selectionEnd`, `selectedText`, счётчики `focusCount` / `selectAllCount`).

Ограничения, из-за которых `textarea` не подходит дальше:

- **Нельзя подсветить отдельное слово.** Внутри `textarea` нет DOM-узлов для отдельных фрагментов
  текста. Красная волна под словом с ошибкой физически невозможна. Обходной путь (зеркальный `div`
  под текстареей с синхронизацией шрифта, переносов и скролла) — известный источник багов и
  отбрасывается.
- **Нет координат позиции в тексте.** Для bubble-меню над выделением и для контекстного меню по слову
  под курсором нужны координаты произвольного смещения в тексте. `textarea` их не даёт.
- **Undo неуправляем.** Нативный undo `textarea` ломается, как только текст меняется программно
  (`replaceSelection`, результат AI-действия, вставка распознанной речи). Сейчас после каждого
  AI-преобразования история ввода фактически теряется.
- **Нет подсветки синтаксиса** для вставленного кода и Markdown.

## 2. Почему CodeMirror 6, а не Tiptap/ProseMirror и не голый contenteditable

**CodeMirror 6** — выбранный вариант:

- Модель документа — плоский текст. `view.state.doc.toString()` даёт ту же строку, что сейчас лежит
  в `editorInputStore.value`. Назначение приложения (расширенный текстовый буфер: текст вошёл,
  преобразовался, ушёл во внешнее окно) совпадает с моделью редактора.
- Декорации (`Decoration.mark`) — штатный механизм подсветки диапазонов, рендерятся только для
  видимой области и не попадают в историю undo.
- `history()` из коробки, с корректной группировкой транзакций и с возможностью помечать
  программные правки (AI-преобразования) как отдельные шаги отмены.
- `posAtCoords` / `coordsAtPos` — точные координаты для меню.
- Подсветка синтаксиса — опциональные пакеты `@codemirror/lang-*`.

**Tiptap / ProseMirror** — отклонён. Его документная модель — дерево узлов, то есть при каждом
вызове AI и при каждой выдаче текста наружу потребовалась бы сериализация, плюс схема, node views,
paste rules и заметно больший бандл — ради форматирования, которое в буфере отображать не планируется.
Пересмотреть решение стоит только если появится требование показывать в буфере жирный/курсив/списки
как оформление.

**Голый contenteditable** — отклонён: пришлось бы вручную писать undo, восстановление выделения и
санитизацию вставки, то есть воспроизводить CodeMirror, но хуже.

## 3. Ключевое решение по форматированию: внутри — Markdown, не HTML

Буфер остаётся строкой. HTML внутри приложения не хранится.

При вставке из буфера обмена смотрим `clipboardData`:

- есть `text/html` → конвертируем в Markdown и вставляем Markdown;
- нет → вставляем `text/plain` как есть.

Конвертация делается на уже имеющемся стеке `unified` (в `ui/package.json` есть `unified`,
`remark-parse`, `remark-stringify`); добавляются только `rehype-parse` и `rehype-remark`.

Что это даёт:

- «Вставить с форматированием» = вставить Markdown (сохраняются заголовки, списки, ссылки);
- «Вставить без форматирования» = plain text;
- наружу (в чужое окно, через `type_into_window_and_close` / `put_into_clipboard_and_close`)
  уходит строка, как и раньше;
- в LLM уходит строка — Markdown для модели естественен;
- код из буфера обмена приезжает fenced-блоком.

С включённым `@codemirror/lang-markdown` подсветка заголовков и вложенных fenced-блоков кода
(с определением языка) получается бесплатно — отдельный «режим кода» не нужен.
`highlight.js` и `js-beautify` остаются за `useCodeFormatter` (форматирование и превью), их не трогаем.

## 4. Целевая архитектура

```
EditorView.vue
  └── Editor.vue                    (кнопки, edit-меню, action-меню — не меняется)
        └── EditorInput.vue         (переписывается: обёртка над CM6, тот же контракт наружу)
              ├── lib/editor/createEditorState.ts   расширения, тема, keymap
              ├── lib/editor/paste.ts               обработка HTML → Markdown
              ├── lib/editor/contextMenu.ts         позиция + слово под курсором
              └── lib/editor/spellcheck/            (см. plan-spellcheck.md)
```

`stores/editorInput.ts` сохраняет публичный API (`value`, `setValue`, `replaceSelection`,
`setValueAtCursor`, `clear`, `focus`, `selectAll`, `setSelection`, `selectionStart/End`,
`selectedText`). Всё меню (`Editor.vue`, `stores/edditMenu.ts`, `stores/actionMenu.ts`,
`components/menu/*`) работает со смещениями в строке — CodeMirror оперирует такими же смещениями,
поэтому меню переписывать не нужно.

Важная деталь: сейчас стор — источник истины, а `textarea` — отображение. С CM6 источником истины
становится `EditorState`, а стор — его зеркало. Чтобы не получить цикл обновлений, вводим правило:

- пользовательский ввод: CM6 → `updateListener` → `store.setValue()` с флагом «из редактора»;
- программная правка: `store.*` → `view.dispatch()`; обратный `updateListener` сравнивает новый
  `doc` с `store.value` и, если они совпадают, ничего не делает.

## 5. Зависимости

Добавить в `ui/package.json`:

```
@codemirror/state
@codemirror/view
@codemirror/commands        — history(), defaultKeymap, historyKeymap
@codemirror/language        — syntaxTree, HighlightStyle
@codemirror/lang-markdown   — подсветка Markdown и вложенного кода
@lezer/highlight            — теги для темы подсветки
rehype-parse
rehype-remark
```

Намеренно **не** берём метапакет `codemirror` — он тянет автодополнение, поиск, lint и подсветку
скобок, которые в текстовом буфере не нужны. Собираем набор расширений вручную.

## 6. Этапы

### Этап 1. Паритет с текущей `textarea` — сделано

Цель: `EditorInput.vue` на CM6 ведёт себя ровно как сейчас, ничего не сломано.

1. `ui/src/lib/editor/createEditorState.ts` — базовый набор расширений:
   `history()`, `keymap.of([...defaultKeymap, ...historyKeymap])`, `EditorView.lineWrapping`,
   `EditorState.allowMultipleSelections.of(false)`, плейсхолдер, `EditorView.contentAttributes.of({ spellcheck: 'false' })`.
2. Переписать `EditorInput.vue`: создание `EditorView` в `onMounted`, `destroy()` в `onUnmounted`.
3. `updateListener`: на `update.docChanged` → `editorInputStore.setValue(...)`;
   на `update.selectionSet` → `editorInputStore.setSelection(text, from, to)`.
   Оба — с защитой от эха (см. п.4).
4. Реализовать `defineExpose({ focus, select })` через `view.focus()` и
   `view.dispatch({ selection: EditorSelection.single(start, end) })` — сигнатуры те же, что у
   `FieldTextArea`, поэтому существующие `watch` в `EditorInput.vue` на `focusCount` и
   `selectAllCount` остаются без изменений.
5. Программные правки из стора применять транзакцией, а не переприсваиванием документа,
   чтобы не рушить историю undo.

Критерий приёмки этапа: `pnpm test:ui` и `pnpm type-check` зелёные; вручную проверены — ввод,
выделение мышью и клавиатурой, работа кнопок edit-меню и action-меню над выделением, вставка
результата распознавания речи, `clear`, `selectAll`, сохранение черновика в историю
(`saveMainInputTmp` по дебаунсу 600 мс).

### Этап 2. Undo и программные правки

1. Все правки из стора (`replaceSelection`, `setValueAtCursor`, `setValue` извне) проходят через
   один helper `applyStoreEdit(view, ...)`, который ставит транзакцию с `userEvent`
   (`'input.paste'`, `'tyco.ai'`, `'tyco.voice'`) — это делает каждое AI-преобразование
   отдельным шагом Ctrl+Z.
2. `isolateHistory` на транзакциях AI-правок, чтобы они не склеивались с ручным вводом.
3. Тесты: применить преобразование → Ctrl+Z возвращает исходный текст с прежним выделением.

### Этап 3. Вставка и форматирование

1. `ui/src/lib/editor/paste.ts`: `EditorView.domEventHandlers({ paste })`.
2. `htmlToMarkdown(html: string): string` на `rehype-parse` → `rehype-remark` → `remark-stringify`
   (настройки stringify согласовать с уже используемыми в `useCodeFormatter.formatMdAndStyle`,
   чтобы стиль Markdown в приложении был один).
3. Поведение по умолчанию задаётся настройкой в `packages/shared/src/user-config.ts`:
   `pasteMode: 'plain' | 'markdown' | 'ask'`. Значение по умолчанию — `markdown`.
4. `Ctrl+Shift+V` — всегда plain, независимо от настройки.
5. При `ask` — маленькое меню у курсора с двумя вариантами; реализуется поверх компонента из этапа 4.
6. Тесты на `htmlToMarkdown`: заголовки, вложенные списки, ссылки, `<pre><code>` → fenced-блок,
   таблица, мусорные обёртки от офисных редакторов.

### Этап 4. Контекстное меню и bubble-меню

Меню делаем своё, на HTML — варианты исправлений приходят из собственного словаря, и меню должно
следовать теме приложения (daisyUI). На `contextmenu` вызываем `preventDefault()` — в Tauri webview
это нужно в любом случае.

1. `ui/src/components/editor/EditorContextMenu.vue` — плавающий список пунктов, позиционируется по
   переданным координатам, закрывается по Esc / клику вне / скроллу.
2. ПКМ: `view.posAtCoords({ x, y })` → определяем слово под курсором → пункты:
   варианты исправления (из спеллчекера), «Добавить в словарь», «Пропустить», разделитель,
   Вырезать/Копировать/Вставить/Вставить как текст.
3. Bubble-меню при непустом выделении: позиция из `view.coordsAtPos(selection.from)`, содержимое —
   AI-действия из `stores/actionMenu.ts` и `stores/edditMenu.ts` (переиспользуем те же элементы,
   что рисует `Editor.vue`, без дублирования логики).
4. Bubble-меню — дополнение, а не замена: ПКМ для исправления слова, bubble для действий над
   выделением. Включается настройкой `showBubbleMenu` (по умолчанию включено).
5. Все подписи — через `ui/src/lib/i18n/messages.ts`; новые ключи в неймспейсе `editor.menu.*`.

### Этап 5. Подсветка и внешний вид

1. Подключить `@codemirror/lang-markdown`; режим документа — настройка
   `editorSyntax: 'none' | 'markdown'` (по умолчанию `markdown`).
2. Своя тема на `EditorView.theme()` + `HighlightStyle.define()`, цвета — из CSS-переменных
   темы приложения (`ui/src/assets/main.css`, `stores/theme.ts`), чтобы светлая/тёмная темы
   переключались без пересоздания редактора.
3. Отдельно проработать «писательский» вид: пропорциональный шрифт, крупный интерлиньяж, поля.
   Это единственный заметный минус CM6 — по умолчанию он выглядит как редактор кода, и вид
   настраивается вручную. Заложить на это отдельную задачу.

### Этап 6. Спеллчек

Отдельный документ: `dev_docs/plan-spellcheck.md`. Подключается как расширение CM6 после этапа 4
(нужны готовое контекстное меню и стабильная модель документа).

## 7. Чего в плане намеренно нет

- Rich text (жирный/курсив как оформление) — решение принято: не делаем.
- Совместное редактирование, коллаборация.
- Подсветка произвольных языков как режим редактора — вложенные fenced-блоки в Markdown покрывают
  сценарий «вставил код, посмотрел».
- Замена `ChatInput.vue`, `WriteModeInput.vue`, `DiffInput.vue` — они остаются на `FieldTextArea`.
  `FieldTextArea` не удаляем.

## 8. Риски

| Риск | Смягчение |
|---|---|
| Цикл обновлений стор ↔ редактор | Единая точка применения правок + сравнение с текущим `doc` перед dispatch |
| Потеря поведения существующего меню | Этап 1 закрывается ручным прогоном всех пунктов edit/action-меню |
| Вид «как IDE» вместо «как блокнот» | Отдельная задача на тему в этапе 5 |
| Рост бандла | Ручной набор расширений вместо метапакета `codemirror` |
| Регрессия в мобильном/сенсорном вводе | Не актуально: целевые платформы — десктоп (Linux/macOS/Windows) |
