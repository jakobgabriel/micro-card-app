# Micro Card

**Card-style knowledge capture for Android, built with Tauri — every card is a
plain Markdown note in your own Obsidian vault.**

Write down one idea. Find it again months later. Micro Card is the fastest path
between a thought and a note you actually keep, and it never takes your data
hostage: there is no account, no database and no proprietary format. Cards *are*
files, sitting in the vault you already sync.

<p align="center">
  <img src="docs/screenshots/home.png" width="30%" alt="Home screen" />
  <img src="docs/screenshots/capture.png" width="30%" alt="Capture editor" />
  <img src="docs/screenshots/review.png" width="30%" alt="Review session" />
</p>

## What it does

| | |
| --- | --- |
| **Capture in seconds** | One big text box, focused before the keyboard finishes animating. Type, hit save. Everything else — type, tags, deck — is optional and one tap away. |
| **Five kinds of card** | Note, Q & A, Idea, Quote, To-do. Same file format; only the presentation and whether it comes back for review differ. |
| **Real Obsidian sync** | The vault is the database. Micro Card reads and writes the `.md` files directly, so an edit in Obsidian shows up here and vice versa. |
| **Spaced repetition** | Q & A cards come back when you are about to forget them. Three grades, each showing when the card returns — no guessing. |
| **Nothing to lose** | Drafts survive a crash, deletes are undoable and land in the vault's `.trash`, and unknown frontmatter written by other plugins is preserved on save. |
| **Works before setup** | No vault? Start capturing anyway. Connect one later and every card moves across. |

## How the sync works

There is no sync engine, because there is nothing to sync: a card is a file.

```
My Vault/                    ← the folder Obsidian opens
├── .obsidian/               ← how Micro Card recognises a vault
├── .trash/                  ← deleted cards land here, same as Obsidian
└── Cards/                   ← configurable; new cards are written here
    ├── What makes a card atomic.md
    └── Capture beats organising.md
```

Micro Card re-reads the folder on launch and every time the app returns to the
foreground, so anything you (or Obsidian Sync, or Syncthing) changed in the
meantime is picked up. Saving writes the file atomically — temp file, then
rename — so a half-written card can never reach your vault.

See [`docs/card-format.md`](docs/card-format.md) for the file format and
[`docs/obsidian-sync.md`](docs/obsidian-sync.md) for the sync and conflict
behaviour in detail.

## Getting started

### Requirements

- Node.js 20+
- Rust (stable)
- For Android: JDK 17, the Android SDK and NDK r27, with `ANDROID_HOME` and
  `NDK_HOME` set
- Linux desktop builds also need the usual Tauri system libraries
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`)

### Run it

```sh
npm install

npm run dev            # frontend only, in a browser, with demo data
npm run tauri dev      # the real app on your desktop
```

`npm run dev` in a plain browser runs against an in-memory stub, so you can
click through every screen without a vault.

### Build the Android app

```sh
npm run android:init   # generates gen/android, then patches the manifest
npm run android:dev    # run on a connected device or emulator
npm run android:build  # release APK
```

`src-tauri/gen/android` is generated, not committed. `scripts/patch-android.mjs`
adds what the template does not: storage permissions for reading a vault outside
the app sandbox, legacy external storage for Android 10, and `adjustResize` so
the keyboard never covers the editor. Re-run it after any `android init`.

The `Android APK` workflow builds a debug APK on demand or on a `v*` tag.

### Granting storage access on Android

An Obsidian vault normally lives in shared storage, which Android does not open
up by default. After the first launch:

**Settings → Apps → Micro Card → Permissions → Files and media → Allow
management of all files.**

Micro Card checks that the folder is writable when you connect it and says so
immediately if it is not — you will never find out at the first lost card. If
you would rather not grant it, keep using local mode: cards stay in the app's
own storage and can be moved into a vault later without losing anything.

## Project layout

```
src/                     React + Tailwind UI
├── components/          Sheets, toasts, card tiles, the Markdown renderer
├── screens/             Onboarding, Home, Library, Review, Settings
└── lib/                 Store, backend API, types, browser demo fallback

src-tauri/src/           Rust core
├── markdown.rs          Frontmatter + body parsing and serialisation
├── vault.rs             Scanning, atomic writes, trash, vault detection
├── state.rs             Settings, card cache, review journal, streaks
├── commands.rs          The commands the UI calls
└── model.rs             Card, Review (SM-2), Settings
```

## Testing

```sh
npm run build                         # typecheck + production bundle
cd src-tauri && cargo test            # Markdown round trips, vault, streaks
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

## Design notes

The card metaphor, the tool-grid launcher and the violet/amber palette come from
[cardforge-buddy-creator](https://github.com/jakobgabriel/cardforge-buddy-creator).
That project designed cards to be *printed*; this one designs them to be
*remembered*, and the interface was rebuilt around a thumb rather than a mouse:
one primary action per screen, 48px touch targets, bottom-anchored controls,
swipe-to-grade, undo instead of confirmation dialogs, and no jargon anywhere in
the interface — the words "frontmatter", "YAML" and "vault path" never appear in
front of a first-time user.
