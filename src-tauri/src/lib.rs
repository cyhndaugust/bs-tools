mod commands;
mod db;

use commands::diff::compute_diff;
use commands::menu_parser::parse_menu_json;
use commands::qrcode::{delete_qr_history, generate_qrcode, get_qr_history};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let db_state = db::init_db(app.handle())?;
            app.manage(db_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_qrcode,
            get_qr_history,
            delete_qr_history,
            parse_menu_json,
            compute_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
