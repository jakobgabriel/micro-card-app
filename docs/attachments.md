# Photos and other attachments

A card can hold a photo: a whiteboard, a page of a book, a diagram you would
never retype. The file is copied into the vault next to the cards, and the card
references it with Obsidian's own embed syntax.

## How it is stored

```
My Vault/
└── Cards/
    ├── Lecture on optics.md      ← contains ![[whiteboard.jpg]]
    └── attachments/
        └── whiteboard.jpg
```

`attachments/` is a plain sub-folder of the cards folder, so Obsidian resolves
`![[whiteboard.jpg]]` without any configuration, and a file manager shows
exactly what you would expect.

File names are cleaned the same way card names are — the characters Obsidian
rejects are replaced, a leading dot is dropped so the photo is not hidden, and
a name that is already taken gets ` 2` appended rather than overwriting
someone else's file.

## Why the bytes go through the frontend

On Android the file picker returns a `content://` URI, which only the platform
can read — `std::fs` cannot open it. So the app reads the bytes on the
JavaScript side through Tauri's fs plugin, which understands those URIs, and
passes them to the `add_attachment` command. Rust then writes the file into the
vault. Picking a path and handing it to Rust would work on a desktop and fail
on a phone.

## Why images need a special URL

A webview cannot load `/home/you/vault/Cards/attachments/photo.jpg` directly.
Tauri's asset protocol exists for this, and it only serves directories that
have been allowed. The vault is chosen at runtime, so the allowance cannot live
in `tauri.conf.json` — it is granted at startup and re-granted whenever the
vault changes, which is why a photo attached before switching vaults still
renders afterwards.

An image that cannot be loaded — no vault access, a file that did not travel
with the card, a browser preview — renders as a small labelled placeholder
rather than a broken image icon.

## Attachments and sync

They travel. On a vault synced by Obsidian Sync, Syncthing or any folder sync,
an attachment is just another file in the folder. Through
[GitHub sync](github-sync.md) it is committed alongside the card — as a base64
blob, since a JPEG is not text — so a card and its photo arrive together.

Files over 20 MB are skipped rather than risking the commit; everything else in
`attachments/` goes.

If a card ever does arrive without its photo, the card is intact and the embed
shows a placeholder with the file name — enough to know what is missing.

## Tidying up

Deleting a card does not delete the photo it embedded: the file might be used
by another card, and guessing wrong would destroy something. **Settings → Your
cards → Unused photos** finds the files nothing points at any more, shows how
much space they take, and moves them to the vault's `.trash` — recoverable,
like every other delete in the app.

This matters most with a repository connected, where an orphaned photo is dead
weight in the history forever.
