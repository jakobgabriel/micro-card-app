# Syncing with a GitHub repository

Cards are Markdown files, which makes a Git repository a natural home for
them: every change becomes a commit, and you get the entire history of your
thinking for free.

GitHub sync is an **alternative** to an Obsidian vault, not a replacement for
the file-based model. It can also run *alongside* a vault, which is how people
who already keep their vault in Git end up using it.

## Setting it up

1. **Create a token.** On GitHub: *Settings → Developer settings → Personal
   access tokens → Fine-grained tokens*. Give it access to the single
   repository you want to use, and set **Contents** to **Read and write**.
   The in-app setup screen links straight to that page.
2. **Paste it into Micro Card**, along with `owner/repo`. A full URL or a clone
   URL works too.
3. **Connect.** Nothing is stored until GitHub confirms the token can actually
   write to the repository — a read-only token is refused with an explanation
   rather than accepted and then failing at the first save.

An empty repository is fine: Micro Card creates the first commit and the
branch. An existing repository keeps everything it already has — cards are
only ever written inside the configured folder (`Cards` by default).

## Where the token is kept

In `credentials.json` in the app's private storage, separate from
`settings.json`, with `0600` permissions on Unix. It is never written into a
card, never included in an error message, and never sent anywhere except
`api.github.com`.

To remove it, use **Disconnect** in Settings — that deletes the token and the
sync state. Your cards stay exactly where they are, on both sides.

## What a sync actually does

One commit per sync, built with the Git Data API:

```
read branch ref ─▶ upload blobs ─▶ build tree on the last one
                                        │
                        create commit ◀─┘
                                │
                        move branch ref
```

Deletions are expressed as a tree entry with a `null` sha, which is how Git
spells "this path is gone".

Before pushing, Micro Card pulls. For every file it compares three things:

| On this phone | In the repository | Result |
| --- | --- | --- |
| unchanged | unchanged | nothing to do |
| unchanged | changed | pulled down |
| changed | unchanged | pushed up |
| changed | changed | **both kept** (see below) |
| new | absent | pushed up |
| absent | new | pulled down |
| deleted | unchanged | deleted in the repository |
| unchanged | deleted | deleted here |
| deleted | changed | **pulled back** — someone's work is never dropped |

The same table governs an attached photo; a conflicted one keeps its
extension, so `beach.jpg` becomes `beach (from GitHub 2026-09-11 14-32).jpg`
rather than something no viewer will open.

"Unchanged" means *the same as at the end of the last sync*, recorded in
`sync-state.json` as the Git blob sha of each file. Micro Card computes that
sha locally (`sha1("blob <len>\0<content>")`), so a file that already matches
the repository is recognised without downloading anything.

### Conflicts keep both versions

When a card changed on the phone *and* in the repository, there is no good way
to guess which one matters — so neither is thrown away. The local version stays
at its original name, the repository's version is saved beside it as
`Card (from GitHub 2026-09-11 14-32).md`, and both are pushed. You end up with
two cards in the app, can see the difference, and delete the one you do not
want.

## When it syncs

- On launch, a moment after the library loads.
- When the app returns to the foreground.
- A few seconds after a change, so a burst of edits becomes one commit.
- Whenever you tap **Sync now** in Settings, or the repository row on the home
  screen.

Automatic syncing can be turned off; the manual button always works.

A sync that fails while running automatically stays silent — being offline is
not an error worth interrupting someone for. A sync you asked for reports what
went wrong, in plain words: a rejected token, a repository that cannot be
found, a rate limit, or no connection at all.

## Using it together with Obsidian

These are independent: the vault setting decides *where the files live on this
device*, and the GitHub setting decides *which repository those files are
mirrored to*. Pointing the app at a vault that is itself a Git repository, and
connecting the same repository here, means the phone and the desktop commit to
the same history.

## What travels

Cards, and the photos they embed. A card that says `![[beach.jpg]]` is useless
without `beach.jpg`, so `attachments/` syncs alongside the Markdown: text goes
up as text, so the repository keeps readable diffs, and a photo goes up as
base64, because that is what the Git API takes.

Other files you keep in the same folder are none of the app's business and are
left alone, as is anything starting with a dot.

## Limits worth knowing

- Files over 20 MB are skipped. GitHub's API would take more, but a repository
  is not a photo library, and one oversized file failing would take the whole
  commit with it.
- Every sync is a full listing of the folder's tree plus the blobs that
  changed, which is comfortably inside GitHub's rate limits for personal use,
  but it is not designed for tens of thousands of cards.
- There is no merge of two edits to the *same* card — the conflict rule above
  applies instead. Merging prose automatically tends to produce text that
  nobody wrote.
