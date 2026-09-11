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

## The limit worth knowing

**GitHub sync does not carry attachments.** The sync engine deals in Markdown
files; a photo stays on the device that took it. On a vault synced by Obsidian
Sync, Syncthing or any folder sync, attachments travel like any other file.

If a card arrives on another device without its photo, the card is intact and
the embed shows the placeholder with the file name — enough to know what is
missing.
