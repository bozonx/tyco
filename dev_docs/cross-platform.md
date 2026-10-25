# Кроссплатформенность: поддержка, особенности систем, тестирование

> External CLI/D-Bus invocation rules and transport details are maintained in
> [External control API](../docs/external-control.md). External selection tests below
> require the master selection permission and an individual command grant.

Native quick-window selection is implemented on Windows through UI Automation
and on macOS through Accessibility. macOS captures the source application PID
and verifies its activation before pasting. Both native backends still need
verification on their operating systems; Linux checks do not exercise them.
Updated: 2026-10-13.

## 1. Целевые платформы

| Платформа                       | Статус         | Комментарий                                                                     |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| Linux, KDE Plasma 6, Wayland    | основная       | трекинг окон через KWin-скрипты, layer-shell, портал хоткеев                    |
| Linux, X11 (любой EWMH-WM)      | поддерживается | трекинг окон по событиям корневого окна, ydotool или портал, xclip              |
| Linux, GNOME / wlroots, Wayland | частично       | хоткеи через портал или конфиг композитора; вставка в окно, получившее фокус    |
| Windows 10 22H2+, 11            | partial        | UI Automation selection capture, HWND target, native clipboard, `SendInput`     |
| macOS 13+                       | partial        | Accessibility selection capture, PID target, verified paste through `osascript` |

ARM64 (Windows on ARM, Apple Silicon, Linux aarch64) API не меняет: те же
Win32, AppKit/Quartz, Wayland/X11/D-Bus. Отличаются только сборка и
упаковка — см. §6.

### Почему X11 остаётся

GNOME уже убрал X11-сессию, Plasma 6.8 станет Wayland-only. Но XFCE, MATE,
Cinnamon, i3, LXQt и LTS-дистрибутивы (Ubuntu 22.04, RHEL 9, Debian 12) живут
на X11 ещё годы. Кроме того, X11 — самая простая платформа: узнать, активировать
окно и нажать в нём клавиши можно без обходных путей. Новые возможности
специально под X11 не делаем, но всё, что работает на KDE Wayland, должно
работать и на X11.

## 2. Устройство платформенного слоя

Всё, что зависит от ОС и сессии, живёт в `src-tauri/src/services/platform/`.
Код вне этого модуля не проверяет `XDG_SESSION_TYPE` и не вызывает
системные утилиты сам — он спрашивает платформенный слой.

```
platform.rs           фасад: capture_foreground_target, capture_selection, inject_paste,
                      text_insertion_status, panel surface, titlebar, status overlay,
                      start_session_services
platform/
  session.rs          определение сессии один раз за процесс
  window_tracker.rs   общее состояние «какое окно активно, куда вставлять»
  clipboard.rs        запись текста и снимок буфера (ClipboardSnapshot) для всех ОС
  hotkeys.rs          выбор провайдера хоткеев и фасад портала GlobalShortcuts
  notifications.rs    системные уведомления
  keychain.rs         системное хранилище ключей: Keychain, Credential Manager,
                      Secret Service; без него ключи не сохраняются
  linux.rs, linux/
    dbus.rs           D-Bus API и колбэки KWin-трекера
    kwin.rs           бэкенд трекера: KWin-скрипты (KDE Wayland)
    x11.rs            бэкенд трекера: события _NET_ACTIVE_WINDOW (X11)
    text_injector.rs  нажатие клавиш: ydotool или портал RemoteDesktop
    remote_desktop.rs сессия портала RemoteDesktop и её restore token
    clipboard_restore.rs  снимок и восстановление буфера: wl-clipboard / xclip
    foreground_context.rs исходное окно и PRIMARY-выделение
    layer_shell.rs    gtk-layer-shell
    status_overlay.rs окно статуса на GTK
  windows.rs, windows/clipboard.rs, macos.rs  бэкенды этих ОС
```

### Сессия (`session.rs`)

`session::current()` возвращает `DisplayServer` (X11, Wayland, Native, Unknown)
и `Desktop` (KDE, GNOME, Hyprland, Sway, Other). Правила:

- `XDG_SESSION_TYPE` решает, если назван x11 или wayland;
- иначе `WAYLAND_DISPLAY` → Wayland (XWayland ставит и `DISPLAY`);
- иначе `DISPLAY` → X11 — это сессии через `startx`/`xinit` без
  логин-менеджера, где `XDG_SESSION_TYPE` нет или он равен `tty`.

Раньше каждая подсистема проверяла переменную сама, и в `startx`-сессии
хоткеи уходили во «внешний» режим, а замена выделения искала KWin.

### Трекер окон (`window_tracker.rs`)

Общее состояние: активное окно, его тип (чужое, своё, прочее), класс
приложения, последнее чужое окно. «Цель вставки» — активное чужое окно или,
если фокус в окне Tyco, то окно, бывшее до него. Бэкенды сообщают об активации
и закрытии окон с номером `session:number`, поэтому поздние и переставленные
сообщения не портят состояние.

Бэкенды:

- **KWin** (`linux/kwin.rs`) — скрипт в KWin шлёт события по D-Bus, второй
  скрипт активирует окно. Запускается из `dbus.rs`, когда занято имя
  `org.tyco.Service`.
- **X11** (`linux/x11.rs`) — `x11rb` (чистый Rust, без libxcb), подписка на
  `PropertyNotify` корневого окна: `_NET_ACTIVE_WINDOW` даёт активацию,
  разница `_NET_CLIENT_LIST` — закрытие. Своё окно узнаётся по `_NET_WM_PID`
  или `WM_CLASS`, чужое — по `_NET_WM_WINDOW_TYPE` NORMAL/DIALOG. Id окна
  десятичный. При потере соединения перезапускается с растущей
  паузой.
- **Windows / macOS** — пока нет (см. §4).

Если трекер не запущен (WM без EWMH), X11 читает `_NET_ACTIVE_WINDOW`
напрямую. Окно активируется запросом `_NET_ACTIVE_WINDOW` к оконному
менеджеру (`x11::activate_window`).

### Что дал трекер на X11

- окно Tyco больше не становится целью вставки: учитывается окно до него;
- «основное окно следует за последним приложением» (`follow_target_window`)
  работает и на X11;
- закрытое окно забывается, текст не уходит в случайное окно;
- известен `WM_CLASS`, поэтому терминалы получают Ctrl+Shift+C/V при замене
  выделения;
- фокус на рабочем столе или панели означает «цели нет», а не «вставить в
  рабочий стол».

Буфер обмена на X11 теперь сохраняется перед вставкой и замены выделения и
возвращается после неё — через `xclip -t TARGETS` и `xclip -t <type>`, как на
KDE через `wl-paste`.

### Вставка в другие окна (Linux)

Вставка — это два независимых шага:

1. **Окно-цель.** Трекер (KWin-скрипт или x11rb) знает окно, из которого
   открыли Tyco, и возвращает ему фокус. Без трекера (GNOME, wlroots,
   сломанный KWin) Tyco прячет своё окно и вставляет в окно, которое
   получило фокус; настройки показывают это предупреждением. Замена
   выделения без трекера недоступна: нельзя проверить, что фокус остался в
   том же окне, а Ctrl+C в терминале прерывает программу.
2. **Нажатие клавиш** (`linux/text_injector.rs`). Нужны только сочетания
   вставки и копирования, символы не печатаются. Порядок выбора:
   - **ydotool 1.x**, если найден в `PATH` и отвечает сокет `ydotoold`;
     работает и в X11, и в Wayland. 0.1.x распознаётся по справке
     `ydotool key --help` и считается неподходящим;
   - иначе **портал RemoteDesktop** (`linux/remote_desktop.rs`,
     `NotifyKeyboardKeycode`): KDE Plasma 6, GNOME. Первый запуск
     показывает диалог; restore token (`state_dir/remote-desktop.token`)
     даёт следующим сессиям стартовать без вопроса. Сессия живёт, пока
     идут нажатия, и закрывается через минуту простоя — рабочий стол
     показывает открытую сессию как удалённое управление.

Настройки получают статус командой `get_text_insertion_status` при каждом
открытии вкладки и могут запросить разрешение портала
(`request_text_insertion_permission`).

**Flatpak.** В песочнице нет `/dev/uinput` и программ хоста, поэтому
клавиши нажимаются только через портал (`session::is_sandboxed`). Сборке
нужны:

- `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc`;
- `--own-name=org.tyco.Service` — D-Bus API и отчёты KWin-трекера;
- `--talk-name=org.kde.KWin` — KWin-скрипты. Файлы скриптов пишутся в
  `$XDG_RUNTIME_DIR/app/$FLATPAK_ID/tyco`: только этот каталог песочницы
  виден хосту по тому же пути;
- `wl-clipboard` и `xclip` внутри пакета: инструменты хоста недоступны.

Порталы (RemoteDesktop, GlobalShortcuts) доступны без отдельных прав.
Сам манифест Flatpak пока не написан.

## 3. Linux: особенности окружений

| Возможность        | KDE Wayland            | GNOME Wayland                  | wlroots (Sway, Hyprland)                | X11                   |
| ------------------ | ---------------------- | ------------------------------ | --------------------------------------- | --------------------- |
| Глобальные хоткеи  | портал GlobalShortcuts | портал (GNOME 48+)             | конфиг композитора + `tyco-ctl`         | tauri global-shortcut |
| Трекинг окон       | KWin-скрипт            | нет API                        | нет (Hyprland: IPC-сокет, Sway: i3-IPC) | x11rb                 |
| Активация окна     | KWin-скрипт            | нет                            | IPC композитора                         | `_NET_ACTIVE_WINDOW`  |
| Нажатие клавиш     | ydotool / портал       | ydotool / портал RemoteDesktop | ydotool                                 | ydotool / портал      |
| Панель поверх окон | gtk-layer-shell        | нет layer-shell                | gtk-layer-shell                         | обычное окно          |
| PRIMARY-выделение  | wl-paste               | wl-paste*                      | wl-paste                                | xclip                 |

\* Без протокола data-control GNOME не отдаёт буфер фоновому клиенту:
`wl-paste` открывает своё окно и забирает фокус. Поэтому снимок буфера на
Wayland делается только в KDE.

Направления на будущее:

1. **wlroots** — бэкенды трекера на IPC Hyprland и i3-IPC Sway; ввод через
   `wtype` (virtual-keyboard).
2. **GNOME** — чужие окна недоступны без расширения Shell. Остаётся честная
   деградация: вставка через буфер обмена и уведомление.
3. **UI по возможностям**: отдавать во фронтенд набор доступных функций
   (сессия, наличие трекера, способ ввода), чтобы UI скрывал недоступное, а не
   показывал ошибку.

Известные проблемы окружения:

- NVIDIA + WebKitGTK: артефакты отрисовки, обход —
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- AppImage на Wayland иногда ломается из-за вшитых библиотек (EGL, Mesa).
- Flatpak: см. «Вставка в другие окна» ниже.

## 4. Windows и macOS: что сделать

### Windows

- Трекер окон: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` вместо снимка
  `GetForegroundWindow` в момент активации; свои окна — по PID процесса.
- Активация: `SetForegroundWindow` часто отклоняется правилами foreground lock;
  нужен `AttachThreadInput` или `AllowSetForegroundWindow`.
- UIPI: ввод в окна, запущенные от администратора, недоступен — сообщать об
  этом, а не молча ничего не делать.
- Буфер обмена: нативный API вместо запуска `powershell` (300+ мс на старт).
- Замена выделения: Ctrl+C / Ctrl+V через `SendInput`, снимок буфера —
  через Win32 Clipboard API.
- Secrets use the platform keychain (`keyring`): Windows Credential Manager,
  macOS Keychain, and Linux Secret Service. The webview receives references only.
- Бандл: `nsis` или `msi`, подпись кода (иначе SmartScreen).

### macOS

- Трекер: `NSWorkspace.didActivateApplicationNotification`, активное
  приложение — `frontmostApplication`; возврат — `activate` у
  `NSRunningApplication`.
- Ввод: `CGEventPost` с Cmd+V/Cmd+C вместо `osascript`.
- Разрешения: Accessibility (`AXIsProcessTrustedWithOptions` с запросом),
  микрофон (`NSMicrophoneUsageDescription` в Info.plist).
- Выделение: AX API (`kAXSelectedTextAttribute`), запасной путь — Cmd+C.
- Сочетания: во фронтенде «Ctrl» зашит в i18n и в `Settings.vue` — на macOS
  нужен ⌘ и Cmd+Enter.
- Бандл: `dmg`/`app`, подпись и нотаризация обязательны на практике.

### Для всех ОС

- Local control uses the authenticated transport in `tyco-activation-protocol`.
  The platform implementations and end-to-end transport tests are maintained
  in that crate, rather than an unauthenticated fixed TCP port.
- Уведомления вне Linux не реализованы.

## 5. Тестирование

Матрица полноценных Windows/Linux VM, переиспользование образов LHC и план
нативной приёмки описаны в [vm-testing.md](vm-testing.md). Это план, а не
подтверждение прохождения платформенных сценариев.

### Уровень 1 — CI на каждый push

- `ubuntu-latest`: fmt, clippy, тесты, сборка бандла (есть).
- `windows-latest`, `macos-latest`: required Clippy and unit tests
  (`rust-platforms` in `ci.yml`). These checks no longer allow failures.
- Добавить при выпуске релизов: `ubuntu-24.04-arm`, `windows-11-arm`, Intel
  macOS (пока GitHub даёт такие раннеры) — сборка бандла под каждую
  архитектуру.

Юнит-тесты платформенного слоя проверяют чистую логику: определение сессии,
состояние трекера, классификацию окон X11, выбор утилит буфера. Всё, что
требует настоящего дисплея, — уровни 2 и 3.

### Уровень 2 — e2e на Linux без виртуалок

Композиторы умеют работать без экрана, поэтому весь Linux-набор запускается в
контейнере или на CI:

| Окружение     | Как поднять                                                    |
| ------------- | -------------------------------------------------------------- |
| X11           | `Xvfb :99` + `openbox` или `xfwm4` (нужен EWMH-WM для трекера) |
| KDE Wayland   | `kwin_wayland --virtual --xwayland`                            |
| GNOME Wayland | `mutter --headless --wayland --virtual-monitor 1280x800`       |
| wlroots       | `sway` с `WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1`     |

Автоматизированный набор платформенного слоя запускается отдельно от WebDriver
и AI-команд, без сети во время тестов:

```sh
pnpm test:platform:linux x11
pnpm test:platform:linux kwin
pnpm test:platform:linux sway
```

Нужен Docker. Образ собирается на Debian Trixie с KWin 6; сборка скачивает
Rust-зависимости, запуск контейнера использует `--network=none`. Workflow
`.github/workflows/linux-platform.yml` запускает эту матрицу на Ubuntu 24.04
и сохраняет логи композитора, ввода и тестов. Обычный `cargo test` пропускает
эти тесты (`#[ignore]`); запуск требует явно выбранной изолированной сессии.

| Сессия                   | Автоматические проверки                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Xvfb + Openbox           | Настоящий x11rb-трекер, своё/чужое окно, активация через x11rb и вставка XSendEvent, xclip и PRIMARY, восстановление буфера, новая пользовательская копия, закрытие цели |
| KWin virtual + XWayland  | Production KWin-скрипты и D-Bus-отчёты, выбор и активация цели, вставка через XSendEvent в XWayland-клиент, wl-clipboard/PRIMARY, восстановление буфера и закрытие цели  |
| Sway headless + libinput | wl-clipboard/PRIMARY, настоящий ydotool: вставка без трекера в окно с фокусом, отказ снимка буфера вне KDE                                                               |

Тестовый редактор — отдельный GTK-процесс; он записывает содержимое поля в
файл, поэтому проверяется текст, действительно полученный чужим окном.
Окно с классом Tyco имитируется вторым процессом для проверки маршрутизации.
D-Bus-приёмник KWin передаёт события настоящему трекеру, без запуска Tauri UI.

Виртуальный KWin не читает libinput: эта строка матрицы не проверяет ydotool
и полную Wayland-вставку через `inject_paste`. Для настоящего ydotool строка
Sway использует `/dev/uinput`, `/dev/input`, seatd и привилегированный контейнер.
На Ubuntu-раннере workflow выполняет `modprobe uinput`; локально модуль тоже
должен быть загружен. Запускайте эту строку только на отдельном тестовом хосте:
доступ к input-устройствам предназначен для изолированного CI-раннера.
GNOME/Mutter и Weston в автоматическую матрицу пока не входят.

Native smoke (`pnpm test:desktop`) automates the full Linux/X11 path (Xvfb
reads no input devices, so `scripts/linux-platform/ydotool-xtest.py` stands in
for ydotool and its daemon and replays the keys through XTest): a
separate GTK editor → CLI quick-input activation → typing in the real Tyco
webview → insertion through the actions menu → checking the text recorded by
the foreign process. It also checks theme and history restoration after a native
process restart with the same isolated home. There is no IPC replacement or VM.
Windows runs the restart checks but does not run the foreign GTK editor scenario.

Other full-application scenarios (level 2, separate from platform adapter tests):

1. Запустить редактор (kate / gedit / xterm), ввести текст, выделить его.
2. Вызвать `tyco-ctl replace correction` — проверить текст в редакторе и что
   буфер обмена вернулся к прежнему.
3. Вызвать `tyco-ctl open quick-input`, набрать текст, отправить — проверить, что
   он попал в редактор, а не в окно Tyco.
4. Закрыть целевое окно до отправки — проверить, что текст остался в буфере.
5. Создать команду-скрипт `printf %s {{TEXT}} > /tmp/tyco-cmd`, доступную
   извне. `tyco-ctl run <id> текст` — проверить файл и что окно не
   показалось; `tyco-ctl run <id>` с выделением в редакторе — что команда
   выполнилась на выделении; `tyco-ctl commands list` — JSON со списком.

Тексты в редакторе проверяются через `xdotool`/`xclip` (X11) или через
сохранение файла редактором. Webview управляется `tauri-driver` +
WebdriverIO: он работает на Linux (WebKitWebDriver) и Windows (msedgedriver),
для macOS драйвера нет.

Для KDE нужен D-Bus сессии: запуск через `dbus-run-session`. ydotool в
контейнере требует `/dev/uinput` — проще проверять на KDE через xdotool в
XWayland-окне или в ВМ (уровень 3).

### Уровень 3 — набор виртуальных машин

Ручная или полуавтоматическая проверка перед релизом. Образы держать
снапшотами с установленными зависимостями.

| ВМ                                       | Зачем                                                    |
| ---------------------------------------- | -------------------------------------------------------- |
| Fedora KDE (последний Plasma)            | основная платформа, Wayland                              |
| Kubuntu LTS, сессия Plasma X11           | KDE на X11 — тот же WM, другой бэкенд                    |
| Ubuntu LTS (GNOME Wayland)               | самый массовый десктоп, деградация функций               |
| Linux Mint (Cinnamon) или Xubuntu (XFCE) | типичный X11                                             |
| Arch + Sway или Hyprland                 | wlroots, `tyco-ctl` из конфига                           |
| Windows 11 (x64)                         | основной Windows; плюс Windows 11 ARM при наличии железа |
| macOS (Apple Silicon)                    | только на железе Apple: UTM или Tart                     |

Инструменты:

- Linux и Windows — QEMU/KVM через `virt-manager` или `quickemu`; `quickemu`
  сам скачивает образы Ubuntu, Fedora, Windows.
- macOS — Tart (удобен для CI на своём Mac mini) или UTM. Разрешения TCC
  (Accessibility, микрофон) в ВМ не выдать автоматически — эти шаги ручные.
- Железо с NVIDIA проверять отдельно, в ВМ проблемы WebKitGTK не видны.

### Чек-лист ручной проверки

- хоткеи: регистрация, срабатывание, смена без перезапуска;
- быстрый ввод: появляется поверх текущего окна, получает фокус, вставляет в
  исходное окно;
- замена выделения: обычное окно, терминал, пустое выделение;
- буфер обмена возвращается к прежнему содержимому (текст и картинка);
- основное окно: цель вставки следует за последним приложением;
- статус-оверлей не забирает фокус;
- голос: доступ к микрофону, запись, распознавание;
- tray: меню, «Показать», «Исправить выделенное».

## 6. ARM и сборка

- API на ARM не отличаются; отличаются артефакты: отдельный бандл на
  архитектуру, на macOS — universal binary
  (`--target universal-apple-darwin`).
- Linux ARM собирать нативно на ARM-раннерах: кросс-компиляция GTK и
  WebKitGTK неудобна. `build.rs` уже смотрит на целевую ОС
  (`CARGO_CFG_TARGET_OS`), а не на хост.
- Если появится локальный инференс (Whisper, LLM) — проверять
  производительность на железе: NEON против AVX, Metal на macOS.
- Бандлы сейчас только `appimage` и `deb`; добавить `rpm`, `nsis`/`msi`,
  `dmg`, а также подпись для Windows и macOS.

For the current dependency boundaries and automated desktop smoke workflow, see [architecture.md](architecture.md).
