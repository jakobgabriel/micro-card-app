/** Settings, written for people who have never heard the word "frontmatter". */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  CloudOff,
  Download,
  FolderOpen,
  FolderSync,
  Github,
  HardDrive,
  Info,
  Layers,
  Monitor,
  Moon,
  RefreshCcw,
  Sun,
  Target,
  ImageOff,
  Trash2,
  Type,
  Upload,
} from "lucide-react";

import { GithubSetup } from "@/components/GithubSetup";
import { TrashSheet } from "@/components/TrashSheet";
import { Sheet } from "@/components/Sheet";
import { Button, Chip, IconButton, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cancelReminder, scheduleReminder } from "@/lib/reminders";
import type {
  ExportFormat,
  OrphanedAttachment,
  Theme,
  VaultCandidate,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const {
    library,
    github,
    syncing,
    updateSettings,
    setVault,
    moveLocalCardsToVault,
    reload,
    sync,
  } = useStore();
  const toast = useToast();
  const [vaults, setVaults] = useState<VaultCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [folder, setFolder] = useState(library?.settings.folder ?? "Cards");
  const [busy, setBusy] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [orphans, setOrphans] = useState<OrphanedAttachment[] | null>(null);
  const [tidying, setTidying] = useState(false);

  useEffect(() => {
    if (library) setFolder(library.settings.folder);
  }, [library?.settings.folder]);

  if (!library) return null;
  const { settings, local_mode: localMode, vault_root: vaultRoot } = library;

  const scan = async () => {
    setScanning(true);
    try {
      setVaults(await api.detectVaults());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setScanning(false);
    }
  };

  const connect = async (path: string) => {
    setBusy(true);
    try {
      if (localMode && library.cards.length > 0) {
        await moveLocalCardsToVault(path, folder);
        toast.success("Vault connected — your cards moved across");
      } else {
        await setVault(path, folder);
        toast.success("Vault connected");
      }
      setVaults(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") await connect(picked);
    } catch {
      toast.error("Folder picker unavailable on this device.");
    }
  };

  const runSync = async () => {
    try {
      const report = await sync();
      if (report) toast.success(report.summary);
      if (report && report.conflicts.length > 0) {
        toast.show(
          `${report.conflicts.length} card${report.conflicts.length === 1 ? " was" : "s were"} changed in both places — both versions were kept.`,
          { tone: "info" },
        );
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const disconnectGithub = async () => {
    setBusy(true);
    try {
      await api.githubDisconnect();
      await reload();
      toast.success("Repository disconnected — your cards stay put");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async (format: ExportFormat) => {
    const spec = {
      markdown: { extension: "md", name: "Markdown" },
      csv: { extension: "csv", name: "CSV" },
      json: { extension: "json", name: "JSON" },
    }[format];
    try {
      const contents = await api.exportCards(format);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `micro-card-export.${spec.extension}`,
        filters: [{ name: spec.name, extensions: [spec.extension] }],
      });
      if (!path) return;
      await api.writeTextFile(path, contents);
      setExportOpen(false);
      toast.success("Exported");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  /** Look for photos no card points at any more. */
  const findOrphans = async () => {
    setTidying(true);
    try {
      const found = await api.unusedAttachments();
      setOrphans(found);
      if (found.length === 0) toast.success("Nothing to tidy");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTidying(false);
    }
  };

  const tidy = async () => {
    setTidying(true);
    try {
      const { changed } = await api.tidyAttachments();
      setOrphans([]);
      await reload();
      toast.success(
        `${changed} file${changed === 1 ? "" : "s"} moved to trash`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTidying(false);
    }
  };

  const setReminder = async (hour: number | null) => {
    await updateSettings({ reminder_hour: hour });
    if (hour === null) {
      await cancelReminder();
      toast.success("Reminder off");
      return;
    }
    const ok = await scheduleReminder(hour);
    toast.show(
      ok
        ? `Reminder set for ${String(hour).padStart(2, "0")}:00`
        : "Allow notifications to get a daily reminder.",
      { tone: ok ? "success" : "error" },
    );
  };

  return (
    <div className="px-4 pb-28 pt-4">
      <header className="flex items-center gap-2">
        <IconButton label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <h1 className="text-2xl font-black">Settings</h1>
      </header>

      <Section title="Where your cards live">
        <div className="card-surface p-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
                localMode ? "bg-raised text-muted" : "bg-brand-soft text-brand",
              )}
            >
              {localMode ? <HardDrive className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {localMode ? "This device" : "Obsidian vault connected"}
              </p>
              <p className="truncate font-mono text-xs text-muted" data-selectable>
                {vaultRoot}
              </p>
            </div>
          </div>

          {localMode && (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Cards are Markdown files in the app's own folder. Connect an
              Obsidian vault or a GitHub repository — or both — and they travel
              with you.
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={() => void browse()} icon={<FolderOpen className="h-4 w-4" />}>
              Browse…
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void scan()} icon={<FolderSync className="h-4 w-4" />}>
              Find vaults
            </Button>
          </div>

          {scanning && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted">
              <Spinner />
              Scanning…
            </div>
          )}

          {vaults?.map((vault) => (
            <button
              key={vault.path}
              disabled={busy}
              onClick={() => void connect(vault.path)}
              className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-raised p-3 text-left active:scale-[.98]"
            >
              <Layers className="h-5 w-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{vault.name}</p>
                <p className="truncate text-xs text-muted">{vault.note_count} notes</p>
              </div>
            </button>
          ))}
          {vaults?.length === 0 && !scanning && (
            <p className="mt-2 text-sm text-muted">
              No vaults found. On Android, Micro Card needs the “All files access”
              permission to see folders outside its own storage.
            </p>
          )}
        </div>

        <Field
          label="Folder for new cards"
          hint="Inside the vault, and inside the repository. Existing cards stay where they are."
        >
          <div className="flex gap-2">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Cards"
              className="h-12 flex-1 rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
            />
            <Button
              variant="secondary"
              disabled={folder === settings.folder}
              onClick={() => void updateSettings({ folder }).then(() => toast.success("Folder updated"))}
            >
              Save
            </Button>
          </div>
        </Field>
      </Section>

      <Section title="GitHub sync">
        <div className="card-surface p-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
                github?.connected ? "bg-brand-soft text-brand" : "bg-raised text-muted",
              )}
            >
              <Github className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {github?.connected ? github.repo : "Not connected"}
              </p>
              <p className="truncate text-xs text-muted">
                {github?.connected
                  ? `${github.branch} · ${github.tracked_files} card${github.tracked_files === 1 ? "" : "s"} tracked${
                      github.last_synced ? ` · synced ${github.last_synced}` : ""
                    }`
                  : "Keep your cards in a Git repository, with full history."}
              </p>
            </div>
          </div>

          {github?.connected ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  loading={syncing}
                  onClick={() => void runSync()}
                  icon={<RefreshCcw className="h-4 w-4" />}
                >
                  Sync now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void disconnectGithub()}
                  icon={<CloudOff className="h-4 w-4" />}
                >
                  Disconnect
                </Button>
              </div>
              <Row
                className="mt-3"
                icon={<RefreshCcw className="h-5 w-5" />}
                title="Sync automatically"
                subtitle="On launch, on return, and after each change"
              >
                <Toggle
                  checked={settings.github_auto_sync}
                  onChange={(checked) => void updateSettings({ github_auto_sync: checked })}
                />
              </Row>
            </>
          ) : (
            <Button
              className="mt-3"
              block
              size="sm"
              onClick={() => setGithubOpen(true)}
              icon={<Github className="h-4 w-4" />}
            >
              Connect a repository
            </Button>
          )}
        </div>
      </Section>

      <Section title="Reviews">
        <Row
          icon={<Target className="h-5 w-5" />}
          title="Daily goal"
          subtitle={`${settings.daily_goal} cards a day`}
        >
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            defaultValue={settings.daily_goal}
            onChange={(e) => void updateSettings({ daily_goal: Number(e.target.value) })}
            className="w-24 accent-[hsl(var(--brand))]"
          />
        </Row>
        <Row
          icon={<Layers className="h-5 w-5" />}
          title="Session size"
          subtitle={`${settings.session_size} cards per session`}
        >
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            defaultValue={settings.session_size}
            onChange={(e) => void updateSettings({ session_size: Number(e.target.value) })}
            className="w-24 accent-[hsl(var(--brand))]"
          />
        </Row>
        <Row
          icon={settings.reminder_hour === null ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          title="Daily reminder"
          subtitle={
            settings.reminder_hour === null
              ? "Off"
              : `Every day at ${String(settings.reminder_hour).padStart(2, "0")}:00`
          }
        >
          <select
            value={settings.reminder_hour ?? ""}
            onChange={(e) =>
              void setReminder(e.target.value === "" ? null : Number(e.target.value))
            }
            className="h-10 rounded-xl border border-line bg-raised px-2 text-sm outline-none"
          >
            <option value="">Off</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Appearance">
        <div className="card-surface p-4">
          <p className="pb-2 text-sm font-semibold">Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
                { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
                { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
              ] as { value: Theme; label: string; icon: JSX.Element }[]
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => void updateSettings({ theme: option.value })}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-xs font-bold transition active:scale-95",
                  settings.theme === option.value
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line text-muted",
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Row
          icon={<Type className="h-5 w-5" />}
          title="Text size"
          subtitle={`${Math.round(settings.text_scale * 100)}%`}
        >
          <input
            type="range"
            min={85}
            max={140}
            step={5}
            defaultValue={Math.round(settings.text_scale * 100)}
            onChange={(e) => void updateSettings({ text_scale: Number(e.target.value) / 100 })}
            className="w-24 accent-[hsl(var(--brand))]"
          />
        </Row>
      </Section>

      <Section title="Your cards">
        <Row
          icon={<RefreshCcw className="h-5 w-5" />}
          title="Reload from disk"
          subtitle="Picks up edits you made in Obsidian"
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void reload().then(() => toast.success("Up to date"))}
          >
            Reload
          </Button>
        </Row>
        <Row
          icon={<Download className="h-5 w-5" />}
          title="Export"
          subtitle="Markdown to read, CSV for Anki, JSON for everything"
        >
          <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
            Export
          </Button>
        </Row>
        <Row
          icon={<Trash2 className="h-5 w-5" />}
          title="Recently deleted"
          subtitle="Restore a card, or empty the trash"
        >
          <Button size="sm" variant="secondary" onClick={() => setTrashOpen(true)}>
            Open
          </Button>
        </Row>
        <div className="card-surface p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-raised text-muted">
              <ImageOff className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Unused photos</p>
              <p className="truncate text-sm text-muted">
                {orphans === null
                  ? "Files left behind by deleted cards"
                  : orphans.length === 0
                    ? "Everything here is still in use"
                    : `${orphans.length} file${orphans.length === 1 ? "" : "s"} · ${formatBytes(
                        orphans.reduce((total, o) => total + o.size_bytes, 0),
                      )}`}
              </p>
            </div>
            <Button
              size="sm"
              variant={orphans && orphans.length > 0 ? "primary" : "secondary"}
              loading={tidying}
              onClick={() => void (orphans && orphans.length > 0 ? tidy() : findOrphans())}
            >
              {orphans && orphans.length > 0 ? "Tidy up" : "Check"}
            </Button>
          </div>
          {orphans && orphans.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {orphans.slice(0, 5).map((orphan) => (
                <li key={orphan.name} className="truncate font-mono text-xs">
                  {orphan.name}
                </li>
              ))}
              {orphans.length > 5 && <li className="text-xs">and {orphans.length - 5} more</li>}
            </ul>
          )}
        </div>
        <Row
          icon={<Upload className="h-5 w-5" />}
          title="Import"
          subtitle="Paste a list, or a file from another app"
        >
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            Import
          </Button>
        </Row>
        <Field label="Tag added to every card" hint="Leave empty for none.">
          <input
            defaultValue={settings.default_tag}
            onBlur={(e) => void updateSettings({ default_tag: e.target.value })}
            placeholder="card"
            className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
          />
        </Field>
        <div className="flex gap-3 rounded-2xl bg-raised p-4 text-sm leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Micro Card reads and writes the files directly — there is no separate
            copy and no account. Use Obsidian Sync, Syncthing, a GitHub
            repository or any folder sync to move cards between devices.
          </p>
        </div>
      </Section>

      <GithubSetup open={githubOpen} onClose={() => setGithubOpen(false)} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <TrashSheet open={trashOpen} onClose={() => setTrashOpen(false)} />

      <Sheet open={exportOpen} onClose={() => setExportOpen(false)} title="Export your cards">
        <p className="pb-3 text-sm leading-relaxed text-muted">
          Your cards are already Markdown files in a folder you control — this is
          for taking them somewhere else.
        </p>
        <div className="space-y-2 pb-2">
          {(
            [
              {
                format: "markdown",
                title: "Markdown document",
                body: "One readable file, grouped by deck. Good for printing or sharing.",
              },
              {
                format: "csv",
                title: "CSV for Anki",
                body: "Front, back and tags — what Anki's import dialog expects.",
              },
              {
                format: "json",
                title: "JSON backup",
                body: "Everything, review schedules included.",
              },
            ] as { format: ExportFormat; title: string; body: string }[]
          ).map((option) => (
            <button
              key={option.format}
              onClick={() => void exportAs(option.format)}
              className="card-surface w-full p-4 text-left active:scale-[.98]"
            >
              <p className="font-bold">{option.title}</p>
              <p className="text-sm leading-relaxed text-muted">{option.body}</p>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** Paste-or-pick import, covering Anki exports and a list typed by hand. */
function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reload, library } = useStore();
  const toast = useToast();
  const [text, setText] = useState("");
  const [deck, setDeck] = useState("");
  const [split, setSplit] = useState<"lines" | "blocks">("lines");
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "Text", extensions: ["md", "txt", "csv", "tsv"] }],
      });
      if (typeof path !== "string") return;
      setText(await api.readTextFile(path));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const result = await api.importText({
        text,
        split,
        deck: deck.trim() || undefined,
      });
      await reload();
      toast.success(
        `Added ${result.created} card${result.created === 1 ? "" : "s"}${
          result.skipped ? `, skipped ${result.skipped}` : ""
        }`,
      );
      setText("");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title="Import cards"
      footer={
        <Button size="lg" block loading={busy} disabled={!text.trim()} onClick={() => void run()}>
          Create cards
        </Button>
      }
    >
      <p className="pb-3 text-sm leading-relaxed text-muted">
        Paste anything. A line with a tab, <span className="font-mono">::</span>{" "}
        or <span className="font-mono">|</span> becomes a question and an answer —
        which is what Anki and Quizlet exports look like.
      </p>

      <div className="flex gap-2 pb-3">
        <Chip active={split === "lines"} onClick={() => setSplit("lines")}>
          One card per line
        </Chip>
        <Chip active={split === "blocks"} onClick={() => setSplit("blocks")}>
          Split on blank lines
        </Chip>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        placeholder={"Bonjour\tHello\nMerci :: Thank you"}
        className="w-full resize-none rounded-2xl border border-line bg-raised p-4 font-mono text-sm outline-none focus:border-brand"
      />

      <Button variant="secondary" className="mt-2" block onClick={() => void pickFile()}>
        Choose a file instead
      </Button>

      <Field label="Put them in a deck" hint="Optional.">
        <input
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
          placeholder="French"
          className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(library?.stats.decks ?? []).slice(0, 6).map((d) => (
            <Chip key={d.name} onClick={() => setDeck(d.name)}>
              {d.name}
            </Chip>
          ))}
        </div>
      </Field>
    </Sheet>
  );
}

/** Bytes as something a person reads, e.g. "2.4 MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-1">
      <label className="px-1 text-sm font-semibold">{label}</label>
      {hint && <p className="px-1 pb-1.5 pt-0.5 text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card-surface flex items-center gap-3 p-4", className)}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-raised text-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-8 w-14 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand" : "bg-line",
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-7" : "translate-x-1",
        )}
      />
    </button>
  );
}
