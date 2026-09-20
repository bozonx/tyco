#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;
#[cfg(all(target_os = "linux", feature = "layer"))]
mod layer;
mod metrics;

use std::sync::Arc;

use metrics::{now_ns, Metrics};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

const WINDOW: &str = "main";

#[derive(Clone, Copy, PartialEq)]
enum WindowMode {
    /// Обычное окно. На Wayland позиционировать себя не может.
    Toplevel,
    /// zwlr_layer_shell_v1 через gtk-layer-shell, прижат к низу экрана.
    Layer,
}

#[derive(Clone, Copy, PartialEq)]
enum Lifecycle {
    /// hide() уничтожает поверхность, show() создаёт заново.
    HideShow,
    /// Поверхность остаётся замапленной, гасится только содержимое и клавиатура.
    Keep,
}

#[derive(Clone, Copy, PartialEq)]
enum DomMode {
    /// Поле смонтировано и сфокусировано всегда, ещё до показа окна.
    Warm,
    /// Поле создаётся в момент показа — как сейчас в TyCo через роутер.
    Cold,
}

struct Lab {
    metrics: Metrics,
    window_mode: WindowMode,
    lifecycle: Lifecycle,
    dom_mode: DomMode,
}

impl Lab {
    fn from_env() -> Self {
        let window_mode = match std::env::var("LAB_WINDOW").as_deref() {
            Ok("layer") => WindowMode::Layer,
            _ => WindowMode::Toplevel,
        };
        let lifecycle = match std::env::var("LAB_LIFECYCLE").as_deref() {
            Ok("keep") => Lifecycle::Keep,
            _ => Lifecycle::HideShow,
        };
        let dom_mode = match std::env::var("LAB_DOM").as_deref() {
            Ok("cold") => DomMode::Cold,
            _ => DomMode::Warm,
        };

        let strategy = format!(
            "{}-{}-{}",
            if window_mode == WindowMode::Layer { "layer" } else { "toplevel" },
            if lifecycle == Lifecycle::Keep { "keep" } else { "hideshow" },
            if dom_mode == DomMode::Cold { "cold" } else { "warm" },
        );
        eprintln!("[lab] стратегия: {strategy}");

        Self {
            metrics: Metrics::new(std::env::var("LAB_METRICS").ok(), strategy),
            window_mode,
            lifecycle,
            dom_mode,
        }
    }
}

#[tauri::command]
fn lab_log(message: String) {
    eprintln!("[js] {message}");
}

#[tauri::command]
fn lab_config(lab: tauri::State<'_, Arc<Lab>>) -> &'static str {
    eprintln!("[lab] фронтенд запросил конфигурацию");
    match lab.dom_mode {
        DomMode::Warm => "warm",
        DomMode::Cold => "cold",
    }
}

#[tauri::command]
fn lab_frame(id: u64, lab: tauri::State<'_, Arc<Lab>>) {
    lab.metrics.mark(id, |trial| {
        trial.t3_frame.get_or_insert(now_ns());
    });
}

#[tauri::command]
fn lab_dom_focus(id: u64, lab: tauri::State<'_, Arc<Lab>>) {
    lab.metrics.mark(id, |trial| {
        trial.t4_dom_focus.get_or_insert(now_ns());
    });
}

#[tauri::command]
fn lab_input(id: u64, value: String, lab: tauri::State<'_, Arc<Lab>>) {
    lab.metrics.mark(id, |trial| {
        if !value.is_empty() {
            trial.t5_first_char.get_or_insert(now_ns());
        }
        trial.value = value;
    });
}

fn show(app: &AppHandle, lab: &Lab, id: u64) {
    let Some(window) = app.get_webview_window(WINDOW) else { return };
    lab.metrics.mark(id, |trial| trial.t2_show = Some(now_ns()));

    if lab.lifecycle == Lifecycle::HideShow {
        let _ = window.show();
    }

    #[cfg(all(target_os = "linux", feature = "layer"))]
    if lab.window_mode == WindowMode::Layer {
        if let Ok(gtk_window) = window.gtk_window() {
            layer::set_keyboard(&gtk_window, true);
        }
    }

    let _ = window.set_focus();
    if let Err(error) = window.emit("lab://show", id) {
        eprintln!("[lab] emit show не прошёл: {error}");
    }
}

fn hide(app: &AppHandle, lab: &Lab) {
    let Some(window) = app.get_webview_window(WINDOW) else { return };
    let _ = window.emit("lab://hide", ());

    #[cfg(all(target_os = "linux", feature = "layer"))]
    if lab.window_mode == WindowMode::Layer {
        if let Ok(gtk_window) = window.gtk_window() {
            layer::set_keyboard(&gtk_window, false);
        }
    }

    if lab.lifecycle == Lifecycle::HideShow {
        let _ = window.hide();
    }
}

fn main() {
    let lab = Arc::new(Lab::from_env());

    tauri::Builder::default()
        .manage(lab.clone())
        .setup({
            let lab = lab.clone();
            move |app| {
                let handle = app.handle().clone();
                let window = app.get_webview_window(WINDOW).expect("окно main не найдено");

                #[cfg(all(target_os = "linux", feature = "layer"))]
                if lab.window_mode == WindowMode::Layer {
                    if !layer::is_supported() {
                        eprintln!(
                            "[lab] zwlr_layer_shell_v1 недоступен (GNOME?) — остаюсь обычным окном"
                        );
                    } else {
                        let gtk_window = window.gtk_window().expect("нет GTK-окна");
                        layer::attach_bottom(&gtk_window, 80);
                        eprintln!("[lab] layer-shell применён: overlay, anchor bottom");
                    }
                }

                #[cfg(not(all(target_os = "linux", feature = "layer")))]
                if lab.window_mode == WindowMode::Layer {
                    eprintln!("[lab] собрано без feature `layer` — LAB_WINDOW=layer игнорируется");
                }

                // Режим keep: поверхность живёт с самого старта, гасится только содержимое.
                if lab.lifecycle == Lifecycle::Keep {
                    let _ = window.show();
                    let _ = window.emit("lab://hide", ());
                }

                // Прогрев: первые вызовы после старта процесса стабильно медленнее
                // остальных. Прогоняем их сами, до того как пользователь нажмёт хоткей.
                let warmup: u32 = std::env::var("LAB_WARMUP")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                if warmup > 0 {
                    let warm_handle = handle.clone();
                    let warm_lab = lab.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(400));
                        for _ in 0..warmup {
                            let handle = warm_handle.clone();
                            let lab = warm_lab.clone();
                            let _ = warm_handle
                                .run_on_main_thread(move || show(&handle, &lab, 0));
                            std::thread::sleep(std::time::Duration::from_millis(250));
                            let handle = warm_handle.clone();
                            let lab = warm_lab.clone();
                            let _ = warm_handle.run_on_main_thread(move || hide(&handle, &lab));
                            std::thread::sleep(std::time::Duration::from_millis(250));
                        }
                        eprintln!("[lab] прогрев завершён: {warmup} цикл(ов)");
                    });
                }

                let ipc_handle = handle.clone();
                let ipc_lab = lab.clone();
                ipc::serve(move |line| {
                    let mut parts = line.split_whitespace();
                    match parts.next() {
                        Some("show") => {
                            let id: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                            let t0: u128 =
                                parts.next().and_then(|v| v.parse().ok()).unwrap_or_else(now_ns);
                            ipc_lab.metrics.start(id, t0);

                            let handle = ipc_handle.clone();
                            let lab = ipc_lab.clone();
                            let _ = ipc_handle
                                .run_on_main_thread(move || show(&handle, &lab, id));
                            String::from("queued")
                        }
                        Some("hide") => {
                            let handle = ipc_handle.clone();
                            let lab = ipc_lab.clone();
                            let _ = ipc_handle.run_on_main_thread(move || hide(&handle, &lab));
                            String::from("ok")
                        }
                        Some("result") => {
                            let id: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                            let sent: usize =
                                parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                            ipc_lab.metrics.write_row(id, sent);
                            match ipc_lab.metrics.get(id) {
                                Some(trial) => serde_json::to_string(&trial)
                                    .unwrap_or_else(|_| String::from("{}")),
                                None => String::from("{}"),
                            }
                        }
                        Some("ping") => String::from("pong"),
                        Some("quit") => {
                            let handle = ipc_handle.clone();
                            let _ = ipc_handle.run_on_main_thread(move || handle.exit(0));
                            String::from("bye")
                        }
                        _ => String::from("unknown"),
                    }
                })?;

                eprintln!("[lab] сокет: {}", ipc::socket_path().display());
                Ok(())
            }
        })
        .on_window_event({
            let lab = lab.clone();
            move |_window, event| {
                if let WindowEvent::Focused(true) = event {
                    lab.metrics.mark_latest(|trial| {
                        trial.t4_os_focus.get_or_insert(now_ns());
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            lab_log,
            lab_config,
            lab_frame,
            lab_dom_focus,
            lab_input
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска приложения");
}
