# The card file format

A card is a Markdown file. Nothing else. If Micro Card disappeared tomorrow, the
files would still be readable, editable and useful in Obsidian, in a text
editor, or in `grep`.

## Anatomy

```markdown
---
id: mc_1kq3f9x2h4a
type: qa
tags:
  - physics
  - card
deck: Optics
created: 2026-09-10T08:14:03Z
updated: 2026-09-10T08:14:03Z
review:
  due: 2026-09-11T08:14:03Z
  interval: 1
  ease: 2.5
  reps: 0
  lapses: 0
---

What is a wavelength?

?

The distance between two successive crests of a wave.
```

### Frontmatter keys

| Key | Meaning |
| --- | --- |
| `id` | Stable identity. Survives renames, so a card edited in Obsidian is still the same card. |
| `type` | `note`, `qa`, `idea`, `quote` or `task`. Only `qa` cards take part in review. |
| `tags` | A list. Inline `#tags` in the body are read as well and merged in. |
| `deck` | Optional grouping. Free text; anything without one is shown as *Inbox*. |
| `created` / `updated` | RFC 3339 timestamps. |
| `starred` | Written only when true. |
| `review` | SM-2 state: `due`, `interval` (days), `ease`, `reps`, `lapses`. |

**Any other key is left alone.** If Dataview, Templater or your own workflow
writes `cssclass`, `aliases` or `publish` into a card, Micro Card reads around
it and writes it back untouched.

### The `?` separator

Question and answer are split by a line containing only `?`. This is the
convention used by the [Obsidian Spaced Repetition
plugin](https://github.com/st3v3nmw/obsidian-spaced-repetition), so a vault full
of Micro Card cards is also a working deck in Obsidian itself.

A lone `---` or `===` line is accepted when reading, because people reach for
those naturally. Files are always written with `?`.

## What Micro Card infers

The format is forgiving on purpose — a note you wrote in Obsidian long before
installing this app is still a valid card:

- **No frontmatter at all?** Still a card. The file name becomes the title and
  the modification time becomes `created`.
- **No `type`, but a `?` separator?** Treated as a Q & A card.
- **No `id`?** One is generated the first time the card is saved.
- **No title?** The first `# heading` is used, then the file name, then the
  first line of the text.

## File names

The file name follows the title, so a vault stays browsable in any file manager.
Characters Obsidian rejects (`/ \ : * ? " < > | # ^ [ ]`) are replaced with
spaces, names are capped at 80 characters, and a collision appends ` 2`, ` 3` and
so on — a save never overwrites a file that belongs to someone else.

Renaming a card's title moves the file rather than leaving a duplicate behind.
The `id` in the frontmatter is what actually identifies the card.

## Tags

Both of these produce the tag `physics`:

```markdown
---
tags: [physics]
---
```

```markdown
This is about #physics.
```

Headings are not tags: `# Physics` is a heading because of the space, and
fenced code blocks are skipped entirely, so `#include <stdio.h>` in a code
sample never becomes a tag.
