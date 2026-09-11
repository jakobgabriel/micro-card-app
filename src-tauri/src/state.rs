//! Application state: settings, the in-memory card cache and the review
//! journal that powers the streak counter.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use chrono::{Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::{Card, DayCount, DeckStat, KindStat, Settings, Stats, TagStat};
use crate::sync::SyncState;
use crate::vault::Vault;

/// Per-day activity counters, keyed by local date (`YYYY-MM-DD`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Journal {
    #[serde(default)]
    pub days: BTreeMap<String, DayLog>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DayLog {
    #[serde(default)]
    pub reviewed: u32,
    #[serde(default)]
    pub captured: u32,
    /// Reviews where the card was not recalled. The difference between this
    /// and `reviewed` is what makes a retention figure possible.
    #[serde(default)]
    pub forgotten: u32,
}

impl Journal {
    fn today_key() -> String {
        Local::now().date_naive().to_string()
    }

    pub fn record_review(&mut self, recalled: bool) {
        let day = self.days.entry(Self::today_key()).or_default();
        day.reviewed += 1;
        if !recalled {
            day.forgotten += 1;
        }
    }

    /// Share of reviews in the last `days` days where the card was recalled.
    /// `None` until there is enough history for the number to mean anything.
    pub fn retention(&self, days: i64) -> Option<f32> {
        let cutoff = Local::now().date_naive() - Duration::days(days);
        let (reviewed, forgotten) = self
            .days
            .iter()
            .filter(|(key, _)| {
                key.parse::<NaiveDate>()
                    .map(|date| date >= cutoff)
                    .unwrap_or(false)
            })
            .fold((0u32, 0u32), |(r, f), (_, log)| {
                (r + log.reviewed, f + log.forgotten)
            });
        (reviewed >= 10).then(|| (reviewed - forgotten) as f32 / reviewed as f32)
    }

    /// Take back a review that was just recorded, so undoing a mis-tap during
    /// review does not leave the streak counting work that was reversed.
    pub fn undo_review(&mut self, recalled: bool) {
        if let Some(day) = self.days.get_mut(&Self::today_key()) {
            day.reviewed = day.reviewed.saturating_sub(1);
            if !recalled {
                day.forgotten = day.forgotten.saturating_sub(1);
            }
        }
    }

    pub fn record_capture(&mut self) {
        self.days.entry(Self::today_key()).or_default().captured += 1;
    }

    pub fn today(&self) -> DayLog {
        self.days
            .get(&Self::today_key())
            .cloned()
            .unwrap_or_default()
    }

    /// The longest run of active days ever recorded.
    pub fn best_streak(&self) -> u32 {
        let mut best = 0;
        let mut run = 0;
        let mut previous: Option<NaiveDate> = None;
        for (key, log) in &self.days {
            if log.reviewed == 0 && log.captured == 0 {
                continue;
            }
            let Ok(date) = key.parse::<NaiveDate>() else {
                continue;
            };
            run = match previous {
                Some(p) if date == p + Duration::days(1) => run + 1,
                _ => 1,
            };
            best = best.max(run);
            previous = Some(date);
        }
        best
    }

    /// Activity for the last `days` days, oldest first, including empty days
    /// so the chart keeps a stable shape.
    pub fn recent_activity(&self, days: i64) -> Vec<DayCount> {
        let today = Local::now().date_naive();
        (0..days)
            .rev()
            .map(|offset| {
                let date = today - Duration::days(offset);
                let log = self
                    .days
                    .get(&date.to_string())
                    .cloned()
                    .unwrap_or_default();
                DayCount {
                    date: date.to_string(),
                    count: log.reviewed + log.captured,
                }
            })
            .collect()
    }

    /// Consecutive days ending today (or yesterday, so the streak does not
    /// break before the user has had a chance to study).
    pub fn streak(&self) -> u32 {
        let today = Local::now().date_naive();
        let active = |d: NaiveDate| {
            self.days
                .get(&d.to_string())
                .map(|l| l.reviewed > 0 || l.captured > 0)
                .unwrap_or(false)
        };
        let mut cursor = if active(today) {
            today
        } else {
            let yesterday = today - Duration::days(1);
            if active(yesterday) {
                yesterday
            } else {
                return 0;
            }
        };
        let mut streak = 0;
        while active(cursor) {
            streak += 1;
            cursor -= Duration::days(1);
        }
        streak
    }
}

pub struct AppState {
    pub data_dir: PathBuf,
    pub settings: RwLock<Settings>,
    pub cards: RwLock<Vec<Card>>,
    pub journal: RwLock<Journal>,
    /// What the last GitHub sync left behind.
    pub sync_state: RwLock<SyncState>,
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&data_dir);
        let settings = read_json(&data_dir.join("settings.json")).unwrap_or_default();
        let journal = read_json(&data_dir.join("journal.json")).unwrap_or_default();
        let sync_state = read_json(&data_dir.join("sync-state.json")).unwrap_or_default();
        AppState {
            data_dir,
            settings: RwLock::new(settings),
            cards: RwLock::new(Vec::new()),
            journal: RwLock::new(journal),
            sync_state: RwLock::new(sync_state),
        }
    }

    /// The GitHub token, kept out of `settings.json` so that exporting or
    /// sharing settings can never leak it.
    pub fn github_token(&self) -> Option<String> {
        let stored: Option<StoredToken> = read_json(&self.data_dir.join("credentials.json"));
        stored
            .map(|s| s.github_token)
            .filter(|t| !t.trim().is_empty())
    }

    pub fn set_github_token(&self, token: Option<&str>) -> Result<()> {
        let path = self.data_dir.join("credentials.json");
        match token.map(str::trim).filter(|t| !t.is_empty()) {
            Some(token) => {
                write_json(
                    &path,
                    &StoredToken {
                        github_token: token.to_string(),
                    },
                )?;
                restrict_permissions(&path);
                Ok(())
            }
            None => {
                if path.exists() {
                    fs::remove_file(&path)?;
                }
                Ok(())
            }
        }
    }

    pub fn save_sync_state(&self) -> Result<()> {
        let state = self
            .sync_state
            .read()
            .map_err(|_| Error::msg("Sync state is busy."))?;
        write_json(&self.data_dir.join("sync-state.json"), &*state)
    }

    /// Fallback vault used before the user connects Obsidian. Cards written
    /// here are ordinary Markdown files and can be moved into a vault later.
    pub fn local_vault_path(&self) -> PathBuf {
        self.data_dir.join("Local Cards")
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn vault(&self) -> Result<Vault> {
        let settings = self.settings_snapshot();
        let root = match settings
            .vault_path
            .as_ref()
            .filter(|p| !p.trim().is_empty())
        {
            Some(p) => PathBuf::from(p),
            None => self.local_vault_path(),
        };
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|_| Error::NoVault)?;
        }
        Ok(Vault::new(root, &settings.folder))
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        write_json(&self.data_dir.join("settings.json"), settings)
    }

    pub fn save_journal(&self) -> Result<()> {
        let journal = self.journal.read().map_err(|_| Error::msg("state busy"))?;
        write_json(&self.data_dir.join("journal.json"), &*journal)
    }

    /// Re-read the vault from disk. Called on launch, on resume and after any
    /// change made outside the app — this is what keeps Obsidian edits visible.
    pub fn refresh(&self) -> Result<Vec<Card>> {
        let cards = self.vault()?.scan()?;
        if let Ok(mut guard) = self.cards.write() {
            *guard = cards.clone();
        }
        Ok(cards)
    }

    pub fn cards_snapshot(&self) -> Vec<Card> {
        self.cards.read().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn stats(&self) -> Stats {
        let cards = self.cards_snapshot();
        let now = Utc::now();
        let today = Local::now().date_naive();

        let mut decks: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        let mut tags: BTreeMap<String, usize> = BTreeMap::new();
        let mut kinds: BTreeMap<&'static str, usize> = BTreeMap::new();
        let mut forecast: BTreeMap<NaiveDate, u32> = BTreeMap::new();
        let mut due = 0usize;
        let mut captured_today = 0usize;

        for card in &cards {
            let is_due = card.is_due(now);
            if is_due {
                due += 1;
            }
            if card.created.with_timezone(&Local).date_naive() == today {
                captured_today += 1;
            }
            *kinds.entry(card.kind.as_str()).or_insert(0) += 1;

            let deck = card.deck.clone().unwrap_or_else(|| "Inbox".to_string());
            let entry = decks.entry(deck).or_insert((0, 0));
            entry.0 += 1;
            if is_due {
                entry.1 += 1;
            }
            for tag in &card.tags {
                *tags.entry(tag.clone()).or_insert(0) += 1;
            }

            // Anything already due counts against today's column.
            if card.kind.reviewable() {
                let day = card
                    .review
                    .due
                    .with_timezone(&Local)
                    .date_naive()
                    .max(today);
                if day <= today + Duration::days(13) {
                    *forecast.entry(day).or_insert(0) += 1;
                }
            }
        }

        let mut deck_stats: Vec<DeckStat> = decks
            .into_iter()
            .map(|(name, (count, due))| DeckStat { name, count, due })
            .collect();
        deck_stats.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

        let mut tag_stats: Vec<TagStat> = tags
            .into_iter()
            .map(|(name, count)| TagStat { name, count })
            .collect();
        tag_stats.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

        let mut kind_stats: Vec<KindStat> = kinds
            .into_iter()
            .map(|(kind, count)| KindStat {
                kind: kind.to_string(),
                count,
            })
            .collect();
        kind_stats.sort_by_key(|k| std::cmp::Reverse(k.count));

        let forecast = (0..14)
            .map(|offset| {
                let date = today + Duration::days(offset);
                DayCount {
                    count: forecast.get(&date).copied().unwrap_or(0),
                    date: date.to_string(),
                }
            })
            .collect();

        let journal = self.journal.read().ok();
        let (reviewed_today, streak_days, best_streak, activity, retention) = journal
            .map(|j| {
                (
                    j.today().reviewed as usize,
                    j.streak(),
                    j.best_streak(),
                    j.recent_activity(84),
                    j.retention(30),
                )
            })
            .unwrap_or((0, 0, 0, Vec::new(), None));

        Stats {
            total: cards.len(),
            due,
            captured_today,
            reviewed_today,
            streak_days,
            best_streak,
            decks: deck_stats,
            tags: tag_stats,
            kinds: kind_stats,
            activity,
            forecast,
            retention,
        }
    }
}

/// Credentials live in their own file, never in the settings the user can see
/// or export.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredToken {
    github_token: String,
}

/// Best-effort `chmod 600`. On Android every app already has its own uid, so
/// this only matters on a shared desktop machine.
#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) {}

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value).map_err(|e| Error::msg(e.to_string()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_needs_enough_reviews_to_mean_anything() {
        let mut journal = Journal::default();
        let today = Local::now().date_naive();
        journal.days.insert(
            today.to_string(),
            DayLog {
                reviewed: 4,
                captured: 0,
                forgotten: 1,
            },
        );
        assert_eq!(journal.retention(30), None, "four reviews prove nothing");

        journal.days.insert(
            (today - Duration::days(1)).to_string(),
            DayLog {
                reviewed: 16,
                captured: 0,
                forgotten: 3,
            },
        );
        let retention = journal.retention(30).expect("enough history now");
        assert!((retention - 0.8).abs() < 0.001, "{retention}");
    }

    #[test]
    fn retention_ignores_reviews_from_before_the_window() {
        let mut journal = Journal::default();
        let old = Local::now().date_naive() - Duration::days(90);
        journal.days.insert(
            old.to_string(),
            DayLog {
                reviewed: 50,
                captured: 0,
                forgotten: 50,
            },
        );
        assert_eq!(journal.retention(30), None);
    }

    #[test]
    fn streak_counts_back_from_today() {
        let mut journal = Journal::default();
        let today = Local::now().date_naive();
        for offset in 0..3 {
            journal.days.insert(
                (today - Duration::days(offset)).to_string(),
                DayLog {
                    reviewed: 1,
                    captured: 0,
                    forgotten: 0,
                },
            );
        }
        assert_eq!(journal.streak(), 3);
    }

    #[test]
    fn a_gap_yesterday_and_today_ends_the_streak() {
        let mut journal = Journal::default();
        let old = Local::now().date_naive() - Duration::days(4);
        journal.days.insert(
            old.to_string(),
            DayLog {
                reviewed: 9,
                captured: 0,
                forgotten: 0,
            },
        );
        assert_eq!(journal.streak(), 0);
    }

    #[test]
    fn yesterday_alone_still_counts_so_the_streak_survives_the_morning() {
        let mut journal = Journal::default();
        let yesterday = Local::now().date_naive() - Duration::days(1);
        journal.days.insert(
            yesterday.to_string(),
            DayLog {
                reviewed: 2,
                captured: 0,
                forgotten: 0,
            },
        );
        assert_eq!(journal.streak(), 1);
    }
}
