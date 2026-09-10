//! Every command the UI can call. Commands are deliberately coarse: the UI
//! asks for "the library" or "save this", never for individual file paths.

use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{Error, Result};
use crate::markdown;
use crate::model::{
    self, Card, CardDraft, CardKind, Grade, Review, Settings, Stats, VaultCandidate,
};
use crate::state::AppState;
use crate::vault::{self, Vault};

/// Everything the home screen needs, in one round trip.
#[derive(Debug, Serialize)]
pub struct Library {
    pub cards: Vec<Card>,
    pub stats: Stats,
    pub settings: Settings,
    /// Absolute path currently in use, shown in Settings so people can find
    /// their files with a file manager.
    pub vault_root: String,
    pub local_mode: bool,
}

fn library(state: &AppState) -> Result<Library> {
    let settings = state.settings_snapshot();
    let vault = state.vault()?;
    Ok(Library {
        cards: state.cards_snapshot(),
        stats: state.stats(),
        local_mode: settings.vault_path.is_none(),
        settings,
        vault_root: vault.cards_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_library(state: State<'_, AppState>) -> Result<Library> {
    state.refresh()?;
    library(&state)
}

/// Cheap re-read used when the app comes back to the foreground: if somebody
/// edited a card in Obsidian, this is when it shows up.
#[tauri::command]
pub fn refresh_library(state: State<'_, AppState>) -> Result<Library> {
    state.refresh()?;
    library(&state)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings_snapshot()
}

/// Partial settings update — the UI only sends what changed.
#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub default_tag: Option<String>,
    #[serde(default)]
    pub onboarded: Option<bool>,
    #[serde(default)]
    pub dark_mode: Option<bool>,
    #[serde(default)]
    pub daily_goal: Option<u32>,
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, patch: SettingsPatch) -> Result<Library> {
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| Error::msg("Settings are busy, try again."))?;
        if let Some(folder) = patch.folder {
            settings.folder = folder.trim().trim_matches('/').to_string();
        }
        if let Some(tag) = patch.default_tag {
            settings.default_tag = markdown::normalize_tag(&tag);
        }
        if let Some(v) = patch.onboarded {
            settings.onboarded = v;
        }
        if let Some(v) = patch.dark_mode {
            settings.dark_mode = v;
        }
        if let Some(v) = patch.daily_goal {
            settings.daily_goal = v.clamp(1, 500);
        }
        state.save_settings(&settings)?;
    }
    state.refresh()?;
    library(&state)
}

/// Search the device for Obsidian vaults so setup is a tap, not a file path.
#[tauri::command]
pub fn detect_vaults() -> Vec<VaultCandidate> {
    vault::find_vaults(&candidate_roots(), 4)
}

/// Places an Obsidian vault plausibly lives, per platform.
fn candidate_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "android")]
    {
        for base in [
            "/storage/emulated/0",
            "/storage/emulated/0/Documents",
            "/storage/emulated/0/Download",
            "/storage/emulated/0/Obsidian",
            "/sdcard",
        ] {
            roots.push(PathBuf::from(base));
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let home = PathBuf::from(home);
            for sub in ["", "Documents", "Notes", "Obsidian", "Dropbox", "Nextcloud"] {
                roots.push(if sub.is_empty() {
                    home.clone()
                } else {
                    home.join(sub)
                });
            }
        }
    }

    roots.retain(|p| p.exists());
    roots
}

#[derive(Debug, Deserialize)]
pub struct VaultChoice {
    pub path: String,
    #[serde(default)]
    pub folder: Option<String>,
}

/// Point the app at a vault folder. Fails loudly (and reversibly) if the
/// folder cannot be written, which on Android usually means the storage
/// permission has not been granted yet.
#[tauri::command]
pub fn set_vault(state: State<'_, AppState>, choice: VaultChoice) -> Result<Library> {
    apply_vault(&state, choice)?;
    state.refresh()?;
    library(&state)
}

fn apply_vault(state: &AppState, choice: VaultChoice) -> Result<()> {
    let root = PathBuf::from(choice.path.trim());
    if !root.exists() {
        return Err(Error::msg(format!(
            "That folder does not exist: {}",
            root.display()
        )));
    }
    if !root.is_dir() {
        return Err(Error::msg("Pick a folder, not a file."));
    }

    let previous = state.settings_snapshot();
    let folder = choice
        .folder
        .map(|f| f.trim().trim_matches('/').to_string())
        .unwrap_or(previous.folder.clone());

    let probe = Vault::new(root.clone(), &folder);
    probe.check_writable().map_err(|_| {
        Error::msg(
            "That folder is not writable. On Android, grant \"All files access\" \
             in system settings, or pick a folder inside your vault.",
        )
    })?;

    let mut settings = state
        .settings
        .write()
        .map_err(|_| Error::msg("Settings are busy, try again."))?;
    settings.vault_path = Some(root.to_string_lossy().to_string());
    settings.folder = folder;
    settings.onboarded = true;
    state.save_settings(&settings)
}

/// Start capturing straight away, without choosing a vault. Files land in the
/// app's own folder and can be connected to a vault later without data loss.
#[tauri::command]
pub fn use_local_vault(state: State<'_, AppState>) -> Result<Library> {
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| Error::msg("Settings are busy, try again."))?;
        settings.vault_path = None;
        settings.onboarded = true;
        state.save_settings(&settings)?;
    }
    state.refresh()?;
    library(&state)
}

/// Copy every local-mode card into a real vault, then switch to it. This is
/// the upgrade path for people who try the app first and install Obsidian later.
#[tauri::command]
pub fn move_local_cards_to_vault(
    state: State<'_, AppState>,
    choice: VaultChoice,
) -> Result<Library> {
    let settings = state.settings_snapshot();
    let local = Vault::new(state.local_vault_path(), &settings.folder);
    let pending = local.scan().unwrap_or_default();

    apply_vault(&state, choice)?;

    let target = state.vault()?;
    for mut card in pending {
        let source_path = card.path.clone();
        // Clear the path so the card is written fresh into the new vault.
        card.path = String::new();
        if target.save(&mut card).is_ok() {
            let _ = local.trash(&source_path);
        }
    }
    state.refresh()?;
    library(&state)
}

#[tauri::command]
pub fn save_card(state: State<'_, AppState>, draft: CardDraft) -> Result<Card> {
    save_draft(&state, draft)
}

/// The body of [`save_card`], callable without a Tauri handle so the whole
/// capture path can be covered by tests.
pub fn save_draft(state: &AppState, draft: CardDraft) -> Result<Card> {
    if draft.front.trim().is_empty() {
        return Err(Error::msg("A card needs some text."));
    }
    let settings = state.settings_snapshot();
    let vault = state.vault()?;
    let now = model::now();

    let existing = draft
        .id
        .as_ref()
        .and_then(|id| state.cards_snapshot().into_iter().find(|c| &c.id == id));

    let kind = draft
        .kind
        .as_deref()
        .map(CardKind::parse)
        .or_else(|| existing.as_ref().map(|c| c.kind))
        .unwrap_or_else(|| {
            // Text with a back side is a flashcard; anything else is a note.
            match draft.back.as_deref() {
                Some(b) if !b.trim().is_empty() => CardKind::Qa,
                _ => CardKind::Note,
            }
        });

    let mut tags = draft
        .tags
        .clone()
        .or_else(|| existing.as_ref().map(|c| c.tags.clone()))
        .unwrap_or_default()
        .iter()
        .map(|t| markdown::normalize_tag(t))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>();
    let default_tag = markdown::normalize_tag(&settings.default_tag);
    if !default_tag.is_empty() && !tags.iter().any(|t| t.eq_ignore_ascii_case(&default_tag)) {
        tags.push(default_tag);
    }
    tags.dedup();

    let title = draft
        .title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| markdown::title_from_text(&draft.front));

    let back = draft
        .back
        .clone()
        .or_else(|| existing.as_ref().map(|c| c.back.clone()))
        .unwrap_or_default();

    let mut card = Card {
        id: existing
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(vault::new_id),
        kind,
        title,
        front: draft.front.trim().to_string(),
        back: back.trim().to_string(),
        tags,
        deck: draft
            .deck
            .clone()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
            .or_else(|| existing.as_ref().and_then(|c| c.deck.clone())),
        created: existing.as_ref().map(|c| c.created).unwrap_or(now),
        updated: now,
        starred: draft
            .starred
            .or_else(|| existing.as_ref().map(|c| c.starred))
            .unwrap_or(false),
        review: existing
            .as_ref()
            .map(|c| c.review.clone())
            .unwrap_or_else(|| Review {
                due: now,
                ..Review::default()
            }),
        path: existing
            .as_ref()
            .map(|c| c.path.clone())
            .unwrap_or_default(),
        links: markdown::wikilinks(&draft.front),
    };

    vault.save(&mut card)?;

    if existing.is_none() {
        if let Ok(mut journal) = state.journal.write() {
            journal.record_capture();
        }
        let _ = state.save_journal();
    }

    state.refresh()?;
    Ok(card)
}

#[derive(Debug, Serialize)]
pub struct Deleted {
    pub id: String,
    /// Where the file went, so "Undo" can put it back.
    pub trashed_path: String,
}

#[tauri::command]
pub fn delete_card(state: State<'_, AppState>, id: String) -> Result<Deleted> {
    remove_card(&state, id)
}

pub fn remove_card(state: &AppState, id: String) -> Result<Deleted> {
    let card = state
        .cards_snapshot()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| Error::NotFound(id.clone()))?;
    let trashed_path = state.vault()?.trash(&card.path)?;
    state.refresh()?;
    Ok(Deleted { id, trashed_path })
}

#[tauri::command]
pub fn restore_card(state: State<'_, AppState>, trashed_path: String) -> Result<Library> {
    state.vault()?.restore(&trashed_path)?;
    state.refresh()?;
    library(&state)
}

/// Cards due now, hardest-first so a short session covers the weakest material.
#[tauri::command]
pub fn due_cards(state: State<'_, AppState>, limit: Option<usize>) -> Vec<Card> {
    let now = Utc::now();
    let mut due: Vec<Card> = state
        .cards_snapshot()
        .into_iter()
        .filter(|c| c.is_due(now))
        .collect();
    due.sort_by(|a, b| {
        b.review
            .lapses
            .cmp(&a.review.lapses)
            .then(a.review.due.cmp(&b.review.due))
    });
    due.truncate(limit.unwrap_or(50));
    due
}

#[tauri::command]
pub fn grade_card(state: State<'_, AppState>, id: String, grade: Grade) -> Result<Card> {
    apply_grade(&state, id, grade)
}

pub fn apply_grade(state: &AppState, id: String, grade: Grade) -> Result<Card> {
    let mut card = state
        .cards_snapshot()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(Error::NotFound(id))?;
    let now = model::now();
    card.review = card.review.grade(grade, now);
    card.updated = now;
    state.vault()?.save(&mut card)?;

    if let Ok(mut journal) = state.journal.write() {
        journal.record_review();
    }
    let _ = state.save_journal();
    state.refresh()?;
    Ok(card)
}

/// The `obsidian://` URL that opens this exact note in Obsidian.
#[tauri::command]
pub fn obsidian_uri(state: State<'_, AppState>, id: String) -> Result<String> {
    let settings = state.settings_snapshot();
    let root = settings
        .vault_path
        .clone()
        .ok_or_else(|| Error::msg("Connect a vault first to open cards in Obsidian."))?;
    let card = state
        .cards_snapshot()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(Error::NotFound(id))?;
    let vault_name = PathBuf::from(&root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(format!(
        "obsidian://open?vault={}&file={}",
        urlencode(&vault_name),
        urlencode(card.path.trim_end_matches(".md"))
    ))
}

fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::new_id;

    #[test]
    fn urlencodes_spaces_and_slashes_for_obsidian_links() {
        assert_eq!(urlencode("My Vault/Cards"), "My%20Vault%2FCards");
    }

    /// A state backed by a throwaway vault, standing in for a real install.
    fn scratch_state() -> AppState {
        let dir = std::env::temp_dir().join(format!("micro-card-cmd-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState::load(dir);
        state.refresh().unwrap();
        state
    }

    fn draft(front: &str) -> CardDraft {
        serde_json::from_value(serde_json::json!({ "front": front })).unwrap()
    }

    #[test]
    fn a_bare_line_of_text_is_enough_to_make_a_card() {
        let state = scratch_state();
        let card = save_draft(&state, draft("Remember to water the plants")).unwrap();

        assert_eq!(card.kind, CardKind::Note);
        assert_eq!(card.title, "Remember to water the plants");
        // The default tag is what makes cards findable in Obsidian search.
        assert!(card.tags.contains(&"card".to_string()));
        assert!(card.path.ends_with(".md"), "written to {}", card.path);
        assert_eq!(state.cards_snapshot().len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn text_with_an_answer_becomes_a_reviewable_card() {
        let state = scratch_state();
        let mut d = draft("What is the capital of France?");
        d.back = Some("Paris".into());
        let card = save_draft(&state, d).unwrap();

        assert_eq!(card.kind, CardKind::Qa);
        assert!(
            card.is_due(Utc::now()),
            "a new Q & A card is due immediately"
        );
        assert_eq!(due_cards_from(&state).len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    fn due_cards_from(state: &AppState) -> Vec<Card> {
        let now = Utc::now();
        state
            .cards_snapshot()
            .into_iter()
            .filter(|c| c.is_due(now))
            .collect()
    }

    #[test]
    fn grading_a_card_pushes_it_out_of_the_queue_and_survives_a_rescan() {
        let state = scratch_state();
        let mut d = draft("2 + 2?");
        d.back = Some("4".into());
        let card = save_draft(&state, d).unwrap();

        let graded = apply_grade(&state, card.id.clone(), Grade::Good).unwrap();
        assert_eq!(graded.review.reps, 1);
        assert!(!graded.is_due(Utc::now()));
        assert!(due_cards_from(&state).is_empty());

        // The schedule lives in the file, not in memory.
        state.refresh().unwrap();
        let reloaded = state
            .cards_snapshot()
            .into_iter()
            .find(|c| c.id == card.id)
            .expect("card still in the vault");
        assert_eq!(reloaded.review.reps, 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn editing_a_card_keeps_its_identity_and_creation_date() {
        let state = scratch_state();
        let card = save_draft(&state, draft("First wording")).unwrap();

        let edit: CardDraft = serde_json::from_value(serde_json::json!({
            "id": card.id,
            "front": "Second wording",
        }))
        .unwrap();
        let updated = save_draft(&state, edit).unwrap();

        assert_eq!(updated.id, card.id);
        assert_eq!(updated.created, card.created);
        assert_eq!(updated.title, "Second wording");
        assert_eq!(
            state.cards_snapshot().len(),
            1,
            "editing must not duplicate"
        );
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn deleting_a_card_can_be_undone() {
        let state = scratch_state();
        let card = save_draft(&state, draft("Regrettable deletion")).unwrap();

        let deleted = remove_card(&state, card.id.clone()).unwrap();
        assert!(state.cards_snapshot().is_empty());

        state
            .vault()
            .unwrap()
            .restore(&deleted.trashed_path)
            .unwrap();
        state.refresh().unwrap();
        assert_eq!(state.cards_snapshot().len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn an_empty_card_is_refused_with_a_sentence_a_user_can_read() {
        let state = scratch_state();
        let err = save_draft(&state, draft("   ")).unwrap_err();
        assert_eq!(err.to_string(), "A card needs some text.");
        std::fs::remove_dir_all(&state.data_dir).ok();
    }
}
