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
 *  - a resize-aware activity so the keyboard does not cover the capture box;
 *  - a share target, so "Share → Micro Card" from any app captures a card;
 *  - the MainActivity code that receives that shared text.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const changes = [];

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

// Accept text shared from any other app, so capturing something you are
// reading is two taps instead of a copy, a switch and a paste.
const SHARE_FILTER = `            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;

if (!manifest.includes("android.intent.action.SEND")) {
  // Put it on the launcher activity, after the existing filter.
  const anchor = manifest.lastIndexOf("</intent-filter>");
  if (anchor === -1) {
    console.error(
      "Could not find an <intent-filter> to attach the share target to.\n" +
        "The generated project has changed shape; update this script.",
    );
    process.exit(1);
  }
  const insertAt = anchor + "</intent-filter>".length;
  manifest = `${manifest.slice(0, insertAt)}\n\n${SHARE_FILTER}${manifest.slice(insertAt)}`;
  changes.push("a share target for text from other apps");
}

if (manifest !== before) {
  if (missing.length > 0) changes.unshift("storage permissions for reading an Obsidian vault");
  if (!before.includes("requestLegacyExternalStorage")) {
    changes.push("legacy external storage for Android 10");
  }
  if (!before.includes("android:windowSoftInputMode")) {
    changes.push("adjustResize so the keyboard does not cover the editor");
  }
  writeFileSync(manifestPath, manifest);
  console.log("Patched AndroidManifest.xml:");
  for (const change of changes) console.log(`  · ${change}`);
} else {
  console.log("AndroidManifest.xml already patched — nothing to do.");
}

patchMainActivity();

/**
 * Teach the activity to receive shared text.
 *
 * The text is written to `shared-capture.json` in the app's own files
 * directory, which the Rust side reads and clears on the next launch or
 * resume (`take_shared_text`). Handing it over through a file avoids any JNI
 * plumbing between Kotlin and Rust for what is a single string.
 */
function patchMainActivity() {
  const sourceDir = join(root, "src-tauri/gen/android/app/src/main/java");
  const activity = findMainActivity(sourceDir);
  if (!activity) {
    console.error(`Could not find MainActivity.kt under ${sourceDir}`);
    process.exit(1);
  }

  const current = readFileSync(activity, "utf8");
  if (current.includes("shared-capture.json")) {
    console.log("MainActivity.kt already handles shared text.");
    return;
  }

  const packageLine = current.match(/^package\s+[\w.]+/m);
  if (!packageLine) {
    console.error("MainActivity.kt has no package declaration; not patching.");
    process.exit(1);
  }

  writeFileSync(
    activity,
    `${packageLine[0]}

import android.content.Intent
import android.os.Bundle
import org.json.JSONObject
import java.io.File

/**
 * Micro Card's activity.
 *
 * Everything here exists to support one feature: "Share → Micro Card" from
 * another app. The shared text is written into the app's files directory,
 * where the Rust side picks it up and clears it.
 *
 * Generated by scripts/patch-android.mjs — re-run it after \`tauri android init\`.
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    captureSharedText(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // A share that arrives while the app is already open still counts.
    captureSharedText(intent)
    setIntent(intent)
  }

  private fun captureSharedText(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    if (text.isBlank()) return

    val payload = JSONObject()
    payload.put("text", text)
    intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { payload.put("subject", it) }
    payload.put("source", "share")

    try {
      File(filesDir, "shared-capture.json").writeText(payload.toString())
    } catch (error: Exception) {
      // A failed hand-off must never stop the app from opening.
      android.util.Log.w("MicroCard", "Could not store shared text", error)
    }
  }
}
`,
  );
  console.log("Patched MainActivity.kt: receives text shared from other apps.");
}

/** The generated package path is not fixed, so look for the file. */
function findMainActivity(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(path);
      if (found) return found;
    } else if (entry.name === "MainActivity.kt") {
      return path;
    }
  }
  return null;
}
