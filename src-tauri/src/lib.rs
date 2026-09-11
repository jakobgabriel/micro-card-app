//! Micro Card — card-style knowledge capture backed by an Obsidian vault.

mod commands;
mod error;
mod github;
mod markdown;
mod model;
mod state;
mod sync;
mod vault;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
            commands::github_status,
            commands::github_connect,
            commands::github_disconnect,
            commands::sync_now,
            commands::rename_tag,
            commands::rename_deck,
            commands::bulk_edit,
            commands::bulk_delete,
            commands::restore_many,
            commands::review_session,
            commands::restore_review,
            commands::find_similar,
            commands::import_text,
            commands::export_markdown,
            commands::write_text_file,
            commands::read_text_file,
            commands::add_sample_cards,
            commands::list_trash,
            commands::delete_forever,
            commands::empty_trash,
            commands::take_shared_text,
            commands::export_cards,
            commands::merge_cards,
            commands::resurfaced_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Micro Card");
}
