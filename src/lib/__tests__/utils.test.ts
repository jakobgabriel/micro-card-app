import { describe, expect, it } from "vitest";

import type { Card } from "../types";
import {
  backlinks,
  linkNameFor,
  pendingLink,
  suggestLinks,
  extractInlineTags,
  plainText,
  prefixLines,
  resolveLink,
  searchCards,
  untilDue,
  wrapSelection,
} from "../utils";

function card(overrides: Partial<Card> = {}): Card {
  const now = new Date().toISOString();
  return {
    id: "id",
    kind: "note",
    title: "Title",
    front: "Front",
    back: "",
    tags: [],
    deck: null,
    created: now,
    updated: now,
    starred: false,
    review: { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
    path: "Cards/Title.md",
    links: [],
    ...overrides,
  };
}

describe("searchCards", () => {
  const cards = [
    card({ id: "a", title: "Wavelength", front: "Distance between crests", tags: ["physics"] }),
    card({ id: "b", title: "Sourdough", front: "Needs a warm kitchen", deck: "Cooking" }),
  ];

  it("matches on any part of a card", () => {
    expect(searchCards(cards, "crests").map((c) => c.id)).toEqual(["a"]);
    expect(searchCards(cards, "kitchen").map((c) => c.id)).toEqual(["b"]);
  });

  it("requires every term to match, not just one", () => {
    expect(searchCards(cards, "warm kitchen")).toHaveLength(1);
    expect(searchCards(cards, "warm crests")).toHaveLength(0);
  });

  it("understands #tag and deck: prefixes", () => {
    expect(searchCards(cards, "#physics").map((c) => c.id)).toEqual(["a"]);
    expect(searchCards(cards, "deck:cooking").map((c) => c.id)).toEqual(["b"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchCards(cards, "   ")).toHaveLength(2);
  });
});

describe("plainText", () => {
  it("strips the markdown a preview should not show", () => {
    expect(plainText("# Heading\n\n**bold** and `code`")).toBe("Heading bold and code");
  });

  it("keeps the target of a wikilink but drops an embedded file", () => {
    expect(plainText("see [[Optics|the notes]] and ![[photo.png]]")).toBe("see Optics and");
  });

  it("drops fenced code blocks entirely", () => {
    expect(plainText("before\n\n```\nnoise()\n```\n\nafter")).toBe("before after");
  });
});

describe("extractInlineTags", () => {
  it("finds tags but not headings", () => {
    expect(extractInlineTags("# Heading about #physics and #wave-optics")).toEqual([
      "physics",
      "wave-optics",
    ]);
  });

  it("ignores a hash that is part of a word", () => {
    expect(extractInlineTags("issue#42")).toEqual([]);
  });
});

describe("links between cards", () => {
  const target = card({ id: "t", title: "Optics", path: "Cards/Optics.md" });
  const other = card({ id: "o", title: "Lenses", links: ["Optics"] });

  it("resolves a wikilink by file name or title", () => {
    expect(resolveLink([target], "Optics")?.id).toBe("t");
    expect(resolveLink([target], "optics")?.id).toBe("t");
    expect(resolveLink([target], "Nothing")).toBeUndefined();
  });

  it("finds the cards pointing at one", () => {
    expect(backlinks([target, other], target).map((c) => c.id)).toEqual(["o"]);
    expect(backlinks([target, other], other)).toHaveLength(0);
  });
});

describe("editor formatting", () => {
  function textarea(value: string, start: number, end: number) {
    return { value, selectionStart: start, selectionEnd: end } as HTMLTextAreaElement;
  }

  it("wraps the selection and leaves the cursor after it", () => {
    const result = wrapSelection(textarea("make bold please", 5, 9), "**");
    expect(result.text).toBe("make **bold** please");
    expect(result.cursor).toBe(13);
  });

  it("places the cursor between the markers when nothing is selected", () => {
    const result = wrapSelection(textarea("ab", 1, 1), "**");
    expect(result.text).toBe("a****b");
    expect(result.cursor).toBe(3);
  });

  it("prefixes every selected line, and un-prefixes them again", () => {
    const bulleted = prefixLines(textarea("one\ntwo", 0, 7), "- ");
    expect(bulleted.text).toBe("- one\n- two");
    const plain = prefixLines(textarea(bulleted.text, 0, bulleted.text.length), "- ");
    expect(plain.text).toBe("one\ntwo");
  });
});

describe("untilDue", () => {
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  it("phrases intervals the way the review buttons need", () => {
    expect(untilDue(new Date(Date.now() + 30_000).toISOString())).toBe("now");
    expect(untilDue(inDays(3))).toBe("3 d");
    expect(untilDue(inDays(60))).toBe("2 mo");
    expect(untilDue(inDays(400))).toBe("1 y");
  });
});

describe("wikilink autocomplete", () => {
  it("spots an unfinished link at the caret", () => {
    const text = "see [[opt";
    expect(pendingLink(text, text.length)).toEqual({ query: "opt", start: 4 });
  });

  it("ignores a link that is already closed", () => {
    const text = "see [[Optics]] now";
    expect(pendingLink(text, text.length)).toBeNull();
  });

  it("does not run across a line break", () => {
    const text = "see [[\nlater";
    expect(pendingLink(text, text.length)).toBeNull();
  });

  it("offers everything when nothing has been typed yet", () => {
    const text = "see [[";
    expect(pendingLink(text, text.length)).toEqual({ query: "", start: 4 });
  });

  it("ranks a title that starts with the query above one that merely contains it", () => {
    const cards = [
      card({ id: "a", title: "Advanced optics" }),
      card({ id: "b", title: "Optics" }),
      card({ id: "c", title: "Cooking", front: "mentions optics once" }),
    ];
    expect(suggestLinks(cards, "optics").map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("links by file name, which is what Obsidian resolves", () => {
    expect(linkNameFor(card({ title: "Shown", path: "Cards/On disk.md" }))).toBe("On disk");
  });
});
