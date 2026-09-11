//! GitHub client: the [`Remote`] implementation backing repository sync.
//!
//! Uses the Git Data API rather than the Contents API so that any number of
//! changed cards lands as **one** commit, the way a person syncing from a
//! laptop would produce one. The flow is the standard plumbing sequence:
//! read the branch ref, create blobs, build a tree on top of the existing one,
//! create a commit, then move the ref.

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::sync::{Change, Remote, RemoteFile};

const API: &str = "https://api.github.com";
const USER_AGENT: &str = "MicroCard";

/// Everything needed to talk to one repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub owner: String,
    pub repo: String,
    #[serde(default = "default_branch")]
    pub branch: String,
}

fn default_branch() -> String {
    "main".to_string()
}

/// What the connection test found, shown to the user before they commit to it.
#[derive(Debug, Clone, Serialize)]
pub struct RepoInfo {
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    pub can_write: bool,
    /// Markdown files already in the chosen folder.
    pub existing_cards: usize,
}

pub struct GitHub {
    client: reqwest::blocking::Client,
    token: String,
    config: RepoConfig,
    /// Overridden by the tests to point at a local mock server.
    api_base: String,
}

/// Turn an HTTP failure into something a person can act on. GitHub's own
/// messages are developer-facing, so the common cases are translated.
fn explain(status: reqwest::StatusCode, body: &str, context: &str) -> Error {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    let message = match status.as_u16() {
        401 => "GitHub rejected the token. Create a new one and paste it again.".to_string(),
        403 if detail.contains("rate limit") => {
            "GitHub is rate limiting this token. Try again in a few minutes.".to_string()
        }
        403 => "That token is not allowed to write to this repository. Give it \
                Contents: Read and write access."
            .to_string(),
        404 => "Repository or branch not found. Check the name, and make sure the \
                token can see private repositories if this one is private."
            .to_string(),
        409 => "The repository is empty. Add a first file on GitHub (a README is \
                enough) and sync again."
            .to_string(),
        422 if detail.is_empty() => format!("GitHub refused the change ({context})."),
        _ if !detail.is_empty() => format!("GitHub: {detail}"),
        code => format!("GitHub returned {code} ({context})."),
    };
    Error::Message(message)
}

impl GitHub {
    pub fn new(token: impl Into<String>, config: RepoConfig) -> Result<Self> {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| Error::msg(format!("Could not start the network client: {e}")))?;
        Ok(GitHub {
            client,
            token: token.into(),
            config,
            api_base: API.to_string(),
        })
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, url)
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    fn get_json(&self, path: &str, context: &str) -> Result<serde_json::Value> {
        let url = format!("{}{path}", self.api_base);
        let response = self
            .request(reqwest::Method::GET, &url)
            .send()
            .map_err(network_error)?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(explain(status, &body, context));
        }
        serde_json::from_str(&body).map_err(|e| Error::msg(format!("Unexpected reply: {e}")))
    }

    fn post_json(
        &self,
        method: reqwest::Method,
        path: &str,
        payload: serde_json::Value,
        context: &str,
    ) -> Result<serde_json::Value> {
        let url = format!("{}{path}", self.api_base);
        let response = self
            .request(method, &url)
            .json(&payload)
            .send()
            .map_err(network_error)?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(explain(status, &body, context));
        }
        serde_json::from_str(&body).map_err(|e| Error::msg(format!("Unexpected reply: {e}")))
    }

    /// Check the token and the repository before the user relies on them.
    pub fn probe(&self, folder: &str) -> Result<RepoInfo> {
        let repo = self.get_json(
            &format!("/repos/{}/{}", self.config.owner, self.config.repo),
            "looking up the repository",
        )?;
        let permissions = repo.get("permissions");
        let can_write = permissions
            .and_then(|p| p.get("push"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let default_branch = repo
            .get("default_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("main")
            .to_string();

        // An empty repository has no tree yet; that is not an error here.
        let existing_cards = self.list(folder).map(|f| f.len()).unwrap_or(0);

        Ok(RepoInfo {
            full_name: repo
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            private: repo
                .get("private")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            default_branch,
            can_write,
            existing_cards,
        })
    }

    /// The commit the branch currently points at, if the branch exists.
    fn head_commit(&self) -> Result<Option<String>> {
        let path = format!(
            "/repos/{}/{}/git/ref/heads/{}",
            self.config.owner, self.config.repo, self.config.branch
        );
        match self.get_json(&path, "reading the branch") {
            Ok(value) => Ok(value
                .get("object")
                .and_then(|o| o.get("sha"))
                .and_then(|s| s.as_str())
                .map(String::from)),
            // A branch that does not exist yet is a normal starting state.
            Err(Error::Message(m)) if m.contains("not found") => Ok(None),
            Err(err) => Err(err),
        }
    }
}

fn is_markdown(path: &str) -> bool {
    path.to_lowercase().ends_with(".md")
}

fn network_error(err: reqwest::Error) -> Error {
    if err.is_timeout() {
        Error::msg("GitHub did not answer in time. Check your connection and try again.")
    } else if err.is_connect() {
        Error::msg("Could not reach GitHub. Are you online?")
    } else {
        Error::msg("The connection to GitHub failed. Try again in a moment.")
    }
}

impl Remote for GitHub {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>> {
        let path = format!(
            "/repos/{}/{}/git/trees/{}?recursive=1",
            self.config.owner, self.config.repo, self.config.branch
        );
        let tree = match self.get_json(&path, "listing the repository") {
            Ok(value) => value,
            // No branch yet: an empty repository syncs as "nothing there".
            Err(Error::Message(m)) if m.contains("not found") || m.contains("empty") => {
                return Ok(Vec::new())
            }
            Err(err) => return Err(err),
        };

        let prefix = prefix.trim().trim_matches('/');
        let entries = tree
            .get("tree")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(entries
            .into_iter()
            .filter(|entry| entry.get("type").and_then(|t| t.as_str()) == Some("blob"))
            .filter_map(|entry| {
                let path = entry.get("path")?.as_str()?.to_string();
                let sha = entry.get("sha")?.as_str()?.to_string();
                Some(RemoteFile { path, sha })
            })
            .filter(|file| prefix.is_empty() || file.path.starts_with(&format!("{prefix}/")))
            .collect())
    }

    fn read(&self, _path: &str, sha: &str) -> Result<Vec<u8>> {
        let blob = self.get_json(
            &format!(
                "/repos/{}/{}/git/blobs/{sha}",
                self.config.owner, self.config.repo
            ),
            "downloading a file",
        )?;
        let content = blob
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            // GitHub wraps its base64 at 60 characters.
            .replace(['\n', '\r'], "");
        base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|_| Error::msg("A file on GitHub could not be decoded."))
    }

    fn commit(&self, changes: &[Change], message: &str) -> Result<String> {
        let owner = &self.config.owner;
        let repo = &self.config.repo;
        let parent = self.head_commit()?;

        // Blobs first: each one is uploaded, then referenced by the tree.
        let mut entries = Vec::new();
        for change in changes {
            match change {
                Change::Write { path, content } => {
                    // Text goes up as text so the repository has readable
                    // diffs; a photo has to be base64.
                    let payload = match std::str::from_utf8(content) {
                        Ok(text) if is_markdown(path) => {
                            serde_json::json!({ "content": text, "encoding": "utf-8" })
                        }
                        _ => serde_json::json!({
                            "content": base64::engine::general_purpose::STANDARD.encode(content),
                            "encoding": "base64",
                        }),
                    };
                    let blob = self.post_json(
                        reqwest::Method::POST,
                        &format!("/repos/{owner}/{repo}/git/blobs"),
                        payload,
                        "uploading a file",
                    )?;
                    let sha = blob
                        .get("sha")
                        .and_then(|s| s.as_str())
                        .ok_or_else(|| Error::msg("GitHub did not return a file id."))?;
                    entries.push(serde_json::json!({
                        "path": path,
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha,
                    }));
                }
                // A null sha in a tree entry is how the Git API spells "remove".
                Change::Delete { path } => entries.push(serde_json::json!({
                    "path": path,
                    "mode": "100644",
                    "type": "blob",
                    "sha": serde_json::Value::Null,
                })),
            }
        }

        let mut tree_payload = serde_json::json!({ "tree": entries });
        if let Some(parent_sha) = &parent {
            let parent_commit = self.get_json(
                &format!("/repos/{owner}/{repo}/git/commits/{parent_sha}"),
                "reading the last commit",
            )?;
            if let Some(base) = parent_commit
                .get("tree")
                .and_then(|t| t.get("sha"))
                .and_then(|s| s.as_str())
            {
                tree_payload["base_tree"] = serde_json::json!(base);
            }
        }

        let tree = self.post_json(
            reqwest::Method::POST,
            &format!("/repos/{owner}/{repo}/git/trees"),
            tree_payload,
            "preparing the commit",
        )?;
        let tree_sha = tree
            .get("sha")
            .and_then(|s| s.as_str())
            .ok_or_else(|| Error::msg("GitHub did not return a tree id."))?;

        let mut commit_payload = serde_json::json!({ "message": message, "tree": tree_sha });
        if let Some(parent_sha) = &parent {
            commit_payload["parents"] = serde_json::json!([parent_sha]);
        }
        let commit = self.post_json(
            reqwest::Method::POST,
            &format!("/repos/{owner}/{repo}/git/commits"),
            commit_payload,
            "creating the commit",
        )?;
        let commit_sha = commit
            .get("sha")
            .and_then(|s| s.as_str())
            .ok_or_else(|| Error::msg("GitHub did not return a commit id."))?
            .to_string();

        // Move the branch. Creating it when it does not exist covers the
        // "brand new repository" case without a special path through the UI.
        let ref_path = format!("/repos/{owner}/{repo}/git/refs");
        if parent.is_some() {
            self.post_json(
                reqwest::Method::PATCH,
                &format!("{ref_path}/heads/{}", self.config.branch),
                serde_json::json!({ "sha": commit_sha, "force": false }),
                "updating the branch",
            )?;
        } else {
            self.post_json(
                reqwest::Method::POST,
                &ref_path,
                serde_json::json!({
                    "ref": format!("refs/heads/{}", self.config.branch),
                    "sha": commit_sha,
                }),
                "creating the branch",
            )?;
        }

        Ok(commit_sha)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// A throwaway HTTP server that answers a fixed script of requests and
    /// reports back what it was asked for. Enough to pin down the wire format
    /// without ever touching the real API.
    struct MockApi {
        base: String,
        seen: mpsc::Receiver<(String, String, String)>,
        handle: Option<std::thread::JoinHandle<()>>,
    }

    impl MockApi {
        fn start(responses: Vec<(u16, String)>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let (tx, rx) = mpsc::channel();
            let handle = std::thread::spawn(move || {
                for (index, (status, body)) in responses.into_iter().enumerate() {
                    let Ok((mut stream, _)) = listener.accept() else {
                        return;
                    };
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut request_line = String::new();
                    reader.read_line(&mut request_line).unwrap();
                    let mut parts = request_line.split_whitespace();
                    let method = parts.next().unwrap_or("").to_string();
                    let path = parts.next().unwrap_or("").to_string();

                    // Read headers, then the body if one was announced.
                    let mut length = 0usize;
                    loop {
                        let mut line = String::new();
                        reader.read_line(&mut line).unwrap();
                        if line.trim().is_empty() {
                            break;
                        }
                        if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                            length = value.trim().parse().unwrap_or(0);
                        }
                    }
                    let mut payload = vec![0u8; length];
                    if length > 0 {
                        reader.read_exact(&mut payload).unwrap();
                    }
                    let _ = tx.send((method, path, String::from_utf8_lossy(&payload).to_string()));

                    let response = format!(
                        "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(response.as_bytes()).unwrap();
                    stream.flush().unwrap();
                    let _ = index;
                }
            });
            MockApi {
                base: format!("http://127.0.0.1:{port}"),
                seen: rx,
                handle: Some(handle),
            }
        }

        fn client(&self) -> GitHub {
            let mut github = GitHub::new(
                "test-token",
                RepoConfig {
                    owner: "octocat".into(),
                    repo: "notes".into(),
                    branch: "main".into(),
                },
            )
            .unwrap();
            github.api_base = self.base.clone();
            github
        }

        fn next(&self) -> (String, String, String) {
            self.seen
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the client should have made another request")
        }
    }

    impl Drop for MockApi {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    #[test]
    fn http_failures_are_explained_in_plain_words() {
        let unauthorised = explain(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"message":"Bad credentials"}"#,
            "x",
        );
        assert!(unauthorised.to_string().contains("rejected the token"));

        let missing = explain(reqwest::StatusCode::NOT_FOUND, "{}", "x");
        assert!(missing.to_string().contains("not found"));

        let forbidden = explain(reqwest::StatusCode::FORBIDDEN, "{}", "x");
        assert!(forbidden.to_string().contains("Contents: Read and write"));
    }

    #[test]
    fn listing_reads_the_tree_and_keeps_only_the_cards_folder() {
        let tree = serde_json::json!({
            "tree": [
                { "type": "blob", "path": "README.md", "sha": "aaa" },
                { "type": "blob", "path": "Cards/One.md", "sha": "bbb" },
                { "type": "tree", "path": "Cards", "sha": "ccc" },
                { "type": "blob", "path": "Cards/deep/Two.md", "sha": "ddd" },
            ]
        })
        .to_string();
        let mock = MockApi::start(vec![(200, tree)]);

        let files = mock.client().list("Cards").unwrap();

        let (method, path, _) = mock.next();
        assert_eq!(method, "GET");
        assert!(path.contains("/git/trees/main?recursive=1"), "{path}");
        assert_eq!(files.len(), 2, "{files:?}");
        assert!(files.iter().all(|f| f.path.starts_with("Cards/")));
    }

    #[test]
    fn reading_a_blob_decodes_githubs_wrapped_base64() {
        // GitHub wraps base64 at 60 characters; the newlines must be stripped.
        let encoded = "SGVsbG8sIGNhcmRzIQ==";
        let body = serde_json::json!({ "content": format!("{encoded}\n"), "encoding": "base64" })
            .to_string();
        let mock = MockApi::start(vec![(200, body)]);

        let bytes = mock.client().read("Cards/One.md", "bbb").unwrap();

        assert_eq!(bytes, b"Hello, cards!");
        let (_, path, _) = mock.next();
        assert!(path.ends_with("/git/blobs/bbb"), "{path}");
    }

    #[test]
    fn one_commit_is_built_from_blobs_a_tree_and_a_ref_update() {
        let mock = MockApi::start(vec![
            // ref -> head commit
            (
                200,
                serde_json::json!({ "object": { "sha": "parent-sha" } }).to_string(),
            ),
            // blob for the written card
            (201, serde_json::json!({ "sha": "blob-sha" }).to_string()),
            // parent commit, for its tree
            (
                200,
                serde_json::json!({ "tree": { "sha": "base-tree" } }).to_string(),
            ),
            // new tree
            (201, serde_json::json!({ "sha": "tree-sha" }).to_string()),
            // new commit
            (201, serde_json::json!({ "sha": "commit-sha" }).to_string()),
            // ref update
            (
                200,
                serde_json::json!({ "object": { "sha": "commit-sha" } }).to_string(),
            ),
        ]);

        let changes = vec![
            Change::Write {
                path: "Cards/New.md".into(),
                content: b"hello".to_vec(),
            },
            Change::Delete {
                path: "Cards/Old.md".into(),
            },
        ];
        let commit = mock
            .client()
            .commit(&changes, "Micro Card: 1 card")
            .unwrap();
        assert_eq!(commit, "commit-sha");

        let (_, ref_path, _) = mock.next();
        assert!(ref_path.contains("/git/ref/heads/main"), "{ref_path}");

        let (method, blob_path, blob_body) = mock.next();
        assert_eq!(method, "POST");
        assert!(blob_path.ends_with("/git/blobs"), "{blob_path}");
        assert!(blob_body.contains("hello"), "{blob_body}");

        let (_, parent_path, _) = mock.next();
        assert!(
            parent_path.contains("/git/commits/parent-sha"),
            "{parent_path}"
        );

        let (_, tree_path, tree_body) = mock.next();
        assert!(tree_path.ends_with("/git/trees"), "{tree_path}");
        assert!(
            tree_body.contains("base-tree"),
            "the tree must build on the last one"
        );
        assert!(tree_body.contains("\"sha\":\"blob-sha\""), "{tree_body}");
        // A null sha is how the Git API spells "delete this path".
        assert!(tree_body.contains("Cards/Old.md"), "{tree_body}");
        assert!(tree_body.contains("null"), "{tree_body}");

        let (_, commit_path, commit_body) = mock.next();
        assert!(commit_path.ends_with("/git/commits"), "{commit_path}");
        assert!(
            commit_body.contains("parent-sha"),
            "the commit must have a parent"
        );

        let (method, update_path, _) = mock.next();
        assert_eq!(method, "PATCH", "an existing branch is moved, not created");
        assert!(
            update_path.ends_with("/git/refs/heads/main"),
            "{update_path}"
        );
    }

    #[test]
    fn a_photo_goes_up_as_base64_while_a_card_stays_readable_text() {
        let mock = MockApi::start(vec![
            (
                200,
                serde_json::json!({ "object": { "sha": "parent-sha" } }).to_string(),
            ),
            (201, serde_json::json!({ "sha": "card-blob" }).to_string()),
            (201, serde_json::json!({ "sha": "photo-blob" }).to_string()),
            (
                200,
                serde_json::json!({ "tree": { "sha": "base-tree" } }).to_string(),
            ),
            (201, serde_json::json!({ "sha": "tree-sha" }).to_string()),
            (201, serde_json::json!({ "sha": "commit-sha" }).to_string()),
            (
                200,
                serde_json::json!({ "object": { "sha": "commit-sha" } }).to_string(),
            ),
        ]);

        // Bytes that are not valid UTF-8 — a JPEG header.
        let photo = vec![0xFFu8, 0xD8, 0xFF, 0xE0];
        let changes = vec![
            Change::Write {
                path: "Cards/Note.md".into(),
                content: "# A card\n".as_bytes().to_vec(),
            },
            Change::Write {
                path: "Cards/attachments/beach.jpg".into(),
                content: photo.clone(),
            },
        ];
        mock.client().commit(&changes, "with a photo").unwrap();

        mock.next(); // branch ref

        let (_, _, card_body) = mock.next();
        assert!(card_body.contains("\"encoding\":\"utf-8\""), "{card_body}");
        assert!(
            card_body.contains("# A card"),
            "a card stays readable: {card_body}"
        );

        let (_, _, photo_body) = mock.next();
        assert!(
            photo_body.contains("\"encoding\":\"base64\""),
            "{photo_body}"
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(&photo);
        assert!(photo_body.contains(&encoded), "{photo_body}");
    }

    #[test]
    fn an_empty_repository_gets_its_branch_created() {
        let mock = MockApi::start(vec![
            // No branch yet.
            (
                404,
                serde_json::json!({ "message": "Not Found" }).to_string(),
            ),
            (201, serde_json::json!({ "sha": "blob-sha" }).to_string()),
            (201, serde_json::json!({ "sha": "tree-sha" }).to_string()),
            (201, serde_json::json!({ "sha": "commit-sha" }).to_string()),
            (
                201,
                serde_json::json!({ "ref": "refs/heads/main" }).to_string(),
            ),
        ]);

        let changes = vec![Change::Write {
            path: "Cards/First.md".into(),
            content: b"first".to_vec(),
        }];
        assert_eq!(
            mock.client().commit(&changes, "first").unwrap(),
            "commit-sha"
        );

        mock.next(); // ref lookup
        mock.next(); // blob
        let (_, _, tree_body) = mock.next();
        assert!(
            !tree_body.contains("base_tree"),
            "there is no tree to build on yet: {tree_body}"
        );
        let (_, _, commit_body) = mock.next();
        assert!(
            !commit_body.contains("parents"),
            "the first commit has no parent: {commit_body}"
        );
        let (method, path, _) = mock.next();
        assert_eq!(method, "POST", "a missing branch is created, not patched");
        assert!(path.ends_with("/git/refs"), "{path}");
    }

    #[test]
    fn a_token_never_appears_in_an_error_message() {
        // Errors are surfaced to the UI and may be copied into a bug report.
        let err = explain(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"message":"Bad credentials"}"#,
            "ghp_secrettokenvalue",
        );
        assert!(!err.to_string().contains("ghp_"));
    }
}
