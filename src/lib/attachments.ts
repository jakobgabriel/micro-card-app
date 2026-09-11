/**
 * Attaching a photo (or any file) to a card.
 *
 * On Android the file picker hands back a `content://` URI that only the
 * platform can read, so the bytes are read here through the fs plugin and
 * passed to Rust — rather than passing a path Rust would fail to open.
 */
import { api } from "./api";
import type { Attachment } from "./types";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "svg"];

export function isImage(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(extension);
}

/** Open the picker, copy what was chosen into the vault, and return its name. */
export async function pickAttachment(): Promise<Attachment | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [
      { name: "Images", extensions: IMAGE_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (typeof picked !== "string") return null;

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(picked);
  const filename = picked.split(/[\\/]/).pop() || "attachment";
  return api.addAttachment(filename, Array.from(bytes));
}

/**
 * A URL the webview can load for a file in the attachments folder.
 *
 * Falls back to an empty string outside Tauri, where the browser has no way to
 * reach the filesystem — callers render a placeholder instead.
 */
export async function attachmentUrl(dir: string, name: string): Promise<string> {
  if (!("__TAURI_INTERNALS__" in window)) return "";
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    // `dir` is absolute and platform-shaped already; only the separator differs.
    const separator = dir.includes("\\") ? "\\" : "/";
    return convertFileSrc(`${dir}${separator}${name}`);
  } catch {
    return "";
  }
}
