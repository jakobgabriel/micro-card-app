//! Core data model. A card is always backed by exactly one Markdown file,
//! so everything here has to survive a round trip through the vault.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// What kind of thing the user captured. This only drives presentation and
/// whether the card takes part in review — the file format is identical.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CardKind {
    /// A plain note: one thought, one file.
    #[default]
    Note,
    /// Question on the front, answer on the back. Reviewable.
    Qa,
    /// Something to chase later.
    Idea,
    /// Someone else's words, kept verbatim.
    Quote,
    /// A single actionable item.
    Task,
}

impl CardKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CardKind::Note => "note",
            CardKind::Qa => "qa",
            CardKind::Idea => "idea",
            CardKind::Quote => "quote",
            CardKind::Task => "task",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "qa" | "q&a" | "question" | "flashcard" => CardKind::Qa,
            "idea" => CardKind::Idea,
            "quote" => CardKind::Quote,
            "task" | "todo" => CardKind::Task,
            _ => CardKind::Note,
        }
    }

    /// Only cards with a back side are worth showing in review.
    pub fn reviewable(&self) -> bool {
        matches!(self, CardKind::Qa)
    }
}

/// Spaced-repetition state, an SM-2 variant kept deliberately small so it
/// stays readable inside the Markdown frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub due: DateTime<Utc>,
    /// Current interval in days.
    pub interval: f64,
    /// Ease factor; 1.3 is the floor used by SM-2.
    pub ease: f64,
    pub reps: u32,
    pub lapses: u32,
}

impl Default for Review {
    fn default() -> Self {
        Review {
            due: Utc::now(),
            interval: 0.0,
            ease: 2.5,
            reps: 0,
            lapses: 0,
        }
    }
}

/// How well the user recalled a card. Three buttons, not six — anything more
/// makes people stop and think about the grading instead of the material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grade {
    Again,
    Good,
    Easy,
}

impl Review {
    /// Apply a grade and return the updated schedule.
    pub fn grade(&self, grade: Grade, now: DateTime<Utc>) -> Review {
        let mut next = self.clone();
        match grade {
            Grade::Again => {
                next.lapses += 1;
                next.reps = 0;
                next.ease = (self.ease - 0.2).max(1.3);
                // Come back within the same session.
                next.interval = 0.007; // ~10 minutes
            }
            Grade::Good => {
                next.reps += 1;
                next.interval = match self.reps {
                    0 => 1.0,
                    1 => 3.0,
                    _ => (self.interval * self.ease).max(1.0),
                };
            }
            Grade::Easy => {
                next.reps += 1;
                next.ease = (self.ease + 0.15).min(3.0);
                next.interval = match self.reps {
                    0 => 3.0,
                    1 => 6.0,
                    _ => (self.interval * next.ease * 1.3).max(1.0),
                };
            }
        }
        // Cap at ~1 year: beyond that the schedule stops being meaningful.
        next.interval = next.interval.min(365.0);
        let secs = (next.interval * 86_400.0).round() as i64;
        next.due = now + Duration::seconds(secs.max(60));
        next
    }
}

/// One card, as the UI sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    #[serde(default)]
    pub kind: CardKind,
    /// Human title. Also the basis for the file name.
    pub title: String,
    /// Question (qa) or the note body (everything else).
    pub front: String,
    /// Answer. Empty for non-qa cards.
    #[serde(default)]
    pub back: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub deck: Option<String>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub review: Review,
    /// Path relative to the vault root, e.g. `Cards/Wavelength.md`.
    #[serde(default)]
    pub path: String,
    /// `[[Wikilinks]]` found in the body, so the UI can show connections.
    #[serde(default)]
    pub links: Vec<String>,
}

impl Card {
    pub fn is_due(&self, now: DateTime<Utc>) -> bool {
        self.kind.reviewable() && self.review.due <= now
    }
}

/// What the user sends when saving from the editor. Everything except the
/// text is optional so that "type something, hit save" is a complete path.
#[derive(Debug, Clone, Deserialize)]
pub struct CardDraft {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub front: String,
    #[serde(default)]
    pub back: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub deck: Option<String>,
    #[serde(default)]
    pub starred: Option<bool>,
}

/// Persisted app settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Absolute path of the Obsidian vault. `None` means local-only mode.
    #[serde(default)]
    pub vault_path: Option<String>,
    /// Sub-folder inside the vault that holds the cards.
    #[serde(default = "default_folder")]
    pub folder: String,
    /// Tag automatically added to every new card, so cards are easy to find
    /// in Obsidian search. Empty string disables it.
    #[serde(default = "default_tag")]
    pub default_tag: String,
    #[serde(default = "default_true")]
    pub onboarded: bool,
    #[serde(default = "default_true")]
    pub dark_mode: bool,
    /// Daily review target, used for the progress ring.
    #[serde(default = "default_goal")]
    pub daily_goal: u32,
}

fn default_folder() -> String {
    "Cards".to_string()
}
fn default_tag() -> String {
    "card".to_string()
}
fn default_true() -> bool {
    true
}
fn default_goal() -> u32 {
    20
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            vault_path: None,
            folder: default_folder(),
            default_tag: default_tag(),
            onboarded: false,
            dark_mode: true,
            daily_goal: default_goal(),
        }
    }
}

/// A candidate Obsidian vault found on the device.
#[derive(Debug, Clone, Serialize)]
pub struct VaultCandidate {
    pub name: String,
    pub path: String,
    /// Number of Markdown files, so the user can tell vaults apart.
    pub note_count: usize,
}

/// Counters shown on the home screen.
#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub total: usize,
    pub due: usize,
    pub captured_today: usize,
    pub reviewed_today: usize,
    pub streak_days: u32,
    pub decks: Vec<DeckStat>,
    pub tags: Vec<TagStat>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeckStat {
    pub name: String,
    pub count: usize,
    pub due: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagStat {
    pub name: String,
    pub count: usize,
}
