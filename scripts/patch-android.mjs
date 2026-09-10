#!/usr/bin/env node
/**
 * `tauri android init` regenerates `src-tauri/gen/android` from a template, so
 * anything Micro Card needs on top of it is applied here instead of being
 * committed. Run automatically by `npm run android:init`; safe to re-run.
 *
 * What it adds:
 *  - storage permissions, so the app can read and write an Obsidian vault that
 *    lives outside its own sandbox;
 *  - `requestLegacyExternalStorage`, which keeps plain file access working on
 *    Android 10 devices;
 *  - a portrait-locked, resize-aware activity so the keyboard does not cover
 *    the capture box.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(
  root,
  "src-tauri/gen/android/app/src/main/AndroidManifest.xml",
);

if (!existsSync(manifestPath)) {
  console.error(
    `No Android project found at ${manifestPath}\n` +
      "Run `npm run tauri android init` first.",
  );
  process.exit(1);
}

let manifest = readFileSync(manifestPath, "utf8");
const before = manifest;

const PERMISSIONS = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
];

const missing = PERMISSIONS.filter((line) => !manifest.includes(line.split(" ")[1]));
if (missing.length > 0) {
  manifest = manifest.replace(
    /(<manifest[^>]*>)/,
    (match) => `${match}\n\n    ${missing.join("\n    ")}\n`,
  );
}

// Keep plain filesystem access on Android 10 (API 29).
if (!manifest.includes("requestLegacyExternalStorage")) {
  manifest = manifest.replace(
    /(<application\b)/,
    '$1\n        android:requestLegacyExternalStorage="true"',
  );
}

// Resize the window for the keyboard instead of panning the whole webview.
if (!manifest.includes("android:windowSoftInputMode")) {
  manifest = manifest.replace(
    /(<activity\b)/,
    '$1\n            android:windowSoftInputMode="adjustResize"',
  );
}

if (manifest === before) {
  console.log("AndroidManifest.xml already patched — nothing to do.");
} else {
  writeFileSync(manifestPath, manifest);
  console.log("Patched AndroidManifest.xml:");
  console.log("  · storage permissions for reading an Obsidian vault");
  console.log("  · legacy external storage for Android 10");
  console.log("  · adjustResize so the keyboard does not cover the editor");
}
