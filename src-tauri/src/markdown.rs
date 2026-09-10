//! Reading and writing the Obsidian-compatible card format.
//!
//! A card file looks like this:
//!
//! ```text
//! ---
//! id: mc_1k3j...
//! type: qa
//! tags: [physics, waves]
//! ---
//!
//! What is a wavelength?
//!
//! ?
//!
//! The distance between two successive crests.
//! ```
//!
//! The `?` separator is the same one the Obsidian *Spaced Repetition* plugin
//! uses for multi-line cards, so the files stay useful even without this app.

use chrono::{DateTime, TimeZone, Utc};
use serde_yaml::{Mapping, Value};

use crate::model::{Card, CardKind, Review};

/// Frontmatter keys this app owns. Anything else in the frontmatter belongs to
/// the user (or another plugin) and is written back untouched.
const OWNED_KEYS: &[&str] = &[
    "id", "type", "tags", "deck", "created", "updated", "starred", "review", "title",
];

pub struct ParsedCard {
    pub card: Card,
    /// Frontmatter keys written by something other than this app.
    pub extra: Mapping,
}

/// Split a file into (frontmatter yaml, body). Returns `None` for the
/// frontmatter when the file does not start with a `---` fence.
fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let rest = match text.strip_prefix("---\n") {
        Some(r) => r,
        None => match text.strip_prefix("---\r\n") {
            Some(r) => r,
            None => return (None, text),
        },
    };
    // Find the closing fence at the start of a line.
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            let yaml = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return (Some(yaml), body);
        }
        offset += line.len();
    }
    (None, text)
}

fn yaml_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn yaml_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn yaml_date(v: &Value) -> Option<DateTime<Utc>> {
    let raw = yaml_string(v)?;
    let raw = raw.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    // Obsidian users often write bare dates or `YYYY-MM-DD HH:MM`.
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(raw, fmt) {
            return Some(Utc.from_utc_datetime(&naive));
        }
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return date.and_hms_opt(0, 0, 0).map(|n| Utc.from_utc_datetime(&n));
    }
    None
}

/// Accepts both `tags: [a, b]` and the multi-line list form, plus the
/// `tags: a, b` shorthand people type by hand.
fn yaml_tags(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    match v {
        Value::Sequence(seq) => {
            for item in seq {
                if let Some(s) = yaml_string(item) {
                    out.push(normalize_tag(&s));
                }
            }
        }
        Value::String(s) => {
            for part in s.split(',') {
                let t = normalize_tag(part);
                if !t.is_empty() {
                    out.push(t);
                }
            }
        }
        _ => {}
    }
    out.retain(|t| !t.is_empty());
    out
}

pub fn normalize_tag(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('#')
        .trim()
        .replace(' ', "-")
        .to_string()
}

/// Inline `#tags` written directly in the body, the way Obsidian does it.
/// Headings (`# Title`) are excluded because they have a space after the hash.
fn inline_tags(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_code = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        let bytes: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == '#' && (i == 0 || bytes[i - 1].is_whitespace()) {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len()
                    && (bytes[end].is_alphanumeric()
                        || bytes[end] == '-'
                        || bytes[end] == '_'
                        || bytes[end] == '/')
                {
                    end += 1;
                }
                // A hash followed by a space is a heading, not a tag.
                if end > start {
                    let tag: String = bytes[start..end].iter().collect();
                    if tag.chars().any(|c| c.is_alphabetic()) {
                        out.push(tag);
                    }
                }
                i = end;
            } else {
                i += 1;
            }
        }
    }
    out
}

/// `[[Note]]` and `[[Note|alias]]` targets.
pub fn wikilinks(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        match after.find("]]") {
            Some(end) => {
                let inner = &after[..end];
                let target = inner.split('|').next().unwrap_or(inner).trim();
                if !target.is_empty() {
                    out.push(target.to_string());
                }
                rest = &after[end + 2..];
            }
            None => break,
        }
    }
    out
}

/// Split a body into question / answer. `?` on its own line is the primary
/// separator; a lone `---` is accepted because people reach for it naturally.
fn split_sides(body: &str) -> (String, String) {
    for sep in ["?", "---", "==="] {
        let mut offset = 0usize;
        for line in body.split_inclusive('\n') {
            if line.trim() == sep && offset > 0 {
                let front = body[..offset].trim().to_string();
                let back = body[offset + line.len()..].trim().to_string();
                if !front.is_empty() {
                    return (front, back);
                }
            }
            offset += line.len();
        }
    }
    (body.trim().to_string(), String::new())
}

/// First `# Heading` in the body, if the body starts with one.
fn leading_heading(body: &str) -> Option<String> {
    let first = body.trim_start().lines().next()?;
    let stripped = first.strip_prefix("# ")?;
    let title = stripped.trim();
    (!title.is_empty()).then(|| title.to_string())
}

/// Derive a display title from arbitrary text: first non-empty line, stripped
/// of Markdown noise, capped so it still works as a file name.
pub fn title_from_text(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let line = line
        .trim_start_matches('#')
        .trim_start_matches('>')
        .trim_start_matches(['-', '*', '+'])
        .trim();
    let mut title: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        // Cut at the last word boundary so the title does not end mid-word.
        if let Some(idx) = title.rfind(' ') {
            if idx > 20 {
                title.truncate(idx);
            }
        }
        title.push('…');
    }
    if title.is_empty() {
        "Untitled card".to_string()
    } else {
        title
    }
}

/// Parse a Markdown file into a card. `stem` is the file name without the
/// extension and is used as the fallback title.
pub fn parse(
    content: &str,
    rel_path: &str,
    stem: &str,
    fallback_time: DateTime<Utc>,
) -> ParsedCard {
    let (yaml, body) = split_frontmatter(content);
    let map: Mapping = yaml
        .and_then(|y| serde_yaml::from_str::<Value>(y).ok())
        .and_then(|v| match v {
            Value::Mapping(m) => Some(m),
            _ => None,
        })
        .unwrap_or_default();

    let get = |key: &str| -> Option<&Value> { map.get(Value::String(key.to_string())) };

    let kind = get("type")
        .and_then(yaml_string)
        .map(|s| CardKind::parse(&s))
        .unwrap_or_else(|| {
            // A file with no `type` is still a card if it has a `?` separator.
            let (_, back) = split_sides(body);
            if back.is_empty() {
                CardKind::Note
            } else {
                CardKind::Qa
            }
        });

    let (front, back) = if kind.reviewable() {
        split_sides(body)
    } else {
        (body.trim().to_string(), String::new())
    };

    let mut tags = get("tags").map(yaml_tags).unwrap_or_default();
    for t in inline_tags(body) {
        if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }

    let created = get("created").and_then(yaml_date).unwrap_or(fallback_time);
    let updated = get("updated").and_then(yaml_date).unwrap_or(created);

    let review = match get("review") {
        Some(Value::Mapping(r)) => {
            let rget = |k: &str| r.get(Value::String(k.to_string()));
            Review {
                due: rget("due").and_then(yaml_date).unwrap_or(updated),
                interval: rget("interval").and_then(yaml_f64).unwrap_or(0.0),
                ease: rget("ease").and_then(yaml_f64).unwrap_or(2.5),
                reps: rget("reps").and_then(yaml_f64).unwrap_or(0.0) as u32,
                lapses: rget("lapses").and_then(yaml_f64).unwrap_or(0.0) as u32,
            }
        }
        _ => Review {
            due: updated,
            ..Review::default()
        },
    };

    let title = get("title")
        .and_then(yaml_string)
        .filter(|t| !t.trim().is_empty())
        .or_else(|| leading_heading(body))
        .unwrap_or_else(|| {
            if stem.trim().is_empty() {
                title_from_text(&front)
            } else {
                stem.to_string()
            }
        });

    let extra: Mapping = map
        .iter()
        .filter(|(k, _)| match k {
            Value::String(s) => !OWNED_KEYS.contains(&s.as_str()),
            _ => true,
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    let card = Card {
        id: get("id")
            .and_then(yaml_string)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(crate::vault::new_id),
        kind,
        title,
        front,
        back,
        tags,
        deck: get("deck")
            .and_then(yaml_string)
            .filter(|s| !s.trim().is_empty()),
        created,
        updated,
        starred: get("starred")
            .and_then(|v| match v {
                Value::Bool(b) => Some(*b),
                Value::String(s) => Some(s.trim() == "true"),
                _ => None,
            })
            .unwrap_or(false),
        review,
        path: rel_path.to_string(),
        links: wikilinks(body),
    };

    ParsedCard { card, extra }
}

fn fmt_time(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Render a card back to Markdown, preserving frontmatter this app does not own.
pub fn to_markdown(card: &Card, extra: &Mapping) -> String {
    let mut fm = Mapping::new();
    let mut put = |k: &str, v: Value| {
        fm.insert(Value::String(k.to_string()), v);
    };

    put("id", Value::String(card.id.clone()));
    put("type", Value::String(card.kind.as_str().to_string()));
    if !card.tags.is_empty() {
        put(
            "tags",
            Value::Sequence(card.tags.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(deck) = &card.deck {
        put("deck", Value::String(deck.clone()));
    }
    put("created", Value::String(fmt_time(&card.created)));
    put("updated", Value::String(fmt_time(&card.updated)));
    if card.starred {
        put("starred", Value::Bool(true));
    }
    if card.kind.reviewable() {
        let mut r = Mapping::new();
        r.insert(
            Value::String("due".into()),
            Value::String(fmt_time(&card.review.due)),
        );
        r.insert(
            Value::String("interval".into()),
            Value::Number(((card.review.interval * 1000.0).round() / 1000.0).into()),
        );
        r.insert(
            Value::String("ease".into()),
            Value::Number(((card.review.ease * 100.0).round() / 100.0).into()),
        );
        r.insert(
            Value::String("reps".into()),
            Value::Number(card.review.reps.into()),
        );
        r.insert(
            Value::String("lapses".into()),
            Value::Number(card.review.lapses.into()),
        );
        put("review", Value::Mapping(r));
    }
    for (k, v) in extra.iter() {
        fm.insert(k.clone(), v.clone());
    }

    let yaml = serde_yaml::to_string(&Value::Mapping(fm))
        .unwrap_or_default()
        .trim_end()
        .to_string();

    let body = if card.kind.reviewable() && !card.back.trim().is_empty() {
        format!("{}\n\n?\n\n{}", card.front.trim(), card.back.trim())
    } else {
        card.front.trim().to_string()
    };

    format!("---\n{yaml}\n---\n\n{body}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap()
    }

    #[test]
    fn parses_a_plain_obsidian_note_without_frontmatter() {
        let parsed = parse("Just a thought #idea", "Cards/Note.md", "Note", now());
        assert_eq!(parsed.card.kind, CardKind::Note);
        assert_eq!(parsed.card.title, "Note");
        assert_eq!(parsed.card.tags, vec!["idea"]);
        assert!(parsed.card.back.is_empty());
    }

    #[test]
    fn detects_qa_from_the_question_separator_alone() {
        let parsed = parse("Capital of France?\n\n?\n\nParis", "a.md", "a", now());
        assert_eq!(parsed.card.kind, CardKind::Qa);
        assert_eq!(parsed.card.front, "Capital of France?");
        assert_eq!(parsed.card.back, "Paris");
    }

    #[test]
    fn round_trips_through_markdown_preserving_foreign_frontmatter() {
        let src = "---\nid: mc_1\ntype: qa\ntags: [physics]\ncssclass: wide\n---\n\nQ\n\n?\n\nA\n";
        let parsed = parse(src, "Cards/Q.md", "Q", now());
        assert_eq!(parsed.card.id, "mc_1");
        let out = to_markdown(&parsed.card, &parsed.extra);
        assert!(out.contains("cssclass: wide"), "foreign key dropped: {out}");
        let again = parse(&out, "Cards/Q.md", "Q", now());
        assert_eq!(again.card.front, "Q");
        assert_eq!(again.card.back, "A");
        assert_eq!(again.card.tags, vec!["physics"]);
    }

    #[test]
    fn headings_are_not_tags_and_code_blocks_are_skipped() {
        let body = "# Heading\n\n```\n#notatag\n```\n\n#real/tag";
        assert_eq!(inline_tags(body), vec!["real/tag"]);
    }

    #[test]
    fn keeps_wikilinks_for_the_connections_view() {
        assert_eq!(
            wikilinks("see [[Wave|waves]] and [[Optics]]"),
            vec!["Wave", "Optics"]
        );
    }

    #[test]
    fn long_capture_text_becomes_a_readable_title() {
        let text = "The quick brown fox jumps over the lazy dog while everyone watches quietly";
        let title = title_from_text(text);
        assert!(title.chars().count() <= 61, "{title}");
        assert!(title.ends_with('…'));
    }
}
