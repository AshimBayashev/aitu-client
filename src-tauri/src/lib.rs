mod aitu;
mod proto;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(aitu::AituState::new())
        .invoke_handler(tauri::generate_handler![
            aitu::session_status,
            aitu::begin_login,
            aitu::logout,
            aitu::list_dialogs,
            aitu::list_history,
            aitu::send_message,
            aitu::mark_read,
        ])
        .setup(|app| {
            app.state::<aitu::AituState>().load(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
