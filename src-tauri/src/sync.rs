//! Three-way sync between the local cards folder and a remote Git repository.
//!
//! The algorithm is the ordinary one: for every path, compare what is on disk,
//! what is on the remote, and what was there at the end of the last sync. Two
//! sides agreeing means nothing to do; one side moving means copy it across;
//! both sides moving means a conflict, and a conflict is resolved by keeping
//! **both** versions rather than choosing for the user.
//!
//! Everything here is expressed against the [`Remote`] trait, so the merge
//! logic is tested against an in-memory fake and never needs the network.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use crate::error::{Error, Result};

/// Files above this size are left out of the sync. GitHub's blob API accepts
/// more, but a repository is not a photo library, and a single huge file
/// failing would take the whole commit with it.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Does this file take part in the sync?
///
/// Cards themselves, and anything the cards attach. Other files a user keeps
/// in the folder are none of the app's business.
pub fn syncable(relative_name: &str) -> bool {
    let name = relative_name.replace('\\', "/");
    if name.split('/').any(|part| part.starts_with('.')) {
        return false;
    }
    name.ends_with(".md") || name.starts_with("attachments/")
}

/// Git's object id for a blob: `sha1("blob <len>\0<content>")`.
///
/// Computing it locally means a file that already matches the remote is
/// recognised without downloading anything.
pub fn blob_sha(content: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", content.len()).as_bytes());
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

/// A file in the remote repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    /// Path relative to the repository root.
    pub path: String,
    pub sha: String,
}

/// A change to apply to the remote in a single commit.
///
/// Content is bytes, not text: a card is UTF-8 Markdown but a photo attached
/// to it is not, and both have to reach the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Write { path: String, content: Vec<u8> },
    Delete { path: String },
}

/// The remote side of a sync. Implemented by the GitHub client, and by a fake
/// in the tests.
pub trait Remote {
    /// Every file under `prefix`, with its blob sha.
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>>;
    /// The raw bytes of one blob.
    fn read(&self, path: &str, sha: &str) -> Result<Vec<u8>>;
    /// Apply all changes as one commit. Returns the new commit sha.
    fn commit(&self, changes: &[Change], message: &str) -> Result<String>;
}

/// What the last sync left behind, so the next one can tell which side moved.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncState {
    /// Path (relative to the repo root) -> blob sha at the end of the last sync.
    #[serde(default)]
    pub base: BTreeMap<String, String>,
    #[serde(default)]
    pub last_commit: Option<String>,
    #[serde(default)]
    pub last_synced: Option<String>,
}

/// What a sync did, in terms the UI can show without interpretation.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SyncReport {
    pub pulled: usize,
    pub pushed: usize,
    pub deleted_local: usize,
    pub deleted_remote: usize,
    /// File names where both sides had changed; both versions were kept.
    pub conflicts: Vec<String>,
    pub commit: Option<String>,
    /// One sentence for the toast, filled in by [`sync`].
    pub summary: String,
}

impl SyncReport {
    pub fn is_empty(&self) -> bool {
        self.pulled == 0
            && self.pushed == 0
            && self.deleted_local == 0
            && self.deleted_remote == 0
            && self.conflicts.is_empty()
    }

    /// One sentence for the toast, phrased for someone who does not use git.
    fn summary_text(&self) -> String {
        if self.is_empty() {
            return "Already up to date".to_string();
        }
        let mut parts = Vec::new();
        if self.pulled > 0 {
            parts.push(format!("{} in", self.pulled));
        }
        if self.pushed > 0 {
            parts.push(format!("{} out", self.pushed));
        }
        let removed = self.deleted_local + self.deleted_remote;
        if removed > 0 {
            parts.push(format!("{removed} removed"));
        }
        if !self.conflicts.is_empty() {
            parts.push(format!("{} kept both ways", self.conflicts.len()));
        }
        format!("Synced — {}", parts.join(", "))
    }
}

/// Where local files live during a sync.
pub struct LocalTree {
    /// Folder whose contents are mirrored, e.g. the vault's `Cards` folder.
    pub dir: PathBuf,
    /// Prefix that folder has inside the repository, e.g. `Cards`.
    pub prefix: String,
}

impl LocalTree {
    pub fn new(dir: impl Into<PathBuf>, prefix: &str) -> Self {
        LocalTree {
            dir: dir.into(),
            prefix: prefix.trim().trim_matches('/').to_string(),
        }
    }

    fn repo_path(&self, name: &str) -> String {
        if self.prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}/{}", self.prefix, name)
        }
    }

    /// A repository path without the folder prefix, e.g.
    /// `Cards/attachments/a.jpg` -> `attachments/a.jpg`.
    fn relative_name<'a>(&self, repo_path: &'a str) -> &'a str {
        if self.prefix.is_empty() {
            repo_path
        } else {
            repo_path
                .strip_prefix(&format!("{}/", self.prefix))
                .unwrap_or(repo_path)
        }
    }

    fn local_path(&self, repo_path: &str) -> PathBuf {
        let relative = match self.prefix.is_empty() {
            true => repo_path,
            false => repo_path
                .strip_prefix(&format!("{}/", self.prefix))
                .unwrap_or(repo_path),
        };
        self.dir.join(relative)
    }

    /// Every file the sync carries, keyed by repository path.
    ///
    /// Cards are Markdown; everything inside `attachments/` comes too, so a
    /// card that embeds a photo does not arrive on another device with the
    /// photo missing.
    fn scan(&self) -> Result<BTreeMap<String, String>> {
        let mut out = BTreeMap::new();
        if !self.dir.exists() {
            return Ok(out);
        }
        for entry in walkdir::WalkDir::new(&self.dir)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let Ok(relative) = path.strip_prefix(&self.dir) else {
                continue;
            };
            let name = relative.to_string_lossy().replace('\\', "/");
            if !syncable(&name) {
                continue;
            }
            // A file too big for the API would fail the whole commit; skipping
            // it keeps the rest of the sync working.
            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                continue;
            }
            out.insert(self.repo_path(&name), blob_sha_of_file(path)?);
        }
        Ok(out)
    }
}

fn blob_sha_of_file(path: &Path) -> Result<String> {
    Ok(blob_sha(&fs::read(path)?))
}

/// Name for the copy kept when both sides changed the same file.
fn conflict_name(repo_path: &str, stamp: &str) -> String {
    let (dir, file) = match repo_path.rsplit_once('/') {
        Some((d, f)) => (format!("{d}/"), f),
        None => (String::new(), repo_path),
    };
    // Keep the extension: a conflicted photo is still a photo.
    let (stem, extension) = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (file, String::new()),
    };
    format!("{dir}{stem} (from GitHub {stamp}){extension}")
}

/// Run one full sync: pull remote changes into `local`, then push local
/// changes back in a single commit.
pub fn sync(
    local: &LocalTree,
    remote: &dyn Remote,
    state: &mut SyncState,
    stamp: &str,
) -> Result<SyncReport> {
    let local_files = local.scan()?;
    let remote_files: BTreeMap<String, String> = remote
        .list(&local.prefix)?
        .into_iter()
        .filter(|f| syncable(local.relative_name(&f.path)))
        .map(|f| (f.path, f.sha))
        .collect();

    let mut report = SyncReport::default();
    let mut changes: Vec<Change> = Vec::new();
    let mut next_base: BTreeMap<String, String> = BTreeMap::new();

    let paths: BTreeSet<&String> = local_files
        .keys()
        .chain(remote_files.keys())
        .chain(state.base.keys())
        .collect();

    for path in paths {
        let local_sha = local_files.get(path);
        let remote_sha = remote_files.get(path);
        let base_sha = state.base.get(path);

        match (local_sha, remote_sha) {
            // Both sides identical: nothing to do.
            (Some(l), Some(r)) if l == r => {
                next_base.insert(path.clone(), l.clone());
            }

            // Both sides present and different.
            (Some(l), Some(r)) => {
                let local_moved = base_sha != Some(l);
                let remote_moved = base_sha != Some(r);
                if remote_moved && !local_moved {
                    write_local(local, path, &remote.read(path, r)?)?;
                    report.pulled += 1;
                    next_base.insert(path.clone(), r.clone());
                } else if local_moved && !remote_moved {
                    let content = fs::read(local.local_path(path))?;
                    changes.push(Change::Write {
                        path: path.clone(),
                        content,
                    });
                    report.pushed += 1;
                    next_base.insert(path.clone(), l.clone());
                } else {
                    // Both moved: keep the local version at the original path
                    // and park the remote version beside it. Nothing is lost
                    // and the user sees both cards in the app.
                    let copy = conflict_name(path, stamp);
                    let remote_content = remote.read(path, r)?;
                    write_local(local, &copy, &remote_content)?;
                    changes.push(Change::Write {
                        path: copy.clone(),
                        content: remote_content.clone(),
                    });
                    let content = fs::read(local.local_path(path))?;
                    changes.push(Change::Write {
                        path: path.clone(),
                        content,
                    });
                    report.conflicts.push(display_name(path));
                    report.pushed += 1;
                    next_base.insert(path.clone(), l.clone());
                    next_base.insert(copy, blob_sha(&remote_content));
                }
            }

            // Only local has it: new here, or deleted on the remote.
            (Some(l), None) => {
                if base_sha.is_some() && base_sha == Some(l) {
                    // Unchanged locally and gone from the remote: delete here.
                    remove_local(local, path)?;
                    report.deleted_local += 1;
                } else {
                    let content = fs::read(local.local_path(path))?;
                    changes.push(Change::Write {
                        path: path.clone(),
                        content,
                    });
                    report.pushed += 1;
                    next_base.insert(path.clone(), l.clone());
                }
            }

            // Only the remote has it: new there, or deleted here.
            (None, Some(r)) => {
                if base_sha.is_some() && base_sha == Some(r) {
                    changes.push(Change::Delete { path: path.clone() });
                    report.deleted_remote += 1;
                } else {
                    write_local(local, path, &remote.read(path, r)?)?;
                    report.pulled += 1;
                    next_base.insert(path.clone(), r.clone());
                }
            }

            // Gone from both sides: drop it from the base.
            (None, None) => {}
        }
    }

    if !changes.is_empty() {
        let message = commit_message(&report);
        let commit = remote.commit(&changes, &message)?;
        report.commit = Some(commit.clone());
        state.last_commit = Some(commit);
    }

    state.base = next_base;
    state.last_synced = Some(stamp.to_string());
    report.summary = report.summary_text();
    Ok(report)
}

fn display_name(repo_path: &str) -> String {
    repo_path
        .rsplit('/')
        .next()
        .unwrap_or(repo_path)
        .trim_end_matches(".md")
        .to_string()
}

fn commit_message(report: &SyncReport) -> String {
    let mut parts = Vec::new();
    if report.pushed > 0 {
        parts.push(format!(
            "{} file{}",
            report.pushed,
            if report.pushed == 1 { "" } else { "s" }
        ));
    }
    if report.deleted_remote > 0 {
        parts.push(format!("{} deleted", report.deleted_remote));
    }
    if parts.is_empty() {
        "Micro Card sync".to_string()
    } else {
        format!("Micro Card: {}", parts.join(", "))
    }
}

fn write_local(local: &LocalTree, repo_path: &str, content: &[u8]) -> Result<()> {
    let path = local.local_path(repo_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, content)?;
    Ok(())
}

fn remove_local(local: &LocalTree, repo_path: &str) -> Result<()> {
    let path = local.local_path(repo_path);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// Turn a `owner/repo` string, a browser URL or a clone URL into its parts.
pub fn parse_repo(input: &str) -> Result<(String, String)> {
    let cleaned = input
        .trim()
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .replace("https://github.com/", "")
        .replace("http://github.com/", "")
        .replace("git@github.com:", "");
    let mut parts = cleaned.split('/').filter(|p| !p.is_empty());
    match (parts.next(), parts.next()) {
        (Some(owner), Some(repo)) => Ok((owner.to_string(), repo.to_string())),
        _ => Err(Error::msg(
            "That does not look like a repository. Use owner/repo, for example octocat/notes.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// An in-memory remote, so the merge logic is tested without a network.
    struct FakeRemote {
        files: RefCell<HashMap<String, Vec<u8>>>,
        commits: RefCell<Vec<String>>,
    }

    impl FakeRemote {
        fn new(files: &[(&str, &str)]) -> Self {
            FakeRemote {
                files: RefCell::new(
                    files
                        .iter()
                        .map(|(p, c)| (p.to_string(), c.as_bytes().to_vec()))
                        .collect(),
                ),
                commits: RefCell::new(Vec::new()),
            }
        }
        /// Text content, for the majority of tests that deal in cards.
        fn content(&self, path: &str) -> Option<String> {
            self.bytes(path)
                .map(|b| String::from_utf8_lossy(&b).to_string())
        }
        fn bytes(&self, path: &str) -> Option<Vec<u8>> {
            self.files.borrow().get(path).cloned()
        }
        fn put(&self, path: &str, content: &[u8]) {
            self.files
                .borrow_mut()
                .insert(path.to_string(), content.to_vec());
        }
    }

    impl Remote for FakeRemote {
        fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>> {
            Ok(self
                .files
                .borrow()
                .iter()
                .filter(|(p, _)| prefix.is_empty() || p.starts_with(prefix))
                .map(|(p, c)| RemoteFile {
                    path: p.clone(),
                    sha: blob_sha(c),
                })
                .collect())
        }
        fn read(&self, path: &str, _sha: &str) -> Result<Vec<u8>> {
            self.files
                .borrow()
                .get(path)
                .cloned()
                .ok_or_else(|| Error::NotFound(path.to_string()))
        }
        fn commit(&self, changes: &[Change], message: &str) -> Result<String> {
            let mut files = self.files.borrow_mut();
            for change in changes {
                match change {
                    Change::Write { path, content } => {
                        files.insert(path.clone(), content.clone());
                    }
                    Change::Delete { path } => {
                        files.remove(path);
                    }
                }
            }
            self.commits.borrow_mut().push(message.to_string());
            Ok(format!("commit{}", self.commits.borrow().len()))
        }
    }

    struct Fixture {
        root: PathBuf,
        tree: LocalTree,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "micro-card-sync-{}-{}",
                name,
                crate::vault::new_id()
            ));
            let dir = root.join("Cards");
            fs::create_dir_all(&dir).unwrap();
            Fixture {
                tree: LocalTree::new(dir, "Cards"),
                root,
            }
        }
        fn write(&self, name: &str, content: &str) {
            self.write_bytes(name, content.as_bytes());
        }
        fn write_bytes(&self, name: &str, content: &[u8]) {
            let path = self.tree.dir.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        fn read(&self, name: &str) -> Option<String> {
            fs::read_to_string(self.tree.dir.join(name)).ok()
        }
        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.tree.dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).ok();
        }
    }

    #[test]
    fn blob_sha_matches_git() {
        // `printf '' | git hash-object --stdin` and the same for "hello\n".
        assert_eq!(blob_sha(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
        assert_eq!(
            blob_sha(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn a_new_local_card_is_pushed() {
        let fx = Fixture::new("push");
        fx.write("One.md", "first card");
        let remote = FakeRemote::new(&[]);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "2026-01-01").unwrap();

        assert_eq!(report.pushed, 1);
        assert_eq!(
            remote.content("Cards/One.md").as_deref(),
            Some("first card")
        );
        assert_eq!(state.base.len(), 1);
    }

    #[test]
    fn a_new_remote_card_is_pulled() {
        let fx = Fixture::new("pull");
        let remote = FakeRemote::new(&[("Cards/Two.md", "from the repo")]);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "2026-01-01").unwrap();

        assert_eq!(report.pulled, 1);
        assert_eq!(fx.read("Two.md").as_deref(), Some("from the repo"));
    }

    #[test]
    fn an_unchanged_pair_of_files_produces_no_commit() {
        let fx = Fixture::new("noop");
        fx.write("Same.md", "identical");
        let remote = FakeRemote::new(&[("Cards/Same.md", "identical")]);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "2026-01-01").unwrap();

        assert!(report.is_empty(), "{report:?}");
        assert_eq!(report.commit, None);
        assert_eq!(report.summary, "Already up to date");
    }

    #[test]
    fn an_edit_on_one_side_only_travels_to_the_other() {
        let fx = Fixture::new("one-sided");
        fx.write("Card.md", "v1");
        let remote = FakeRemote::new(&[("Cards/Card.md", "v1")]);
        let mut state = SyncState::default();
        sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        // Remote moves on; local does not.
        remote.put("Cards/Card.md", b"v2 from the web");
        let report = sync(&fx.tree, &remote, &mut state, "t1").unwrap();
        assert_eq!(report.pulled, 1);
        assert_eq!(fx.read("Card.md").as_deref(), Some("v2 from the web"));

        // Now local moves on; the remote does not.
        fx.write("Card.md", "v3 from the phone");
        let report = sync(&fx.tree, &remote, &mut state, "t2").unwrap();
        assert_eq!(report.pushed, 1);
        assert_eq!(
            remote.content("Cards/Card.md").as_deref(),
            Some("v3 from the phone")
        );
    }

    #[test]
    fn a_card_edited_on_both_sides_keeps_both_versions() {
        let fx = Fixture::new("conflict");
        fx.write("Card.md", "shared start");
        let remote = FakeRemote::new(&[("Cards/Card.md", "shared start")]);
        let mut state = SyncState::default();
        sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        fx.write("Card.md", "edited on the phone");
        remote.put("Cards/Card.md", b"edited on the web");

        let report = sync(&fx.tree, &remote, &mut state, "2026-01-02").unwrap();

        assert_eq!(report.conflicts, vec!["Card"]);
        // Local keeps its own version at the original name...
        assert_eq!(fx.read("Card.md").as_deref(), Some("edited on the phone"));
        // ...and the other version is kept beside it, on both sides.
        let copy = "Card (from GitHub 2026-01-02).md";
        assert_eq!(fx.read(copy).as_deref(), Some("edited on the web"));
        assert_eq!(
            remote.content(&format!("Cards/{copy}")).as_deref(),
            Some("edited on the web")
        );
        assert_eq!(
            remote.content("Cards/Card.md").as_deref(),
            Some("edited on the phone")
        );
        // A second sync has nothing left to do.
        let again = sync(&fx.tree, &remote, &mut state, "2026-01-03").unwrap();
        assert!(again.is_empty(), "{again:?}");
    }

    #[test]
    fn deleting_locally_deletes_on_the_remote() {
        let fx = Fixture::new("delete-local");
        fx.write("Gone.md", "bye");
        let remote = FakeRemote::new(&[]);
        let mut state = SyncState::default();
        sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        fs::remove_file(fx.tree.dir.join("Gone.md")).unwrap();
        let report = sync(&fx.tree, &remote, &mut state, "t1").unwrap();

        assert_eq!(report.deleted_remote, 1);
        assert_eq!(remote.content("Cards/Gone.md"), None);
        assert!(state.base.is_empty());
    }

    #[test]
    fn deleting_on_the_remote_deletes_locally() {
        let fx = Fixture::new("delete-remote");
        fx.write("Gone.md", "bye");
        let remote = FakeRemote::new(&[]);
        let mut state = SyncState::default();
        sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        remote.files.borrow_mut().remove("Cards/Gone.md");
        let report = sync(&fx.tree, &remote, &mut state, "t1").unwrap();

        assert_eq!(report.deleted_local, 1);
        assert!(fx.read("Gone.md").is_none());
        assert_eq!(fx.names(), Vec::<String>::new());
    }

    #[test]
    fn a_card_deleted_locally_but_edited_remotely_comes_back_rather_than_vanishing() {
        let fx = Fixture::new("delete-vs-edit");
        fx.write("Contested.md", "start");
        let remote = FakeRemote::new(&[("Cards/Contested.md", "start")]);
        let mut state = SyncState::default();
        sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        fs::remove_file(fx.tree.dir.join("Contested.md")).unwrap();
        remote.put("Cards/Contested.md", b"someone kept working");

        let report = sync(&fx.tree, &remote, &mut state, "t1").unwrap();

        // Losing someone else's work to a local delete would be unforgivable.
        assert_eq!(report.pulled, 1);
        assert_eq!(
            fx.read("Contested.md").as_deref(),
            Some("someone kept working")
        );
    }

    #[test]
    fn cards_and_their_attachments_sync_but_stray_files_do_not() {
        let fx = Fixture::new("filter");
        fx.write("Card.md", "yes");
        fx.write("notes.txt", "not a card");
        // A loose image beside the cards is somebody else's file.
        let remote = FakeRemote::new(&[("Cards/image.png", "stray")]);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        assert_eq!(report.pushed, 1);
        assert_eq!(report.pulled, 0);
        assert!(remote.content("Cards/notes.txt").is_none());
        assert!(fx.read("image.png").is_none());
    }

    #[test]
    fn a_photo_attached_to_a_card_travels_with_it() {
        let fx = Fixture::new("attachments");
        fx.write("Holiday.md", "Look at this\n\n![[beach.jpg]]");
        // Bytes that are not valid UTF-8, as a real photo would be.
        let photo: Vec<u8> = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        fx.write_bytes("attachments/beach.jpg", &photo);
        let remote = FakeRemote::new(&[]);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        assert_eq!(report.pushed, 2, "the card and its photo");
        assert_eq!(
            remote.bytes("Cards/attachments/beach.jpg").as_deref(),
            Some(photo.as_slice()),
            "the photo must arrive byte for byte"
        );
    }

    #[test]
    fn a_photo_added_on_another_device_is_pulled_down_intact() {
        let fx = Fixture::new("pull-photo");
        let photo: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0x00];
        let remote = FakeRemote::new(&[]);
        remote.put("Cards/attachments/diagram.png", &photo);
        let mut state = SyncState::default();

        let report = sync(&fx.tree, &remote, &mut state, "t0").unwrap();

        assert_eq!(report.pulled, 1);
        assert_eq!(
            fs::read(fx.tree.dir.join("attachments/diagram.png")).unwrap(),
            photo
        );
    }

    #[test]
    fn a_conflicted_photo_keeps_its_extension() {
        assert_eq!(
            conflict_name("Cards/attachments/beach.jpg", "2026-01-02"),
            "Cards/attachments/beach (from GitHub 2026-01-02).jpg"
        );
        assert_eq!(
            conflict_name("Cards/Note.md", "2026-01-02"),
            "Cards/Note (from GitHub 2026-01-02).md"
        );
    }

    #[test]
    fn hidden_files_and_stray_types_are_left_alone() {
        assert!(syncable("Card.md"));
        assert!(syncable("attachments/photo.jpg"));
        assert!(!syncable("notes.txt"));
        assert!(!syncable(".obsidian/workspace.json"));
        assert!(!syncable("attachments/.DS_Store"));
    }

    #[test]
    fn understands_every_shape_of_repository_reference() {
        for input in [
            "octocat/notes",
            "https://github.com/octocat/notes",
            "https://github.com/octocat/notes.git",
            "git@github.com:octocat/notes.git",
            "  octocat/notes/  ",
        ] {
            let (owner, repo) = parse_repo(input).unwrap();
            assert_eq!(
                (owner.as_str(), repo.as_str()),
                ("octocat", "notes"),
                "{input}"
            );
        }
        assert!(parse_repo("notes").is_err());
    }

    #[test]
    fn the_summary_reads_like_a_sentence() {
        let report = SyncReport {
            pulled: 2,
            pushed: 1,
            deleted_remote: 1,
            ..Default::default()
        };
        assert_eq!(report.summary_text(), "Synced — 2 in, 1 out, 1 removed");
    }
}
