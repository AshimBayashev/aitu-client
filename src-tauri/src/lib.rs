mod aitu;
mod proto;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

static QUITTING: AtomicBool = AtomicBool::new(false);

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app(app: &tauri::AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Aitu здорового человека")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main(tray.app_handle()),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(aitu::AituState::new())
        .invoke_handler(tauri::generate_handler![
            aitu::session_status,
            aitu::begin_login,
            aitu::logout,
            aitu::list_dialogs,
            aitu::list_history,
            aitu::send_message,
            aitu::send_voice,
            aitu::open_attachment,
            aitu::mark_read,
            aitu::set_active_chat,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            app.state::<aitu::AituState>().load(app.handle());
            let handle = app.handle().clone();
            app.notification().on_action(move |performed| {
                let chat_id = performed
                    .notification()
                    .and_then(|item| item.extra().get("chatId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                show_main(&handle);
                if let Some(chat_id) = chat_id {
                    let _ = handle.emit("aitu-open-chat", serde_json::json!({ "chatId": chat_id }));
                }
            })?;
            setup_tray(app)?;
            aitu::start_message_watch(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
