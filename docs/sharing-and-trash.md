# Sharing into the app, and getting cards back

Two small features that decide whether the app is actually used: how quickly
something you are reading becomes a card, and what happens when you delete the
wrong one.

## Share → Micro Card

On Android, Micro Card registers as a share target for plain text. Reading an
article, an email or a chat message, you tap **Share**, pick Micro Card, and
the capture sheet opens with the text already in it. No copy, no app switch, no
paste.

If the sending app supplies a subject — a page title, an email subject — it
becomes the first line, because that is almost always the better title:

```
How memory actually works          ← EXTRA_SUBJECT

Spaced repetition works because    ← EXTRA_TEXT
retrieval is what strengthens a
memory, not re-reading.
```

### How it is wired

`scripts/patch-android.mjs` adds two things to the generated Android project:

1. an `<intent-filter>` on the main activity for `ACTION_SEND` with
   `text/plain`, which is what puts Micro Card in the share sheet;
2. a `MainActivity.kt` that reads `EXTRA_TEXT` and `EXTRA_SUBJECT` and writes
   them to `shared-capture.json` in the app's own files directory.

The Rust command `take_shared_text` reads that file **and deletes it**, so the
same text is never captured twice. The UI calls it on launch and every time
the app returns to the foreground — which is exactly when Android hands a share
over, whether the app was running or not.

Handing the text across as a file avoids any JNI plumbing between Kotlin and
Rust for what is a single string, and it means the whole path after the
activity is ordinary, testable code.

> The Kotlin half only compiles in an Android build, so it is exercised in CI
> rather than in the unit tests. Everything downstream of the file — reading
> it, clearing it, prefilling the editor — is tested, and can be tried on any
> platform by writing `shared-capture.json` into the app's data directory by
> hand.

## Recently deleted

Deleting a card shows a toast with **Undo**, which covers the mistake you
notice immediately. **Settings → Recently deleted** covers the one you notice
on Thursday.

Deleted cards are moved to the vault's `.trash` folder — the same folder
Obsidian uses, so there is no second copy and no hidden database. From that
screen you can:

- **restore** a card, which moves the file back into the cards folder;
- **delete one for good**, which removes the file;
- **empty the trash**, which asks once and then removes everything.

The "delete for good" path refuses any path that is not inside `.trash`. It is
the only operation in the app with no undo, so it must not be reachable for a
live card even by accident — there is a test for exactly that.

## Merging duplicates

While you write, Micro Card quietly checks whether you already have a card
saying much the same thing (word overlap, ignoring short filler words). If you
do, it says so above the Save button — a note, never a dialog in the way.

When editing an existing card, that warning also offers **Merge into one
card**: the card you are editing absorbs the others' tags and any text it does
not already contain, and they go to the trash, where they can be restored. Two
identical cards merge into one card that says the thing once.
