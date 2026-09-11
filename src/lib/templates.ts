/**
 * Card templates.
 *
 * A blank box is the right default for a quick thought, but it is the wrong
 * one when you sit down to take notes on a book or a meeting — then the useful
 * thing is a shape to fill in. These are starting points, not forms: every
 * line can be deleted.
 */
import type { CardKind } from "./types";

export interface Template {
  id: string;
  name: string;
  description: string;
  kind: CardKind;
  /** Pre-filled body. */
  front: string;
  back?: string;
  tags?: string[];
  deck?: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "book",
    name: "Book note",
    description: "One idea from something you read, with the source attached",
    kind: "note",
    front: "## The idea\n\n\n## Why it matters\n\n\n## Source\n\nTitle, author, page",
    tags: ["reading"],
  },
  {
    id: "meeting",
    name: "Meeting",
    description: "What was decided, and what you owe someone",
    kind: "note",
    front: "## Decided\n\n- \n\n## My next step\n\n- \n\n## Open question\n\n- ",
    tags: ["meeting"],
  },
  {
    id: "vocab",
    name: "Vocabulary",
    description: "A word and its meaning, ready to review",
    kind: "qa",
    front: "",
    back: "",
    tags: ["vocabulary"],
  },
  {
    id: "person",
    name: "Person",
    description: "Who they are and how you know them",
    kind: "note",
    front: "## Who\n\n\n## How we met\n\n\n## Worth remembering\n\n",
    tags: ["people"],
  },
  {
    id: "recipe",
    name: "Recipe",
    description: "Ingredients and steps, in the order you cook them",
    kind: "note",
    front: "## Ingredients\n\n- \n\n## Steps\n\n1. \n\n## Notes\n\n",
    tags: ["recipe"],
  },
];
