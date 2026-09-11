//! Every command the UI can call. Commands are deliberately coarse: the UI
//! asks for "the library" or "save this", never for individual file paths.

use std::path::PathBuf;

use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{Error, Result};
use crate::github::{GitHub, RepoConfig, RepoInfo};
use crate::markdown;
use crate::model::{
    self, Card, CardDraft, CardKind, Grade, Review, Settings, Stats, Theme, TrashedCard,
    VaultCandidate,
};
use crate::state::AppState;
use crate::sync::{self, SyncReport};
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
    pub theme: Option<String>,
    #[serde(default)]
    pub text_scale: Option<f32>,
    #[serde(default)]
    pub daily_goal: Option<u32>,
    #[serde(default)]
    pub session_size: Option<u32>,
    /// `Some(None)` turns the reminder off; `Some(Some(h))` sets the hour.
    #[serde(default, deserialize_with = "double_option")]
    pub reminder_hour: Option<Option<u32>>,
    #[serde(default)]
    pub github_auto_sync: Option<bool>,
}

/// Lets the UI distinguish "leave this alone" from "clear this".
fn double_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
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
        if let Some(theme) = patch.theme {
            settings.theme = match theme.as_str() {
                "light" => Theme::Light,
                "dark" => Theme::Dark,
                _ => Theme::System,
            };
        }
        if let Some(scale) = patch.text_scale {
            settings.text_scale = scale.clamp(0.85, 1.4);
        }
        if let Some(size) = patch.session_size {
            settings.session_size = size.clamp(5, 200);
        }
        if let Some(hour) = patch.reminder_hour {
            settings.reminder_hour = hour.map(|h| h.min(23));
        }
        if let Some(auto) = patch.github_auto_sync {
            settings.github_auto_sync = auto;
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
    fn renaming_a_tag_updates_the_frontmatter_and_the_text() {
        let state = scratch_state();
        let mut d = draft("A note about #physics and waves");
        d.tags = Some(vec!["physics".into()]);
        save_draft(&state, d).unwrap();

        let result = rename_tag_inner(&state, "physics", "optics").unwrap();

        assert_eq!(result.changed, 1);
        let card = &state.cards_snapshot()[0];
        assert!(card.tags.iter().any(|t| t == "optics"), "{:?}", card.tags);
        assert!(!card.tags.iter().any(|t| t == "physics"));
        assert!(card.front.contains("#optics"), "{}", card.front);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn renaming_a_tag_leaves_lookalike_words_alone() {
        assert_eq!(
            replace_inline_tag("#physics and #physics-lab", "physics", "optics"),
            "#optics and #physics-lab"
        );
        assert_eq!(
            replace_inline_tag("costs $5#physics", "physics", "x"),
            "costs $5#physics"
        );
    }

    #[test]
    fn pasted_lines_become_cards_and_pairs_become_flashcards() {
        let state = scratch_state();
        let request = ImportRequest {
            text: "Bonjour\tHello\nMerci :: Thank you\nJust a plain note".to_string(),
            split: None,
            kind: None,
            deck: Some("French".into()),
            tags: Some(vec!["language".into()]),
        };

        let result = import_text_inner(&state, request).unwrap();

        assert_eq!(result.created, 3);
        let cards = state.cards_snapshot();
        let bonjour = cards.iter().find(|c| c.front == "Bonjour").unwrap();
        assert_eq!(bonjour.kind, CardKind::Qa);
        assert_eq!(bonjour.back, "Hello");
        assert_eq!(bonjour.deck.as_deref(), Some("French"));
        let plain = cards
            .iter()
            .find(|c| c.front == "Just a plain note")
            .unwrap();
        assert_eq!(plain.kind, CardKind::Note);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn near_duplicates_are_flagged_but_unrelated_cards_are_not() {
        let state = scratch_state();
        save_draft(
            &state,
            draft("Spaced repetition schedules reviews before forgetting"),
        )
        .unwrap();
        save_draft(&state, draft("Sourdough needs a warm kitchen overnight")).unwrap();

        let hits = find_similar_inner(
            &state,
            "Spaced repetition schedules reviews just before forgetting",
            None,
        );
        assert_eq!(hits.len(), 1);
        assert!(hits[0].title.starts_with("Spaced repetition"));

        assert!(find_similar_inner(&state, "Completely unrelated wording here", None).is_empty());
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn a_cram_session_studies_cards_that_are_not_due_yet() {
        let state = scratch_state();
        let mut d = draft("Q?");
        d.back = Some("A".into());
        let card = save_draft(&state, d).unwrap();
        apply_grade(&state, card.id.clone(), Grade::Easy).unwrap();

        let due_only = session_inner(&state, SessionRequest::default());
        assert!(due_only.is_empty(), "the card was just answered");

        let cram = session_inner(
            &state,
            SessionRequest {
                cram: true,
                ..Default::default()
            },
        );
        assert_eq!(cram.len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn undoing_a_review_restores_the_old_schedule() {
        let state = scratch_state();
        let mut d = draft("Q?");
        d.back = Some("A".into());
        let card = save_draft(&state, d).unwrap();
        let before = card.review.clone();

        apply_grade(&state, card.id.clone(), Grade::Good).unwrap();
        let restored = restore_review_inner(&state, card.id.clone(), before.clone()).unwrap();

        assert_eq!(restored.review.reps, before.reps);
        assert!(restored.is_due(Utc::now()), "the card is back in the queue");
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn merging_combines_tags_and_text_and_trashes_the_absorbed_cards() {
        let state = scratch_state();
        let mut first = draft("Spaced repetition works");
        first.tags = Some(vec!["memory".into()]);
        let keeper = save_draft(&state, first).unwrap();

        let mut second = draft("Reviews should get further apart each time");
        second.tags = Some(vec!["method".into()]);
        let other = save_draft(&state, second).unwrap();

        let result = merge_inner(&state, keeper.id.clone(), vec![other.id.clone()]).unwrap();

        assert!(result.card.front.contains("Spaced repetition works"));
        assert!(result.card.front.contains("further apart"));
        assert!(result.card.tags.iter().any(|t| t == "memory"));
        assert!(result.card.tags.iter().any(|t| t == "method"));
        assert_eq!(result.trashed.len(), 1);
        assert_eq!(state.cards_snapshot().len(), 1, "the absorbed card is gone");
        // Trashed, not destroyed: the merge is undoable.
        assert_eq!(state.vault().unwrap().list_trash().unwrap().len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn merging_identical_cards_does_not_say_everything_twice() {
        let state = scratch_state();
        let keeper = save_draft(&state, draft("The very same sentence")).unwrap();
        let twin = save_draft(&state, draft("The very same sentence")).unwrap();

        let result = merge_inner(&state, keeper.id.clone(), vec![twin.id]).unwrap();

        assert_eq!(result.card.front, "The very same sentence");
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn trashed_cards_can_be_listed_and_then_destroyed() {
        let state = scratch_state();
        let card = save_draft(&state, draft("Destined for the bin")).unwrap();
        remove_card(&state, card.id).unwrap();

        let vault = state.vault().unwrap();
        let trash = vault.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].title, "Destined for the bin");
        assert!(trash[0].path.starts_with(".trash/"));

        vault.delete_forever(&trash[0].path).unwrap();
        assert!(vault.list_trash().unwrap().is_empty());
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn a_live_card_can_never_be_destroyed_by_the_trash_command() {
        let state = scratch_state();
        let card = save_draft(&state, draft("Very much alive")).unwrap();

        let err = state
            .vault()
            .unwrap()
            .delete_forever(&card.path)
            .unwrap_err();

        assert!(err.to_string().contains("Only trashed cards"));
        assert_eq!(state.vault().unwrap().scan().unwrap().len(), 1);
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn exported_csv_quotes_commas_and_quotes_the_way_anki_expects() {
        assert_eq!(csv_field("plain"), "\"plain\"");
        assert_eq!(csv_field("with, comma"), "\"with, comma\"");
        assert_eq!(csv_field("he said \"hi\""), "\"he said \"\"hi\"\"\"");
    }

    #[test]
    fn exported_csv_has_a_header_and_one_row_per_card() {
        let state = scratch_state();
        let mut d = draft("Bonjour");
        d.back = Some("Hello".into());
        d.tags = Some(vec!["french".into()]);
        save_draft(&state, d).unwrap();

        let csv = export_csv(&state.cards_snapshot());
        let lines: Vec<&str> = csv.lines().collect();

        assert_eq!(lines[0], "front,back,tags");
        assert!(
            lines[1].starts_with("\"Bonjour\",\"Hello\""),
            "{}",
            lines[1]
        );
        assert!(lines[1].contains("french"));
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn shared_text_is_read_once_and_then_cleared() {
        let state = scratch_state();
        let path = state.data_dir.join("shared-capture.json");
        std::fs::write(
            &path,
            r#"{"text":"Something worth keeping","subject":"An article"}"#,
        )
        .unwrap();

        let shared = take_shared_inner(&state).expect("the shared text should arrive");
        assert_eq!(shared.text, "Something worth keeping");
        assert_eq!(shared.subject.as_deref(), Some("An article"));

        // Reading it must consume it, or the same text is captured twice.
        assert!(!path.exists());
        assert!(take_shared_inner(&state).is_none());
        std::fs::remove_dir_all(&state.data_dir).ok();
    }

    #[test]
    fn the_shared_file_is_looked_for_where_android_actually_writes_it() {
        let paths = shared_capture_paths(std::path::Path::new("/data/user/0/app/files"));
        assert!(paths
            .iter()
            .any(|p| p.ends_with("files/shared-capture.json")));
        assert!(paths
            .iter()
            .any(|p| p.ends_with("0/app/shared-capture.json")));
    }

    #[test]
    fn resurfacing_skips_fresh_cards_and_anything_already_due() {
        let state = scratch_state();
        save_draft(&state, draft("Captured just now")).unwrap();
        assert!(
            resurface_inner(&state).is_none(),
            "a card written moments ago is not a rediscovery"
        );
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

// ---------------------------------------------------------------------------
// GitHub repository sync
// ---------------------------------------------------------------------------

/// Run blocking network work on a plain OS thread.
///
/// `reqwest::blocking` builds and drops its own Tokio runtime internally, and
/// dropping a runtime inside Tauri's async context panics — including on
/// Tokio's blocking pool, where the runtime handle is still attached. A scoped
/// thread carries no runtime, so the client can be built, used and dropped
/// there safely, and the command simply waits for it.
fn off_runtime<T: Send>(work: impl FnOnce() -> Result<T> + Send) -> Result<T> {
    std::thread::scope(|scope| scope.spawn(work).join())
        .map_err(|_| Error::msg("The connection to GitHub stopped unexpectedly."))?
}

/// What the UI shows on the sync row without having to ask GitHub anything.
#[derive(Debug, Serialize)]
pub struct GithubStatus {
    pub connected: bool,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub auto_sync: bool,
    pub last_synced: Option<String>,
    pub last_commit: Option<String>,
    /// Cards tracked by the last sync, so "nothing there yet" is obvious.
    pub tracked_files: usize,
}

#[tauri::command]
pub fn github_status(state: State<'_, AppState>) -> GithubStatus {
    let settings = state.settings_snapshot();
    let sync_state = state.sync_state.read().ok();
    let connected = settings.github.is_some() && state.github_token().is_some();
    GithubStatus {
        connected,
        repo: settings
            .github
            .as_ref()
            .map(|g| format!("{}/{}", g.owner, g.repo)),
        branch: settings.github.as_ref().map(|g| g.branch.clone()),
        auto_sync: settings.github_auto_sync,
        last_synced: sync_state.as_ref().and_then(|s| s.last_synced.clone()),
        last_commit: sync_state.as_ref().and_then(|s| s.last_commit.clone()),
        tracked_files: sync_state.map(|s| s.base.len()).unwrap_or(0),
    }
}

#[derive(Debug, Deserialize)]
pub struct GithubConnection {
    pub token: String,
    /// `owner/repo`, a browser URL or a clone URL — all are accepted.
    pub repo: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

/// Check a token and repository, and remember them if they work. Nothing is
/// stored until GitHub has confirmed the repository can actually be written.
#[tauri::command(async)]
pub fn github_connect(
    state: State<'_, AppState>,
    connection: GithubConnection,
) -> Result<RepoInfo> {
    let token = connection.token.trim().to_string();
    if token.is_empty() {
        return Err(Error::msg("Paste a GitHub token to continue."));
    }
    let (owner, repo) = sync::parse_repo(&connection.repo)?;
    let folder = connection
        .folder
        .map(|f| f.trim().trim_matches('/').to_string())
        .unwrap_or_else(|| state.settings_snapshot().folder);

    let branch = connection
        .branch
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());

    // Probe with the repository's own default branch first, so a user who
    // never renamed `master` does not have to know that.
    let probe_config = RepoConfig {
        owner: owner.clone(),
        repo: repo.clone(),
        branch: branch.clone().unwrap_or_else(|| "main".to_string()),
    };
    let info = {
        let token = token.clone();
        let folder = folder.clone();
        off_runtime(move || GitHub::new(token, probe_config)?.probe(&folder))?
    };

    if !info.can_write {
        return Err(Error::msg(
            "That token can read the repository but not write to it. \
             Give it Contents: Read and write access.",
        ));
    }

    let chosen_branch = branch.unwrap_or_else(|| info.default_branch.clone());
    let config = RepoConfig {
        owner,
        repo,
        branch: chosen_branch,
    };
    // Re-probe on the branch actually chosen so the card count is honest.
    let info = {
        let token = token.clone();
        let folder = folder.clone();
        let config = config.clone();
        off_runtime(move || GitHub::new(token, config)?.probe(&folder))?
    };

    state.set_github_token(Some(&token))?;
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| Error::msg("Settings are busy, try again."))?;
        settings.github = Some(config);
        settings.folder = folder;
        settings.onboarded = true;
        state.save_settings(&settings)?;
    }
    Ok(info)
}

/// Forget the repository. Cards stay exactly where they are, on both sides.
#[tauri::command]
pub fn github_disconnect(state: State<'_, AppState>) -> Result<Library> {
    state.set_github_token(None)?;
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| Error::msg("Settings are busy, try again."))?;
        settings.github = None;
        state.save_settings(&settings)?;
    }
    if let Ok(mut sync_state) = state.sync_state.write() {
        *sync_state = Default::default();
    }
    let _ = state.save_sync_state();
    state.refresh()?;
    library(&state)
}

/// Pull, merge and push in one go. Safe to call when nothing changed.
#[tauri::command(async)]
pub fn sync_now(state: State<'_, AppState>) -> Result<SyncReport> {
    let settings = state.settings_snapshot();
    let config = settings
        .github
        .clone()
        .ok_or_else(|| Error::msg("No repository is connected yet."))?;
    let token = state
        .github_token()
        .ok_or_else(|| Error::msg("The GitHub token is missing. Connect the repository again."))?;

    let vault = state.vault()?;
    vault.ensure_dirs()?;
    let tree = sync::LocalTree::new(vault.cards_dir(), &settings.folder);

    let mut sync_state = state
        .sync_state
        .read()
        .map(|s| s.clone())
        .unwrap_or_default();
    let stamp = Local::now().format("%Y-%m-%d %H-%M").to_string();

    let (report, sync_state) = off_runtime(move || {
        let client = GitHub::new(token, config)?;
        let report = sync::sync(&tree, &client, &mut sync_state, &stamp)?;
        Ok((report, sync_state))
    })?;

    if let Ok(mut guard) = state.sync_state.write() {
        *guard = sync_state;
    }
    let _ = state.save_sync_state();
    state.refresh()?;
    Ok(report)
}

// ---------------------------------------------------------------------------
// Organising: tags, decks and bulk edits
// ---------------------------------------------------------------------------

/// How many cards a bulk operation touched.
#[derive(Debug, Serialize)]
pub struct BulkResult {
    pub changed: usize,
}

/// Rename a tag everywhere, or remove it when `to` is empty.
#[tauri::command]
pub fn rename_tag(state: State<'_, AppState>, from: String, to: String) -> Result<BulkResult> {
    rename_tag_inner(&state, &from, &to)
}

pub fn rename_tag_inner(state: &AppState, from: &str, to: &str) -> Result<BulkResult> {
    let from = markdown::normalize_tag(from);
    let to = markdown::normalize_tag(to);
    if from.is_empty() {
        return Err(Error::msg("Pick a tag to rename."));
    }
    let vault = state.vault()?;
    let now = model::now();
    let mut changed = 0;

    for mut card in state.cards_snapshot() {
        if !card.tags.iter().any(|t| t.eq_ignore_ascii_case(&from)) {
            continue;
        }
        // The tag may also be written inline in the text, where it is what the
        // user actually sees; rename it there too.
        card.front = replace_inline_tag(&card.front, &from, &to);
        card.back = replace_inline_tag(&card.back, &from, &to);
        card.tags.retain(|t| !t.eq_ignore_ascii_case(&from));
        if !to.is_empty() && !card.tags.iter().any(|t| t.eq_ignore_ascii_case(&to)) {
            card.tags.push(to.clone());
        }
        card.updated = now;
        vault.save(&mut card)?;
        changed += 1;
    }
    state.refresh()?;
    Ok(BulkResult { changed })
}

/// Replace `#old` with `#new` in body text, leaving other words alone.
fn replace_inline_tag(text: &str, from: &str, to: &str) -> String {
    let needle = format!("#{from}");
    let replacement = if to.is_empty() {
        String::new()
    } else {
        format!("#{to}")
    };
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.to_lowercase().find(&needle.to_lowercase()) {
        let (before, tail) = rest.split_at(idx);
        let after = &tail[needle.len()..];
        let boundary_before = before.is_empty() || before.ends_with(char::is_whitespace);
        let boundary_after = after
            .chars()
            .next()
            .map(|c| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '/'))
            .unwrap_or(true);
        out.push_str(before);
        if boundary_before && boundary_after {
            out.push_str(&replacement);
        } else {
            out.push_str(&tail[..needle.len()]);
        }
        rest = after;
    }
    out.push_str(rest);
    // Removing a tag can leave a double space behind.
    out.replace("  ", " ").trim_end().to_string()
}

/// Rename a deck, moving every card in it.
#[tauri::command]
pub fn rename_deck(state: State<'_, AppState>, from: String, to: String) -> Result<BulkResult> {
    let from = from.trim().to_string();
    let to = to.trim().to_string();
    let vault = state.vault()?;
    let now = model::now();
    let mut changed = 0;

    for mut card in state.cards_snapshot() {
        let current = card.deck.clone().unwrap_or_else(|| "Inbox".to_string());
        if current != from {
            continue;
        }
        card.deck = (!to.is_empty() && to != "Inbox").then(|| to.clone());
        card.updated = now;
        vault.save(&mut card)?;
        changed += 1;
    }
    state.refresh()?;
    Ok(BulkResult { changed })
}

/// Edits applied to several cards at once from the library's selection mode.
#[derive(Debug, Deserialize)]
pub struct BulkEdit {
    pub ids: Vec<String>,
    #[serde(default)]
    pub add_tags: Option<Vec<String>>,
    #[serde(default)]
    pub remove_tags: Option<Vec<String>>,
    #[serde(default)]
    pub deck: Option<String>,
    #[serde(default)]
    pub starred: Option<bool>,
}

#[tauri::command]
pub fn bulk_edit(state: State<'_, AppState>, edit: BulkEdit) -> Result<BulkResult> {
    let vault = state.vault()?;
    let now = model::now();
    let mut changed = 0;

    for mut card in state.cards_snapshot() {
        if !edit.ids.contains(&card.id) {
            continue;
        }
        if let Some(add) = &edit.add_tags {
            for tag in add.iter().map(|t| markdown::normalize_tag(t)) {
                if !tag.is_empty() && !card.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                    card.tags.push(tag);
                }
            }
        }
        if let Some(remove) = &edit.remove_tags {
            for tag in remove.iter().map(|t| markdown::normalize_tag(t)) {
                card.tags.retain(|t| !t.eq_ignore_ascii_case(&tag));
            }
        }
        if let Some(deck) = &edit.deck {
            let deck = deck.trim();
            card.deck = (!deck.is_empty() && deck != "Inbox").then(|| deck.to_string());
        }
        if let Some(starred) = edit.starred {
            card.starred = starred;
        }
        card.updated = now;
        vault.save(&mut card)?;
        changed += 1;
    }
    state.refresh()?;
    Ok(BulkResult { changed })
}

/// Delete several cards, returning where each went so the whole batch can be
/// undone from one toast.
#[tauri::command]
pub fn bulk_delete(state: State<'_, AppState>, ids: Vec<String>) -> Result<Vec<Deleted>> {
    let vault = state.vault()?;
    let mut deleted = Vec::new();
    for card in state.cards_snapshot() {
        if !ids.contains(&card.id) {
            continue;
        }
        if let Ok(trashed_path) = vault.trash(&card.path) {
            deleted.push(Deleted {
                id: card.id,
                trashed_path,
            });
        }
    }
    state.refresh()?;
    Ok(deleted)
}

#[tauri::command]
pub fn restore_many(state: State<'_, AppState>, paths: Vec<String>) -> Result<Library> {
    let vault = state.vault()?;
    for path in paths {
        let _ = vault.restore(&path);
    }
    state.refresh()?;
    library(&state)
}

// ---------------------------------------------------------------------------
// Review sessions
// ---------------------------------------------------------------------------

/// Which cards a review session should contain.
#[derive(Debug, Default, Deserialize)]
pub struct SessionRequest {
    #[serde(default)]
    pub deck: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    /// Ignore the schedule and study everything that matches — the "I have an
    /// exam tomorrow" mode.
    #[serde(default)]
    pub cram: bool,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[tauri::command]
pub fn review_session(state: State<'_, AppState>, request: SessionRequest) -> Vec<Card> {
    session_inner(&state, request)
}

pub fn session_inner(state: &AppState, request: SessionRequest) -> Vec<Card> {
    let settings = state.settings_snapshot();
    let now = Utc::now();
    let mut cards: Vec<Card> = state
        .cards_snapshot()
        .into_iter()
        .filter(|c| c.kind.reviewable())
        .filter(|c| request.cram || c.is_due(now))
        .filter(|c| match &request.deck {
            Some(deck) => c.deck.clone().unwrap_or_else(|| "Inbox".into()) == *deck,
            None => true,
        })
        .filter(|c| match &request.tag {
            Some(tag) => c.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)),
            None => true,
        })
        .collect();

    // Hardest first: the cards that have been forgotten most often are the
    // ones a short session should spend its time on.
    cards.sort_by(|a, b| {
        b.review
            .lapses
            .cmp(&a.review.lapses)
            .then(a.review.due.cmp(&b.review.due))
    });
    cards.truncate(
        request
            .limit
            .unwrap_or(settings.session_size as usize)
            .max(1),
    );
    cards
}

/// Put a card's schedule back the way it was — the undo for a mis-tap during
/// review, where the wrong button costs real work.
#[tauri::command]
pub fn restore_review(state: State<'_, AppState>, id: String, review: Review) -> Result<Card> {
    restore_review_inner(&state, id, review)
}

pub fn restore_review_inner(state: &AppState, id: String, review: Review) -> Result<Card> {
    let mut card = state
        .cards_snapshot()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(Error::NotFound(id))?;
    card.review = review;
    card.updated = model::now();
    state.vault()?.save(&mut card)?;
    if let Ok(mut journal) = state.journal.write() {
        journal.undo_review();
    }
    let _ = state.save_journal();
    state.refresh()?;
    Ok(card)
}

// ---------------------------------------------------------------------------
// Import, export and duplicate detection
// ---------------------------------------------------------------------------

/// A card that looks like the one being written, so the same note is not
/// captured twice without the user noticing.
#[derive(Debug, Serialize)]
pub struct Similar {
    pub id: String,
    pub title: String,
    /// 0.0–1.0 word overlap.
    pub score: f32,
}

#[tauri::command]
pub fn find_similar(
    state: State<'_, AppState>,
    text: String,
    exclude: Option<String>,
) -> Vec<Similar> {
    find_similar_inner(&state, &text, exclude)
}

pub fn find_similar_inner(state: &AppState, text: &str, exclude: Option<String>) -> Vec<Similar> {
    let words = word_set(text);
    if words.len() < 3 {
        return Vec::new();
    }
    let mut matches: Vec<Similar> = state
        .cards_snapshot()
        .into_iter()
        .filter(|c| Some(&c.id) != exclude.as_ref())
        .filter_map(|card| {
            let other = word_set(&format!("{} {}", card.front, card.back));
            let shared = words.iter().filter(|w| other.contains(*w)).count();
            if shared == 0 {
                return None;
            }
            let union = words.len() + other.len() - shared;
            let score = shared as f32 / union.max(1) as f32;
            (score >= 0.5).then_some(Similar {
                id: card.id,
                title: card.title,
                score,
            })
        })
        .collect();
    matches.sort_by(|a, b| b.score.total_cmp(&a.score));
    matches.truncate(3);
    matches
}

/// Words worth comparing: short filler words are dropped so that two cards
/// are not called similar because both contain "the".
fn word_set(text: &str) -> std::collections::BTreeSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 3)
        .map(String::from)
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub text: String,
    /// `lines` makes one card per line; `blocks` splits on blank lines.
    #[serde(default)]
    pub split: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub deck: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub created: usize,
    pub skipped: usize,
}

/// Turn pasted text into cards. Lines containing a `?`-separator, a tab or
/// `::` become question/answer pairs, which covers exports from Anki, Quizlet
/// and a plain list typed by hand.
#[tauri::command]
pub fn import_text(state: State<'_, AppState>, request: ImportRequest) -> Result<ImportResult> {
    import_text_inner(&state, request)
}

pub fn import_text_inner(state: &AppState, request: ImportRequest) -> Result<ImportResult> {
    let chunks: Vec<String> = match request.split.as_deref() {
        Some("blocks") => request
            .text
            .split("\n\n")
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty())
            .collect(),
        _ => request
            .text
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
    };

    let mut created = 0;
    let mut skipped = 0;
    for chunk in chunks {
        let (front, back) = split_pair(&chunk);
        if front.trim().is_empty() {
            skipped += 1;
            continue;
        }
        let kind = match (&request.kind, back.is_empty()) {
            (Some(k), _) => Some(k.clone()),
            (None, false) => Some("qa".to_string()),
            (None, true) => None,
        };
        let draft = CardDraft {
            id: None,
            kind,
            title: None,
            front,
            back: (!back.is_empty()).then_some(back),
            tags: request.tags.clone(),
            deck: request.deck.clone(),
            starred: None,
        };
        match save_draft(state, draft) {
            Ok(_) => created += 1,
            Err(_) => skipped += 1,
        }
    }
    state.refresh()?;
    Ok(ImportResult { created, skipped })
}

/// Split one imported line into question and answer on the separators people
/// actually use.
fn split_pair(line: &str) -> (String, String) {
    for sep in ["\t", " :: ", "::", " ? ", " | "] {
        if let Some((front, back)) = line.split_once(sep) {
            if !front.trim().is_empty() && !back.trim().is_empty() {
                return (front.trim().to_string(), back.trim().to_string());
            }
        }
    }
    (line.trim().to_string(), String::new())
}

/// Everything, as one Markdown document that reads well on its own.
#[tauri::command]
pub fn export_markdown(state: State<'_, AppState>) -> String {
    export_markdown_text(&state.cards_snapshot())
}

fn export_markdown_text(cards: &[Card]) -> String {
    let mut out = String::from("# Micro Card export\n\n");
    out.push_str(&format!(
        "{} cards, exported {}\n\n",
        cards.len(),
        Local::now().format("%-d %B %Y")
    ));

    let mut decks: std::collections::BTreeMap<String, Vec<&Card>> = Default::default();
    for card in cards {
        decks
            .entry(card.deck.clone().unwrap_or_else(|| "Inbox".to_string()))
            .or_default()
            .push(card);
    }

    for (deck, cards) in decks {
        out.push_str(&format!("\n## {deck}\n"));
        for card in cards {
            out.push_str(&format!("\n### {}\n\n{}\n", card.title, card.front.trim()));
            if !card.back.trim().is_empty() {
                out.push_str(&format!("\n**Answer:** {}\n", card.back.trim()));
            }
            if !card.tags.is_empty() {
                out.push_str(&format!(
                    "\n_{}_\n",
                    card.tags
                        .iter()
                        .map(|t| format!("#{t}"))
                        .collect::<Vec<_>>()
                        .join(" ")
                ));
            }
        }
    }
    out
}

/// Write a file the user chose in the save dialog.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<()> {
    std::fs::write(&path, contents)?;
    Ok(())
}

/// Read a file the user chose in the open dialog.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String> {
    Ok(std::fs::read_to_string(&path)?)
}

/// A handful of cards that show what the app is for. Offered on the empty
/// home screen, never forced.
#[tauri::command]
pub fn add_sample_cards(state: State<'_, AppState>) -> Result<Library> {
    let samples: [(&str, &str, &str); 4] = [
        (
            "qa",
            "What makes a card worth keeping?",
            "One idea, in your own words, that you would be annoyed to forget.",
        ),
        (
            "note",
            "Capture first, organise later.\n\nA thought written down in five seconds beats a perfect folder tree you never fill.",
            "",
        ),
        (
            "qa",
            "Why review on a schedule?",
            "Because seeing a card just before you would have forgotten it is what moves it into long-term memory.",
        ),
        (
            "idea",
            "Try writing one card for every article you finish this week.",
            "",
        ),
    ];

    for (kind, front, back) in samples {
        let draft = CardDraft {
            id: None,
            kind: Some(kind.to_string()),
            title: None,
            front: front.to_string(),
            back: (!back.is_empty()).then(|| back.to_string()),
            tags: Some(vec!["example".to_string()]),
            deck: Some("Getting started".to_string()),
            starred: None,
        };
        save_draft(&state, draft)?;
    }
    state.refresh()?;
    library(&state)
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_trash(state: State<'_, AppState>) -> Result<Vec<TrashedCard>> {
    state.vault()?.list_trash()
}

#[tauri::command]
pub fn delete_forever(state: State<'_, AppState>, path: String) -> Result<Vec<TrashedCard>> {
    let vault = state.vault()?;
    vault.delete_forever(&path)?;
    vault.list_trash()
}

#[tauri::command]
pub fn empty_trash(state: State<'_, AppState>) -> Result<usize> {
    state.vault()?.empty_trash()
}

// ---------------------------------------------------------------------------
// Sharing into the app from elsewhere on the phone
// ---------------------------------------------------------------------------

/// Text handed over by another app through the Android share sheet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedText {
    #[serde(default)]
    pub text: String,
    /// The subject a browser or mail app sends alongside the text.
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

/// Collect anything shared into the app and clear it, so the same text is
/// never captured twice.
///
/// The Android activity writes `shared-capture.json` into the app's own files
/// directory (see `scripts/patch-android.mjs`); this reads and removes it.
#[tauri::command]
pub fn take_shared_text(state: State<'_, AppState>) -> Option<SharedText> {
    take_shared_inner(&state)
}

pub fn take_shared_inner(state: &AppState) -> Option<SharedText> {
    for path in shared_capture_paths(&state.data_dir) {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let _ = std::fs::remove_file(&path);
        if let Ok(shared) = serde_json::from_str::<SharedText>(&raw) {
            if !shared.text.trim().is_empty() {
                return Some(shared);
            }
        }
    }
    None
}

/// Where the Android side may have left the shared text.
///
/// Tauri's app data directory and Android's `filesDir` are the same place in
/// practice, but the mapping is not guaranteed across versions, so the
/// neighbouring `files` directory is checked too rather than silently losing
/// what somebody shared.
fn shared_capture_paths(data_dir: &std::path::Path) -> Vec<PathBuf> {
    const NAME: &str = "shared-capture.json";
    let mut paths = vec![data_dir.join(NAME)];
    if data_dir.file_name().and_then(|n| n.to_str()) == Some("files") {
        if let Some(parent) = data_dir.parent() {
            paths.push(parent.join(NAME));
        }
    } else {
        paths.push(data_dir.join("files").join(NAME));
    }
    paths
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Everything, in the format the destination understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// One readable document, grouped by deck.
    Markdown,
    /// Two columns, ready for Anki's "Import file" dialog.
    Csv,
    /// Everything, including review state — the format to re-import from.
    Json,
}

#[tauri::command]
pub fn export_cards(state: State<'_, AppState>, format: ExportFormat) -> Result<String> {
    let cards = state.cards_snapshot();
    Ok(match format {
        ExportFormat::Markdown => export_markdown_text(&cards),
        ExportFormat::Csv => export_csv(&cards),
        ExportFormat::Json => serde_json::to_string_pretty(&cards)
            .map_err(|e| Error::msg(format!("Could not build the export: {e}")))?,
    })
}

/// Anki reads a plain two-column file: front, back, then tags.
fn export_csv(cards: &[Card]) -> String {
    let mut out = String::from("front,back,tags\n");
    for card in cards {
        out.push_str(&format!(
            "{},{},{}\n",
            csv_field(&card.front),
            csv_field(&card.back),
            csv_field(&card.tags.join(" ")),
        ));
    }
    out
}

/// Quote a field the way every spreadsheet expects: wrap it, and double any
/// quotes inside.
fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// Merging duplicates
// ---------------------------------------------------------------------------

/// Fold several cards into one: the keeper gets every tag, and any text the
/// others had that it did not. The others go to the trash, so the merge can be
/// undone card by card.
#[tauri::command]
pub fn merge_cards(
    state: State<'_, AppState>,
    keep: String,
    merge: Vec<String>,
) -> Result<MergeResult> {
    merge_inner(&state, keep, merge)
}

pub fn merge_inner(state: &AppState, keep: String, merge: Vec<String>) -> Result<MergeResult> {
    let cards = state.cards_snapshot();
    let mut keeper = cards
        .iter()
        .find(|c| c.id == keep)
        .cloned()
        .ok_or_else(|| Error::NotFound(keep.clone()))?;
    let others: Vec<Card> = cards
        .into_iter()
        .filter(|c| merge.contains(&c.id) && c.id != keeper.id)
        .collect();
    if others.is_empty() {
        return Err(Error::msg("Nothing to merge."));
    }

    let vault = state.vault()?;
    let mut trashed = Vec::new();

    for other in &others {
        for tag in &other.tags {
            if !keeper.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                keeper.tags.push(tag.clone());
            }
        }
        // Only append text that is genuinely different; merging two identical
        // cards should not produce one card that says everything twice.
        if !other.front.trim().is_empty() && !keeper.front.contains(other.front.trim()) {
            keeper.front = format!("{}\n\n{}", keeper.front.trim(), other.front.trim());
        }
        if !other.back.trim().is_empty() && !keeper.back.contains(other.back.trim()) {
            keeper.back = if keeper.back.trim().is_empty() {
                other.back.trim().to_string()
            } else {
                format!("{}\n\n{}", keeper.back.trim(), other.back.trim())
            };
        }
        if keeper.deck.is_none() {
            keeper.deck = other.deck.clone();
        }
        keeper.starred = keeper.starred || other.starred;
        // Keep the earliest creation date: the idea is as old as its first card.
        keeper.created = keeper.created.min(other.created);
    }

    keeper.updated = model::now();
    vault.save(&mut keeper)?;

    for other in &others {
        if let Ok(path) = vault.trash(&other.path) {
            trashed.push(Deleted {
                id: other.id.clone(),
                trashed_path: path,
            });
        }
    }

    state.refresh()?;
    Ok(MergeResult {
        card: keeper,
        trashed,
    })
}

#[derive(Debug, Serialize)]
pub struct MergeResult {
    pub card: Card,
    /// Where the absorbed cards went, so the merge can be undone.
    pub trashed: Vec<Deleted>,
}

// ---------------------------------------------------------------------------
// Resurfacing
// ---------------------------------------------------------------------------

/// An older card worth seeing again. Knowledge capture has a failure mode —
/// cards go in and are never read — and a gentle nudge is the cheapest fix.
///
/// Cards under a day old are skipped (you have just seen them), reviewable
/// cards that are already due are skipped (they belong in a review session),
/// and the choice is stable for the whole day so the home screen does not
/// shuffle every time it is opened.
#[tauri::command]
pub fn resurfaced_card(state: State<'_, AppState>) -> Option<Card> {
    resurface_inner(&state)
}

pub fn resurface_inner(state: &AppState) -> Option<Card> {
    let now = Utc::now();
    let candidates: Vec<Card> = state
        .cards_snapshot()
        .into_iter()
        .filter(|c| (now - c.updated).num_hours() >= 24)
        .filter(|c| !c.is_due(now))
        .collect();
    if candidates.is_empty() {
        return None;
    }
    // Seed from the date so the pick is one card per day, not one per render.
    let seed = Local::now()
        .date_naive()
        .signed_duration_since(chrono::NaiveDate::default())
        .num_days()
        .unsigned_abs() as usize;
    Some(candidates[seed % candidates.len()].clone())
}
