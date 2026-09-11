# How Obsidian sync works

Short version: **there is no sync.** There is one copy of your data — the files
in your vault — and both apps read and write it.

## The model

Most note apps keep an internal database and reconcile it with files on a timer.
That is where conflicts, duplicates and "why is my note from Tuesday back?" come
from. Micro Card does not have an internal copy:

- **Read** — the cards folder is walked and every `.md` file is parsed.
- **Write** — saving a card writes that one file, immediately.
- **Cache** — the parsed cards are held in memory only to make the list fast.
  It is rebuilt from the files, never merged into them.

## When it re-reads

| Moment | What happens |
| --- | --- |
| App launch | Full scan of the cards folder. |
| Returning to the foreground | Full scan — this is what picks up edits made in Obsidian or arriving over Obsidian Sync / Syncthing. |
| Pull-to-refresh in Settings | Full scan on demand. |
| After any save, delete or grade | Full scan, so the list reflects what is actually on disk. |

Scanning is limited to the cards folder (`Cards` by default), not the whole
vault. Micro Card never takes over notes you keep elsewhere.

## Writes are atomic

Every save writes to a temporary file and then renames it over the target. A
sync client reading the folder mid-write sees either the old file or the new
one, never half of either. If a storage provider refuses the rename — some
Android providers do — the write falls back to a direct write rather than
failing.

## Conflicts

Because the files are the only copy, the usual conflict class disappears: there
is no stale in-app version to overwrite a newer file with. What remains is the
ordinary case of two devices editing the same file at once, which is your sync
tool's job:

- **Obsidian Sync** keeps both versions and offers a merge.
- **Syncthing** writes a `sync-conflict` copy next to the original.
- **Git-based workflows** report a normal merge conflict.

Micro Card picks up whatever the sync tool leaves behind on the next scan, and a
conflict copy simply shows up as an extra card — visible, not lost.

## Deletion

Deleting a card moves the file into the vault's `.trash` folder, which is the
same place Obsidian puts deleted notes. The toast that appears offers **Undo**,
which moves it straight back. Nothing is destroyed by the app; emptying `.trash`
stays your decision.

## Interoperability

- Cards use the `?` separator of the [Obsidian Spaced Repetition
  plugin](https://github.com/st3v3nmw/obsidian-spaced-repetition), so the same
  files work as a deck inside Obsidian.
- `[[Wikilinks]]` in a card body are parsed and shown, so cards can point into
  the rest of your vault.
- Frontmatter written by other plugins is preserved verbatim on save.
- Every card carries the configurable `#card` tag, which makes
  `tag:#card` a complete Obsidian query for everything this app created.

## Local mode

Without a vault, cards go to the app's private storage — still as Markdown
files, in the same layout. Connecting a vault later copies every card across and
removes the local originals only after each file has been written successfully.
Nothing is deleted on failure.

## Android storage permissions

Shared storage is not readable by default on modern Android. Micro Card needs
**All files access** (`MANAGE_EXTERNAL_STORAGE`) to open a vault that lives in,
say, `/storage/emulated/0/Documents/My Vault`.

Grant it under **Settings → Apps → Micro Card → Permissions → Files and media →
Allow management of all files.**

Connecting a vault probes it with a real write first, so a missing permission is
reported immediately, in plain words, instead of silently losing a card later.

If you would rather not grant it, two options keep working without any storage
permission at all: local mode (the app's own folder) and
[GitHub sync](github-sync.md), which only needs network access.
