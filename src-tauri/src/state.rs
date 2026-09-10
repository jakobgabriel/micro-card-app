//! Application state: settings, the in-memory card cache and the review
//! journal that powers the streak counter.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use chrono::{Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::{Card, DeckStat, Settings, Stats, TagStat};
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
}

impl Journal {
    fn today_key() -> String {
        Local::now().date_naive().to_string()
    }

    pub fn record_review(&mut self) {
        self.days.entry(Self::today_key()).or_default().reviewed += 1;
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
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&data_dir);
        let settings = read_json(&data_dir.join("settings.json")).unwrap_or_default();
        let journal = read_json(&data_dir.join("journal.json")).unwrap_or_default();
        AppState {
            data_dir,
            settings: RwLock::new(settings),
            cards: RwLock::new(Vec::new()),
            journal: RwLock::new(journal),
        }
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
        let mut due = 0usize;
        let mut captured_today = 0usize;

        for card in &cards {
            if card.is_due(now) {
                due += 1;
            }
            if card.created.with_timezone(&Local).date_naive() == today {
                captured_today += 1;
            }
            let deck = card.deck.clone().unwrap_or_else(|| "Inbox".to_string());
            let entry = decks.entry(deck).or_insert((0, 0));
            entry.0 += 1;
            if card.is_due(now) {
                entry.1 += 1;
            }
            for tag in &card.tags {
                *tags.entry(tag.clone()).or_insert(0) += 1;
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
        tag_stats.truncate(40);

        let journal = self.journal.read().ok();
        let (reviewed_today, streak_days) = journal
            .map(|j| (j.today().reviewed as usize, j.streak()))
            .unwrap_or((0, 0));

        Stats {
            total: cards.len(),
            due,
            captured_today,
            reviewed_today,
            streak_days,
            decks: deck_stats,
            tags: tag_stats,
        }
    }
}

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
    fn streak_counts_back_from_today() {
        let mut journal = Journal::default();
        let today = Local::now().date_naive();
        for offset in 0..3 {
            journal.days.insert(
                (today - Duration::days(offset)).to_string(),
                DayLog {
                    reviewed: 1,
                    captured: 0,
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
            },
        );
        assert_eq!(journal.streak(), 1);
    }
}
