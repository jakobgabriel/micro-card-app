//! Filesystem side of the app. The vault *is* the database: every operation
//! reads from or writes to real Markdown files, so whatever Obsidian shows is
//! the truth and there is no second copy to drift out of sync.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use serde_yaml::Mapping;
use walkdir::WalkDir;

use crate::error::{Error, Result};
use crate::markdown;
use crate::model::{Card, TrashedCard, VaultCandidate};

/// Folders that never contain user cards.
const SKIP_DIRS: &[&str] = &[
    ".obsidian",
    ".trash",
    ".git",
    ".stfolder",
    ".stversions",
    "node_modules",
];

/// Characters Obsidian (and Android's FAT-derived filesystems) refuse in names.
const FORBIDDEN: &[char] = &[
    '/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']', '\0',
];

/// Short, sortable, collision-resistant id. Timestamp first so that files
/// created in the same session cluster together in any listing.
pub fn new_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random: u32 = rand::random();
    format!(
        "mc_{}{}",
        base36(millis as u64),
        base36(random as u64 % 46_656)
    )
}

fn base36(mut n: u64) -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(ALPHABET[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Turn a title into something safe to write on any device.
pub fn safe_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if FORBIDDEN.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // Windows and some sync tools choke on trailing dots.
    while cleaned.ends_with('.') {
        cleaned.pop();
    }
    if cleaned.chars().count() > 80 {
        cleaned = cleaned
            .chars()
            .take(80)
            .collect::<String>()
            .trim_end()
            .to_string();
    }
    if cleaned.trim().is_empty() {
        "Untitled card".to_string()
    } else {
        cleaned
    }
}

/// Keep the extension, clean the rest.
///
/// An attachment name ends up inside a `![[wikilink]]`, so `[`, `]` and `|`
/// have to go as well as the usual filesystem offenders. A leading dot is
/// dropped too: a card's photo should not be a hidden file.
pub fn safe_attachment_name(filename: &str) -> String {
    // Only a non-empty, plausibly short suffix counts as an extension, so
    // `.hidden` is a dotfile rather than a file with a "hidden" extension.
    let (stem, extension) = match filename.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() && ext.len() <= 8 => {
            (stem, ext.to_lowercase())
        }
        _ => (filename, "bin".to_string()),
    };

    let stem = safe_filename(stem.trim_start_matches('.'));
    let stem: String = stem.chars().take(48).collect();
    let stem = stem.trim();
    if stem.is_empty() || stem == "Untitled card" {
        format!("attachment.{extension}")
    } else {
        format!("{stem}.{extension}")
    }
}

pub struct Vault {
    /// Vault root — the folder Obsidian opens.
    pub root: PathBuf,
    /// Sub-folder holding the cards, relative to the root.
    pub folder: String,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>, folder: &str) -> Self {
        Vault {
            root: root.into(),
            folder: folder.trim().trim_matches('/').to_string(),
        }
    }

    /// Where new cards are created.
    pub fn cards_dir(&self) -> PathBuf {
        if self.folder.is_empty() {
            self.root.clone()
        } else {
            self.root.join(&self.folder)
        }
    }

    pub fn ensure_dirs(&self) -> Result<()> {
        fs::create_dir_all(self.cards_dir())?;
        Ok(())
    }

    /// Where photos and other files attached to cards are kept.
    ///
    /// A sub-folder of the cards folder, so an Obsidian vault sees exactly the
    /// layout it expects and `![[photo.jpg]]` resolves there without any
    /// configuration.
    pub fn attachments_dir(&self) -> PathBuf {
        self.cards_dir().join("attachments")
    }

    /// Store a file next to the cards and return the name to link to.
    pub fn add_attachment(&self, filename: &str, data: &[u8]) -> Result<String> {
        let dir = self.attachments_dir();
        fs::create_dir_all(&dir)?;
        let safe = safe_attachment_name(filename);
        let target = unique_path(&dir, &safe);
        fs::write(&target, data)?;
        Ok(target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(safe))
    }

    fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn rel(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.root)
            .unwrap_or(abs)
            .to_string_lossy()
            .replace('\\', "/")
    }

    /// Read every card in the vault. Files that are not cards (ordinary notes
    /// the user keeps in the same vault) are only picked up when they live in
    /// the cards folder, so we never take over someone's whole vault.
    pub fn scan(&self) -> Result<Vec<Card>> {
        let dir = self.cards_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in WalkDir::new(&dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                !e.file_name()
                    .to_str()
                    .map(|n| SKIP_DIRS.contains(&n))
                    .unwrap_or(false)
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                // A single unreadable file must not break the whole library.
                Err(_) => continue,
            };
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled");
            let modified = file_time(path).unwrap_or_else(Utc::now);
            let parsed = markdown::parse(&content, &self.rel(path), stem, modified);
            out.push(parsed.card);
        }
        out.sort_by_key(|card| std::cmp::Reverse(card.updated));
        Ok(out)
    }

    /// Frontmatter keys another tool wrote, so an edit does not discard them.
    fn existing_extra(&self, rel: &str) -> Mapping {
        let path = self.abs(rel);
        let Ok(content) = fs::read_to_string(&path) else {
            return Mapping::new();
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        markdown::parse(&content, rel, stem, Utc::now()).extra
    }

    /// Write a card, renaming the file when the title changed. Returns the new
    /// path relative to the vault root.
    pub fn save(&self, card: &mut Card) -> Result<String> {
        self.ensure_dirs()?;
        let extra = if card.path.is_empty() {
            Mapping::new()
        } else {
            self.existing_extra(&card.path)
        };

        let desired_name = format!("{}.md", safe_filename(&card.title));
        let old_rel = card.path.clone();
        let old_abs = (!old_rel.is_empty()).then(|| self.abs(&old_rel));

        // Keep cards where the user put them; only the file name follows the title.
        let dir = match old_abs.as_ref().filter(|p| p.exists()) {
            Some(p) => p
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| self.cards_dir()),
            None => self.cards_dir(),
        };
        fs::create_dir_all(&dir)?;

        let target = if old_abs
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            == Some(desired_name.as_str())
            && old_abs.as_ref().map(|p| p.exists()).unwrap_or(false)
        {
            old_abs.clone().unwrap()
        } else {
            unique_path(&dir, &desired_name)
        };

        let contents = markdown::to_markdown(card, &extra);
        write_atomic(&target, &contents)?;

        // Renamed: drop the file at the old location.
        if let Some(old) = old_abs {
            if old.exists() && old != target {
                let _ = fs::remove_file(&old);
            }
        }

        let rel = self.rel(&target);
        card.path = rel.clone();
        Ok(rel)
    }

    /// Move a card into the vault's `.trash` folder — the same place Obsidian
    /// puts deleted notes, so "undo" is possible from either side.
    pub fn trash(&self, rel: &str) -> Result<String> {
        let src = self.abs(rel);
        if !src.exists() {
            return Err(Error::NotFound(rel.to_string()));
        }
        let trash_dir = self.root.join(".trash");
        fs::create_dir_all(&trash_dir)?;
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("card.md")
            .to_string();
        let dest = unique_path(&trash_dir, &name);
        // `rename` fails across mount points on Android; fall back to copy.
        if fs::rename(&src, &dest).is_err() {
            fs::copy(&src, &dest)?;
            fs::remove_file(&src)?;
        }
        Ok(self.rel(&dest))
    }

    /// Move a trashed file back into the cards folder.
    pub fn restore(&self, trashed_rel: &str) -> Result<String> {
        let src = self.abs(trashed_rel);
        if !src.exists() {
            return Err(Error::NotFound(trashed_rel.to_string()));
        }
        self.ensure_dirs()?;
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("card.md")
            .to_string();
        let dest = unique_path(&self.cards_dir(), &name);
        if fs::rename(&src, &dest).is_err() {
            fs::copy(&src, &dest)?;
            fs::remove_file(&src)?;
        }
        Ok(self.rel(&dest))
    }

    /// Everything sitting in the vault's `.trash`, newest first. Parsed just
    /// enough to show a title and a date — a trashed card is not a live card.
    pub fn list_trash(&self) -> Result<Vec<TrashedCard>> {
        let dir = self.root.join(".trash");
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled");
            let deleted = file_time(&path).unwrap_or_else(Utc::now);
            let parsed = markdown::parse(&content, &self.rel(&path), stem, deleted);
            out.push(TrashedCard {
                path: self.rel(&path),
                title: parsed.card.title,
                kind: parsed.card.kind,
                preview: parsed.card.front.chars().take(160).collect(),
                deleted_at: deleted,
            });
        }
        out.sort_by_key(|card| std::cmp::Reverse(card.deleted_at));
        Ok(out)
    }

    /// Remove one trashed file for good.
    pub fn delete_forever(&self, trashed_rel: &str) -> Result<()> {
        // Refuse anything that is not inside `.trash`: this is the one
        // operation with no undo, so it must not be reachable for a live card.
        if !trashed_rel.replace('\\', "/").starts_with(".trash/") {
            return Err(Error::msg("Only trashed cards can be deleted for good."));
        }
        let path = self.root.join(trashed_rel);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Empty the whole trash. Returns how many files went.
    pub fn empty_trash(&self) -> Result<usize> {
        let dir = self.root.join(".trash");
        if !dir.exists() {
            return Ok(0);
        }
        let mut removed = 0;
        for entry in fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md")
                && fs::remove_file(&path).is_ok()
            {
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Is this folder writable? Checked before onboarding finishes so the user
    /// finds out immediately, not at the first save.
    pub fn check_writable(&self) -> Result<()> {
        fs::create_dir_all(self.cards_dir())?;
        let probe = self.cards_dir().join(".micro-card-write-test");
        fs::write(&probe, b"ok")?;
        fs::remove_file(&probe)?;
        Ok(())
    }
}

/// `Name.md` -> `Name 2.md` when taken, so a save never overwrites a stranger.
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (filename.to_string(), String::new()),
    };
    for n in 2..1000 {
        let candidate = dir.join(format!("{stem} {n}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem} {}{ext}", new_id()))
}

/// Write via a temporary file so a crash or a sync client reading mid-write
/// can never leave a half-written card behind.
fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, contents.as_bytes())?;
    if let Err(err) = fs::rename(&tmp, path) {
        // Some Android storage providers do not support rename-over.
        let _ = fs::remove_file(&tmp);
        fs::write(path, contents.as_bytes()).map_err(|_| Error::Io(err))?;
    }
    Ok(())
}

fn file_time(path: &Path) -> Option<DateTime<Utc>> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let dur = modified.duration_since(UNIX_EPOCH).ok()?;
    DateTime::from_timestamp(dur.as_secs() as i64, dur.subsec_nanos())
}

/// Look for Obsidian vaults (folders containing `.obsidian`) under a set of
/// roots. This is what makes setup a single tap instead of a path-typing
/// exercise — on Android nobody knows where their vault actually lives.
pub fn find_vaults(roots: &[PathBuf], max_depth: usize) -> Vec<VaultCandidate> {
    let mut found: Vec<VaultCandidate> = Vec::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                // `.obsidian` itself must stay walkable; skip other dot dirs.
                name == ".obsidian" || !name.starts_with('.') || e.depth() == 0
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_dir() || entry.file_name() != ".obsidian" {
                continue;
            }
            let Some(vault_dir) = entry.path().parent() else {
                continue;
            };
            let path = vault_dir.to_string_lossy().to_string();
            if found.iter().any(|c| c.path == path) {
                continue;
            }
            found.push(VaultCandidate {
                name: vault_dir
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.clone()),
                note_count: count_notes(vault_dir),
                path,
            });
        }
    }
    found.sort_by_key(|vault| std::cmp::Reverse(vault.note_count));
    found
}

/// Rough size of a vault. Capped: we only need it to label the picker.
fn count_notes(dir: &Path) -> usize {
    WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|n| SKIP_DIRS.contains(&n))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .take(5000)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CardKind;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("micro-card-{}-{}", name, new_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(title: &str) -> Card {
        Card {
            id: new_id(),
            kind: CardKind::Note,
            title: title.to_string(),
            front: "body text".into(),
            back: String::new(),
            tags: vec!["card".into()],
            deck: None,
            created: Utc::now(),
            updated: Utc::now(),
            starred: false,
            review: Default::default(),
            path: String::new(),
            links: vec![],
        }
    }

    #[test]
    fn strips_characters_obsidian_rejects() {
        assert_eq!(safe_filename("a/b:c?d*e|f#g"), "a b c d e f g");
        assert_eq!(safe_filename("   "), "Untitled card");
    }

    #[test]
    fn saving_writes_into_the_cards_folder_and_scans_back() {
        let root = temp_dir("save");
        let vault = Vault::new(&root, "Cards");
        let mut card = sample("First card");
        let rel = vault.save(&mut card).unwrap();
        assert_eq!(rel, "Cards/First card.md");
        let cards = vault.scan().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, card.id);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn renaming_a_title_moves_the_file_instead_of_leaving_a_duplicate() {
        let root = temp_dir("rename");
        let vault = Vault::new(&root, "Cards");
        let mut card = sample("Old name");
        vault.save(&mut card).unwrap();
        card.title = "New name".into();
        let rel = vault.save(&mut card).unwrap();
        assert_eq!(rel, "Cards/New name.md");
        assert_eq!(vault.scan().unwrap().len(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn two_cards_with_the_same_title_do_not_overwrite_each_other() {
        let root = temp_dir("dupe");
        let vault = Vault::new(&root, "Cards");
        let mut a = sample("Same");
        let mut b = sample("Same");
        vault.save(&mut a).unwrap();
        let rel_b = vault.save(&mut b).unwrap();
        assert_eq!(rel_b, "Cards/Same 2.md");
        assert_eq!(vault.scan().unwrap().len(), 2);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn trashed_cards_leave_the_library_and_can_come_back() {
        let root = temp_dir("trash");
        let vault = Vault::new(&root, "Cards");
        let mut card = sample("Doomed");
        let rel = vault.save(&mut card).unwrap();
        let trashed = vault.trash(&rel).unwrap();
        assert!(vault.scan().unwrap().is_empty());
        vault.restore(&trashed).unwrap();
        assert_eq!(vault.scan().unwrap().len(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_edit_made_in_obsidian_is_picked_up_with_the_same_identity() {
        let root = temp_dir("external-edit");
        let vault = Vault::new(&root, "Cards");
        let mut card = sample("Wavelength");
        let rel = vault.save(&mut card).unwrap();

        // Simulate Obsidian: rewrite the body, leave the frontmatter alone.
        let path = root.join(&rel);
        let content = fs::read_to_string(&path).unwrap();
        let edited = content.replace("body text", "edited in Obsidian #physics");
        fs::write(&path, edited).unwrap();

        let cards = vault.scan().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, card.id, "the id must survive an outside edit");
        assert!(cards[0].front.contains("edited in Obsidian"));
        assert!(cards[0].tags.iter().any(|t| t == "physics"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_hand_written_note_dropped_into_the_folder_becomes_a_card() {
        let root = temp_dir("adopt");
        let vault = Vault::new(&root, "Cards");
        vault.ensure_dirs().unwrap();
        fs::write(
            vault.cards_dir().join("Ohm's law.md"),
            "What is Ohm's law?\n\n?\n\nV = I x R\n",
        )
        .unwrap();

        let cards = vault.scan().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].kind, CardKind::Qa, "a ? separator means Q & A");
        assert_eq!(cards[0].title, "Ohm's law");
        assert_eq!(cards[0].back, "V = I x R");
        assert!(!cards[0].id.is_empty(), "an id is assigned on first read");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn notes_elsewhere_in_the_vault_are_left_alone() {
        let root = temp_dir("scope");
        let vault = Vault::new(&root, "Cards");
        vault.ensure_dirs().unwrap();
        fs::write(root.join("Daily note.md"), "not a card").unwrap();
        fs::create_dir_all(root.join("Projects")).unwrap();
        fs::write(root.join("Projects/Plan.md"), "also not a card").unwrap();

        assert!(vault.scan().unwrap().is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn attachment_names_keep_their_extension_and_lose_everything_dangerous() {
        assert_eq!(safe_attachment_name("photo.JPG"), "photo.jpg");
        assert_eq!(safe_attachment_name("my [note]|pic.png"), "my note pic.png");
        assert_eq!(safe_attachment_name("noextension"), "noextension.bin");
        // A dotfile has no extension and must not stay hidden in the vault.
        assert_eq!(safe_attachment_name(".hidden"), "hidden.bin");
    }

    #[test]
    fn two_photos_with_the_same_name_both_survive() {
        let root = temp_dir("attach");
        let vault = Vault::new(&root, "Cards");
        let first = vault.add_attachment("photo.jpg", b"one").unwrap();
        let second = vault.add_attachment("photo.jpg", b"two").unwrap();

        assert_eq!(first, "photo.jpg");
        assert_eq!(second, "photo 2.jpg");
        assert_eq!(
            fs::read(vault.attachments_dir().join(&first)).unwrap(),
            b"one"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn attachments_do_not_show_up_as_cards() {
        let root = temp_dir("attach-scan");
        let vault = Vault::new(&root, "Cards");
        let mut card = sample("With a photo");
        vault.save(&mut card).unwrap();
        vault.add_attachment("photo.jpg", b"binary").unwrap();

        assert_eq!(vault.scan().unwrap().len(), 1);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn finds_a_vault_by_its_obsidian_folder() {
        let root = temp_dir("detect");
        let vault_dir = root.join("My Vault");
        fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        fs::write(vault_dir.join("note.md"), "hello").unwrap();
        let found = find_vaults(std::slice::from_ref(&root), 3);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "My Vault");
        assert_eq!(found[0].note_count, 1);
        fs::remove_dir_all(&root).ok();
    }
}
