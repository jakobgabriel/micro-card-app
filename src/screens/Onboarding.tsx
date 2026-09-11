/**
 * First run. Three questions at most, and every one of them has a "skip this,
 * I just want to write" answer — nobody should have to understand vaults,
 * folders or Markdown before their first card.
 */
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FolderOpen,
  FolderSearch,
  Github,
  Layers,
  RefreshCcw,
  Smartphone,
  Sparkles,
} from "lucide-react";

import { GithubSetup } from "@/components/GithubSetup";

import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { VaultCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Onboarding() {
  const { setVault, useLocalVault } = useStore();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [vaults, setVaults] = useState<VaultCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      setVaults(await api.detectVaults());
    } catch (err) {
      toast.error(errorMessage(err));
      setVaults([]);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (step === 1 && vaults === null) void scan();
    // `scan` is stable enough for a one-shot effect on entering the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const connect = async (path: string) => {
    setBusy(true);
    try {
      await setVault(path);
      toast.success("Vault connected");
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
      toast.error("Folder picker unavailable — type the path instead.");
    }
  };

  return (
    <div className="flex min-h-full flex-col px-6 pb-10 pt-12">
      {step === 0 ? (
        <Welcome onNext={() => setStep(1)} onSkip={() => void useLocalVault()} />
      ) : (
        <div className="flex flex-1 flex-col animate-fade-in">
          <h1 className="text-2xl font-black leading-tight">Where should cards live?</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Cards are ordinary Markdown files. Keep them in your Obsidian vault,
            in a GitHub repository, or just on this phone.
          </p>

          <button
            onClick={() => setGithubOpen(true)}
            className="card-surface mt-5 flex w-full items-center gap-3 p-4 text-left active:scale-[.98]"
          >
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
              <Github className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">Sync with a GitHub repository</p>
              <p className="text-xs text-muted">
                Every card becomes a commit, with full history
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted" />
          </button>

          <p className="mt-5 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Or use a folder on this device
          </p>

          <div className="mt-6 space-y-3">
            {scanning && (
              <div className="flex items-center gap-3 rounded-2xl bg-raised p-4 text-sm text-muted">
                <Spinner />
                Looking for Obsidian vaults on this device…
              </div>
            )}

            {vaults?.map((vault) => (
              <button
                key={vault.path}
                disabled={busy}
                onClick={() => void connect(vault.path)}
                className="card-surface flex w-full items-center gap-3 p-4 text-left active:scale-[.98]"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{vault.name}</p>
                  <p className="truncate text-xs text-muted">
                    {vault.note_count} notes · {vault.path}
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted" />
              </button>
            ))}

            {vaults !== null && vaults.length === 0 && !scanning && (
              <div className="rounded-2xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">
                No vault found automatically. Pick the folder yourself, or start on
                this device and connect a vault later — nothing is lost either way.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void browse()} icon={<FolderOpen className="h-4 w-4" />}>
                Browse…
              </Button>
              <Button variant="secondary" onClick={() => void scan()} icon={<RefreshCcw className="h-4 w-4" />}>
                Scan again
              </Button>
            </div>

            <details className="rounded-2xl bg-raised p-4">
              <summary className="cursor-pointer text-sm font-semibold text-muted">
                Type a folder path instead
              </summary>
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/storage/emulated/0/Documents/My Vault"
                className="mt-3 h-12 w-full rounded-xl border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand"
              />
              <Button
                className="mt-2"
                block
                disabled={!manualPath.trim() || busy}
                onClick={() => void connect(manualPath.trim())}
              >
                Use this folder
              </Button>
            </details>
          </div>

          <div className="flex-1" />

          <Button
            variant="ghost"
            block
            className="mt-6 text-muted"
            loading={busy}
            onClick={() => void useLocalVault()}
            icon={<Smartphone className="h-4 w-4" />}
          >
            Skip — just store cards on this phone
          </Button>

          <GithubSetup open={githubOpen} onClose={() => setGithubOpen(false)} />
        </div>
      )}
    </div>
  );
}

function Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const points = [
    {
      icon: <Sparkles className="h-5 w-5" />,
      title: "One idea per card",
      body: "Write it in seconds. No folders to pick, no format to learn.",
    },
    {
      icon: <FolderSearch className="h-5 w-5" />,
      title: "Your files, your choice",
      body: "Every card is a plain Markdown note — in your Obsidian vault, a GitHub repo, or both.",
    },
    {
      icon: <Check className="h-5 w-5" />,
      title: "Remember it later",
      body: "Cards with an answer come back for review, right when you need them.",
    },
  ];

  return (
    <div className="flex flex-1 flex-col animate-fade-in">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand text-brand-ink shadow-lift">
        <Layers className="h-8 w-8" />
      </div>
      <h1 className="mt-6 text-3xl font-black leading-[1.1]">
        Capture what you
        <br />
        want to keep.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Micro Card turns fleeting thoughts into cards you can actually find
        again — and keeps them in sync with Obsidian or a GitHub repository.
      </p>

      <div className="mt-8 space-y-4">
        {points.map((point) => (
          <div key={point.title} className="flex gap-3.5">
            <div
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                "bg-brand-soft text-brand",
              )}
            >
              {point.icon}
            </div>
            <div>
              <p className="font-bold">{point.title}</p>
              <p className="text-sm leading-relaxed text-muted">{point.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <Button size="lg" block className="mt-8" onClick={onNext}>
        Get started
        <ArrowRight className="h-5 w-5" />
      </Button>
      <Button variant="ghost" block className="mt-1 text-muted" onClick={onSkip}>
        Skip setup
      </Button>
    </div>
  );
}
