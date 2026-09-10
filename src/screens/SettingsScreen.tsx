/** Settings, written for people who have never heard the word "frontmatter". */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  FolderSync,
  HardDrive,
  Info,
  Layers,
  Moon,
  RefreshCcw,
  Sun,
  Target,
} from "lucide-react";

import { Button, IconButton, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { VaultCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { library, updateSettings, setVault, moveLocalCardsToVault, reload } = useStore();
  const toast = useToast();
  const [vaults, setVaults] = useState<VaultCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [folder, setFolder] = useState(library?.settings.folder ?? "Cards");
  const [busy, setBusy] = useState(false);

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
                {localMode ? "This device only" : "Obsidian vault connected"}
              </p>
              <p className="truncate font-mono text-xs text-muted" data-selectable>
                {vaultRoot}
              </p>
            </div>
          </div>

          {localMode && (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Your cards are safe, but only on this phone. Connect a vault and they
              are copied across — nothing is deleted.
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
          label="Folder inside the vault"
          hint="New cards are written here. Existing cards stay where they are."
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

        <Field
          label="Tag added to every card"
          hint="Makes cards easy to find in Obsidian search. Leave empty for none."
        >
          <input
            defaultValue={settings.default_tag}
            onBlur={(e) => void updateSettings({ default_tag: e.target.value })}
            placeholder="card"
            className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
          />
        </Field>
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
            className="w-28 accent-[hsl(var(--brand))]"
          />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row
          icon={settings.dark_mode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          title="Dark mode"
          subtitle={settings.dark_mode ? "On" : "Off"}
        >
          <Toggle
            checked={settings.dark_mode}
            onChange={(checked) => void updateSettings({ dark_mode: checked })}
          />
        </Row>
      </Section>

      <Section title="Sync">
        <Row
          icon={<RefreshCcw className="h-5 w-5" />}
          title="Reload from vault"
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
        <div className="mt-3 flex gap-3 rounded-2xl bg-raised p-4 text-sm leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Micro Card reads and writes the files directly — there is no separate
            copy and no account. Use Obsidian Sync, Syncthing or any folder sync to
            move the vault between devices.
          </p>
        </div>
      </Section>
    </div>
  );
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
    <div>
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
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card-surface flex items-center gap-3 p-4">
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
