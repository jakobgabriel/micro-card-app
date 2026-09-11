//! Core data model. A card is always backed by exactly one Markdown file,
//! so everything here has to survive a round trip through the vault.

use chrono::{DateTime, Duration, SubsecRound, Utc};
use serde::{Deserialize, Serialize};

/// The current time, truncated to whole seconds.
///
/// Card timestamps are stored in the Markdown frontmatter with second
/// precision. Truncating here means a card held in memory and the same card
/// read back from disk compare equal, instead of differing by stray
/// nanoseconds that were never written.
pub fn now() -> DateTime<Utc> {
    Utc::now().trunc_subsecs(0)
}

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
            due: now(),
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
        next.due = (now + Duration::seconds(secs.max(60))).trunc_subsecs(0);
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

/// How the app picks its colours.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    /// Follow the phone's own light/dark setting.
    #[default]
    System,
    Light,
    Dark,
}

/// Persisted app settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Absolute path of the Obsidian vault. `None` means cards live in the
    /// app's own storage — which is also the case for GitHub-only setups.
    #[serde(default)]
    pub vault_path: Option<String>,
    /// Sub-folder inside the vault (or repository) that holds the cards.
    #[serde(default = "default_folder")]
    pub folder: String,
    /// Tag automatically added to every new card, so cards are easy to find
    /// in Obsidian search. Empty string disables it.
    #[serde(default = "default_tag")]
    pub default_tag: String,
    #[serde(default = "default_true")]
    pub onboarded: bool,
    #[serde(default)]
    pub theme: Theme,
    /// Body text scale, 0.85–1.4. For anyone who finds the default too small.
    #[serde(default = "default_scale")]
    pub text_scale: f32,
    /// Daily review target, used for the progress ring.
    #[serde(default = "default_goal")]
    pub daily_goal: u32,
    /// Cards per review session.
    #[serde(default = "default_session")]
    pub session_size: u32,
    /// Local hour (0–23) for the daily review reminder; `None` is off.
    #[serde(default)]
    pub reminder_hour: Option<u32>,
    /// Repository cards are mirrored to, if any.
    #[serde(default)]
    pub github: Option<crate::github::RepoConfig>,
    /// Sync automatically on launch, on resume and after saving.
    #[serde(default = "default_true")]
    pub github_auto_sync: bool,
}

fn default_scale() -> f32 {
    1.0
}
fn default_session() -> u32 {
    20
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
            theme: Theme::default(),
            text_scale: default_scale(),
            daily_goal: default_goal(),
            session_size: default_session(),
            reminder_hour: None,
            github: None,
            github_auto_sync: true,
        }
    }
}

/// A card in the vault's `.trash`, waiting to be restored or forgotten.
#[derive(Debug, Clone, Serialize)]
pub struct TrashedCard {
    /// Path relative to the vault root, always inside `.trash`.
    pub path: String,
    pub title: String,
    pub kind: CardKind,
    pub preview: String,
    pub deleted_at: DateTime<Utc>,
}

/// A candidate Obsidian vault found on the device.
#[derive(Debug, Clone, Serialize)]
pub struct VaultCandidate {
    pub name: String,
    pub path: String,
    /// Number of Markdown files, so the user can tell vaults apart.
    pub note_count: usize,
}

/// Counters shown on the home and stats screens.
#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub total: usize,
    pub due: usize,
    pub captured_today: usize,
    pub reviewed_today: usize,
    pub streak_days: u32,
    /// Longest streak ever reached, so a broken streak still shows progress.
    pub best_streak: u32,
    pub decks: Vec<DeckStat>,
    pub tags: Vec<TagStat>,
    pub kinds: Vec<KindStat>,
    /// Activity per day for the last twelve weeks, oldest first.
    pub activity: Vec<DayCount>,
    /// How many cards fall due on each of the next fourteen days.
    pub forecast: Vec<DayCount>,
    /// Share of the last month's reviews that were recalled, 0.0–1.0.
    /// `None` until there is enough history to be worth showing.
    pub retention: Option<f32>,
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

#[derive(Debug, Clone, Serialize)]
pub struct KindStat {
    pub kind: String,
    pub count: usize,
}

/// One bar of the activity chart or the review forecast.
#[derive(Debug, Clone, Serialize)]
pub struct DayCount {
    /// Local date, `YYYY-MM-DD`.
    pub date: String,
    pub count: u32,
}
