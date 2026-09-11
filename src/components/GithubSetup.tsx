/**
 * Connecting a GitHub repository, written for someone who has never made a
 * token before. The steps are numbered, the link opens the exact page with
 * the right boxes pre-selected, and nothing is saved until GitHub has
 * confirmed the token can actually write to the repository.
 */
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  GitBranch,
  Github,
  Lock,
  ShieldCheck,
} from "lucide-react";

import { Sheet } from "./Sheet";
import { Button } from "./ui";
import { useToast } from "./Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { RepoInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Opens the token page with exactly the permission this app needs. */
const TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=Micro%20Card&description=Sync%20my%20cards";

export function GithubSetup({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const { library, reload, refreshGithub, sync } = useStore();
  const toast = useToast();

  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [branch, setBranch] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RepoInfo | null>(null);

  const openTokenPage = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(TOKEN_URL);
    } catch {
      window.open(TOKEN_URL, "_blank");
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const info = await api.githubConnect({
        token: token.trim(),
        repo: repo.trim(),
        branch: branch.trim() || undefined,
        folder: library?.settings.folder,
      });
      setResult(info);
      await reload();
      await refreshGithub();
      toast.success(`Connected to ${info.full_name}`);
      // First sync straight away: seeing the cards arrive is the proof that
      // it worked.
      const report = await sync(true);
      if (report && report.summary !== "Already up to date") {
        toast.success(report.summary);
      }
      onConnected?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = repo.trim().length > 2 && token.trim().length > 10;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title="Sync with GitHub"
      footer={
        result ? (
          <Button size="lg" block onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button size="lg" block loading={busy} disabled={!ready} onClick={() => void connect()}>
            Connect repository
          </Button>
        )
      }
    >
      {result ? (
        <div className="py-6 text-center animate-fade-in">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-brand-soft text-brand">
            <Check className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-xl font-black">{result.full_name}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your cards now live in this repository. Every change is committed
            automatically, and anything you push from a computer shows up here.
          </p>
          <div className="mt-5 space-y-2 text-left">
            <Fact icon={<GitBranch className="h-4 w-4" />} label="Branch" value={result.default_branch} />
            <Fact
              icon={<Lock className="h-4 w-4" />}
              label="Visibility"
              value={result.private ? "Private" : "Public"}
            />
            <Fact
              icon={<Github className="h-4 w-4" />}
              label="Cards already there"
              value={String(result.existing_cards)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-5 pb-4 pt-1">
          <p className="text-[15px] leading-relaxed text-muted">
            Cards are Markdown files, so a Git repository makes a perfect home
            for them: every edit becomes a commit, and you get the whole history
            for free.
          </p>

          <Step number={1} title="Create a token">
            <p className="text-sm leading-relaxed text-muted">
              GitHub calls it a <em>fine-grained personal access token</em>. Give
              it access to the one repository you want to use, and set{" "}
              <strong className="text-ink">Contents</strong> to{" "}
              <strong className="text-ink">Read and write</strong>.
            </p>
            <Button variant="secondary" className="mt-2.5" onClick={() => void openTokenPage()}>
              Open GitHub
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Step>

          <Step number={2} title="Paste it here">
            <div className="relative">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type={showToken ? "text" : "password"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="github_pat_…"
                className="h-12 w-full rounded-2xl border border-line bg-raised px-4 pr-12 font-mono text-sm outline-none focus:border-brand"
              />
              <button
                aria-label={showToken ? "Hide token" : "Show token"}
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted active:bg-line"
              >
                {showToken ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </button>
            </div>
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The token is kept on this device only, in the app's private
              storage. It is never written into your cards or settings file.
            </p>
          </Step>

          <Step number={3} title="Choose the repository">
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="your-name/notes"
              className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
            />
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-muted">
                Use a branch other than the default
              </summary>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="main"
                className="mt-2 h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
              />
            </details>
          </Step>

          <p className={cn("rounded-2xl bg-raised p-4 text-xs leading-relaxed text-muted")}>
            An empty repository is fine — Micro Card creates the first commit.
            An existing one keeps everything it already has; cards are only
            written inside the{" "}
            <span className="font-mono">{library?.settings.folder || "Cards"}</span>{" "}
            folder.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink">
        {number}
      </div>
      <div className="min-w-0 flex-1">
        <p className="pb-1.5 font-bold leading-tight">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
      <span className="text-muted">{icon}</span>
      <span className="text-sm text-muted">{label}</span>
      <span className="ml-auto text-sm font-semibold">{value}</span>
    </div>
  );
}
