//! Micro Card — card-style knowledge capture backed by an Obsidian vault.

mod commands;
mod error;
mod markdown;
mod model;
mod state;
mod vault;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let state = AppState::load(data_dir);
            // Warm the cache so the first screen paints with real content.
            let _ = state.refresh();
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::refresh_library,
            commands::get_settings,
            commands::update_settings,
            commands::detect_vaults,
            commands::set_vault,
            commands::use_local_vault,
            commands::move_local_cards_to_vault,
            commands::save_card,
            commands::delete_card,
            commands::restore_card,
            commands::due_cards,
            commands::grade_card,
            commands::obsidian_uri,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Micro Card");
}
