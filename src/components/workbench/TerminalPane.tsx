import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import {
  ArrowRight,
  AlertTriangle,
  Bell,
  BellOff,
  Clipboard,
  ExternalLink,
  GitBranch,
  Globe,
  GripVertical,
  History,
  Link2,
  Maximize2,
  Mic,
  MicOff,
  Pin,
  RotateCw,
  Search,
  Play,
  Minimize2,
  Square,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { settingsApi, workbenchApi, type WorkbenchGitStatus } from "@/lib/api";
import {
  workbenchStore,
  isLocalPreviewUrl,
  type WorkbenchSession,
} from "./store";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const AGENT_ICON: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
};

interface TerminalPaneProps {
  session: WorkbenchSession;
  onClose: () => void;
  onRestart: () => void;
  onRemove: () => void;
  focused: boolean;
  onToggleFocus: () => void;
  onReviewWorktree: () => void;
  sharedCheckout: boolean;
  /** Other panels, for the "reference another panel's output" menu. */
  otherSessions: WorkbenchSession[];
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

export function TerminalPane({
  session,
  onClose,
  onRestart,
  onRemove,
  focused,
  onToggleFocus,
  onReviewWorktree,
  sharedCheckout,
  otherSessions,
  dragHandleProps,
}: TerminalPaneProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput((transcript) => {
    void workbenchStore.writeInput(session.id, transcript);
  });
  const [urlDraft, setUrlDraft] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCount, setSearchCount] = useState<number | undefined>();
  const [gitStatus, setGitStatus] = useState<WorkbenchGitStatus>();
  const seenPreviewRef = useRef(false);

  const previewUrl = session.previewUrl;
  const view = session.view;
  const hasUnseenPreview =
    view === "terminal" && !!previewUrl && !seenPreviewRef.current;

  useEffect(() => {
    setUrlDraft(previewUrl ?? "");
    setIframeFailed(false);
  }, [previewUrl]);

  useEffect(() => {
    if (view === "preview") seenPreviewRef.current = true;
  }, [view, previewUrl]);

  useEffect(() => {
    if (!voice.error) return;
    toast.error(t("workbench.voiceInputFailed"), {
      description: t(`workbench.voiceErrors.${voice.error}`, {
        defaultValue: voice.error,
      }),
    });
  }, [t, voice.error]);

  useEffect(() => {
    if (!session.sourceCwd || !session.cwd) {
      setGitStatus(undefined);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void workbenchApi
        .getWorktreeStatus(session.sourceCwd!, session.cwd!)
        .then((status) => {
          if (!cancelled) setGitStatus(status);
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.cwd, session.sourceCwd]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    workbenchStore.attach(session.id, host);

    const observer = new ResizeObserver(() => {
      workbenchStore.fit(session.id);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      workbenchStore.detach(session.id);
    };
  }, [session.id]);

  const icon = AGENT_ICON[session.agent];
  const isRunning = session.status === "running";
  const activityColor = {
    working: "bg-blue-400",
    waiting: "bg-amber-400",
    failed: "bg-red-400",
    complete: "bg-emerald-400",
  }[session.activity];

  // Pull another panel's recent output into this panel's input, wrapped in a
  // fenced block with a source label so the receiving agent has context.
  const referenceOutput = (sourceId: string) => {
    const source = otherSessions.find((item) => item.id === sourceId);
    if (!source) return;
    const output = workbenchStore.getRecentOutput(sourceId);
    if (!output.trim()) {
      toast.info(t("workbench.referenceEmpty", { title: source.title }));
      return;
    }
    const block = `\n[output from ${source.title}]\n\`\`\`\n${output}\n\`\`\`\n`;
    void workbenchStore.writeInput(session.id, block);
    toast.success(t("workbench.referenceInserted", { title: source.title }));
  };
  const toggleNotifications = async () => {
    const next = !session.notifyOnComplete;
    if (next) {
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) {
        toast.error(t("workbench.notificationsDenied"));
        return;
      }
    }
    workbenchStore.setNotifyOnComplete(session.id, next);
  };
  const applyPreviewUrl = () => {
    const next = urlDraft.trim();
    workbenchStore.setPreviewUrl(session.id, next || undefined);
  };

  return (
    <div className="group flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/90 bg-[#16161e] shadow-sm transition-shadow hover:shadow-md">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#1d1d27] px-2.5">
        <button
          type="button"
          {...dragHandleProps}
          title={t("workbench.reorderPanel")}
          aria-label={t("workbench.reorderPanel")}
          className="-ml-1 flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-zinc-600 transition-colors hover:bg-white/[0.05] hover:text-zinc-300 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04]">
            {icon ? (
              <ProviderIcon icon={icon} name={session.title} size={14} />
            ) : (
              <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 leading-none">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium text-zinc-100">
                {session.title}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  activityColor,
                  isRunning && "shadow-[0_0_0_2px_rgba(96,165,250,0.12)]",
                )}
                title={t(`workbench.activity.${session.activity}`)}
              />
            </div>
            {session.subtitle && !session.worktreeBranch && (
              <span className="mt-1 block truncate text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                {session.subtitle}
              </span>
            )}
            {session.worktreeBranch && (
              <button
                type="button"
                onClick={onReviewWorktree}
                className="mt-1 flex max-w-[180px] items-center gap-1 truncate text-[9px] text-emerald-400/80"
                title={
                  gitStatus
                    ? `${gitStatus.latestCommit} ${gitStatus.latestCommitSubject} · ${session.cwd ?? ""}`
                    : `${session.worktreeBranch} · ${session.cwd ?? ""}`
                }
              >
                <GitBranch
                  className={cn(
                    "h-2.5 w-2.5 shrink-0",
                    gitStatus?.dirty && "text-amber-300",
                  )}
                />
                <span className="truncate">
                  {session.worktreeBranch}
                  {gitStatus
                    ? ` · ${gitStatus.dirty ? "*" : ""}${gitStatus.changedFiles.length} · ${gitStatus.latestCommit}`
                    : ""}
                </span>
              </button>
            )}
            {sharedCheckout && (
              <span
                className="mt-1 flex max-w-[180px] items-center gap-1 truncate text-[9px] text-amber-300"
                title={t("workbench.sharedCheckoutWarning")}
              >
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">
                  {t("workbench.sharedCheckout")}
                </span>
              </span>
            )}
          </div>
        </div>

        <div
          className="flex shrink-0 items-center rounded-md border border-white/[0.07] bg-black/20 p-0.5"
          role="group"
          aria-label={t("workbench.panelView")}
        >
          <button
            type="button"
            onClick={() => workbenchStore.setPanelView(session.id, "terminal")}
            title={t("workbench.showTerminal")}
            aria-label={t("workbench.showTerminal")}
            aria-pressed={view === "terminal"}
            className={cn(
              "flex h-6 w-7 items-center justify-center rounded-[4px] text-zinc-500 transition-colors hover:text-zinc-200",
              view === "terminal" && "bg-white/[0.09] text-zinc-100 shadow-sm",
            )}
          >
            <TerminalSquare className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => workbenchStore.setPanelView(session.id, "preview")}
            title={t("workbench.showPreview")}
            aria-label={t("workbench.showPreview")}
            aria-pressed={view === "preview"}
            className={cn(
              "relative flex h-6 w-7 items-center justify-center rounded-[4px] text-zinc-500 transition-colors hover:text-zinc-200",
              view === "preview" && "bg-blue-500/15 text-blue-300 shadow-sm",
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            {hasUnseenPreview && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-400 ring-2 ring-[#1d1d27]" />
            )}
          </button>
        </div>

        {isRunning && (
          <button
            type="button"
            onClick={voice.isListening ? voice.stop : voice.start}
            disabled={!voice.isSupported}
            title={
              voice.isSupported
                ? t(
                    voice.isListening
                      ? "workbench.stopVoiceInput"
                      : "workbench.startVoiceInput",
                  )
                : t("workbench.voiceInputUnsupported")
            }
            aria-pressed={voice.isListening}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100",
              voice.isListening && "bg-red-500/15 text-red-400 animate-pulse",
              !voice.isSupported && "cursor-not-allowed opacity-40",
            )}
          >
            {voice.isListening ? (
              <MicOff className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void toggleNotifications()}
          title={t("workbench.notifyOnComplete")}
          aria-pressed={session.notifyOnComplete}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100",
            session.notifyOnComplete && "text-amber-300",
          )}
        >
          {session.notifyOnComplete ? (
            <Bell className="h-3.5 w-3.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
        </button>
        {isRunning && otherSessions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("workbench.referenceOutput")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs">
                {t("workbench.referenceOutputMenu")}
              </DropdownMenuLabel>
              {otherSessions.map((other) => (
                <DropdownMenuItem
                  key={other.id}
                  onSelect={() => referenceOutput(other.id)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="max-w-full truncate text-xs font-medium">
                    {other.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t(
                      other.status === "exited"
                        ? "workbench.statusExited"
                        : `workbench.activity.${other.activity}`,
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen((value) => !value)}
          title={t("workbench.commandHistory")}
          aria-pressed={historyOpen}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100",
            historyOpen && "bg-white/[0.08] text-zinc-100",
          )}
        >
          <History className="h-3.5 w-3.5" />
        </button>
        {!isRunning && (
          <button
            type="button"
            onClick={onRestart}
            title={t("workbench.restartSession")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFocus}
          title={
            focused ? t("workbench.exitFocusMode") : t("workbench.focusPanel")
          }
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
        >
          {focused ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={onClose}
            title={t("workbench.stopSession")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title={t("workbench.removeSession")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {view === "preview" && (
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-[#191921] px-2">
          {session.detectedUrls.length > 1 ? (
            <select
              value={previewUrl ?? ""}
              onChange={(e) =>
                workbenchStore.setPreviewUrl(session.id, e.target.value)
              }
              aria-label={t("workbench.detectedPreviewUrls")}
              className="h-7 max-w-[36%] rounded-md border border-white/[0.08] bg-black/20 px-1.5 text-[10px] font-mono text-zinc-300 outline-none focus:border-blue-400/40"
            >
              {session.detectedUrls.map((url) => (
                <option key={url} value={url}>
                  {url}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-white/[0.08] bg-black/20 focus-within:border-blue-400/40 focus-within:ring-2 focus-within:ring-blue-400/10">
            <Link2 className="ml-2 h-3 w-3 shrink-0 text-zinc-600" />
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyPreviewUrl();
              }}
              aria-label={t("workbench.previewUrlLabel")}
              placeholder={t("workbench.previewUrlPlaceholder")}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 font-mono text-[10px] shadow-none focus:ring-0"
            />
            <button
              type="button"
              onClick={applyPreviewUrl}
              title={t("workbench.loadPreview")}
              aria-label={t("workbench.loadPreview")}
              className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            disabled={!previewUrl}
            title={t("workbench.reloadPreview")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              previewUrl && void settingsApi.openExternal(previewUrl)
            }
            disabled={!previewUrl}
            title={t("workbench.openInBrowser")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div
          ref={hostRef}
          className={cn("h-full min-h-0 p-1", view === "preview" && "hidden")}
          onMouseDown={() => workbenchStore.focus(session.id)}
        />
        {view === "preview" &&
          (previewUrl && isLocalPreviewUrl(previewUrl) ? (
            !iframeFailed ? (
              <iframe
                key={`${previewUrl}:${reloadNonce}`}
                src={previewUrl}
                title={t("workbench.previewFrameTitle", {
                  title: session.title,
                })}
                className="absolute inset-0 h-full w-full border-0 bg-white"
                onError={() => setIframeFailed(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#16161e] p-5 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-400/15 bg-red-400/[0.06] text-red-300">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="max-w-xs">
                  <p className="text-xs font-medium text-zinc-200">
                    {t("workbench.previewFailedTitle")}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    {t("workbench.previewFailed")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void settingsApi.openExternal(previewUrl)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
                >
                  {t("workbench.openInBrowser")}
                </button>
              </div>
            )
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#16161e] p-5 text-center">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-zinc-500">
                <Globe className="h-5 w-5" />
                {!previewUrl && (
                  <span className="absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full border-2 border-[#191921] bg-amber-400" />
                )}
              </div>
              <p className="mt-3 text-xs font-medium text-zinc-200">
                {previewUrl
                  ? t("workbench.previewUrlNotLocalTitle")
                  : t("workbench.previewEmptyTitle")}
              </p>
              <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-zinc-500">
                {previewUrl
                  ? t("workbench.previewUrlNotLocal")
                  : t("workbench.previewEmpty")}
              </p>
              {!previewUrl && (
                <span className="mt-3 rounded-full border border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-amber-300/80">
                  {t("workbench.waitingForServer")}
                </span>
              )}
            </div>
          ))}
        {voice.isListening && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md border border-red-500/30 bg-background/95 px-3 py-2 text-xs text-foreground shadow-lg">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {voice.preview || t("workbench.listening")}
          </div>
        )}
        {historyOpen && (
          <div className="absolute inset-x-2 bottom-2 z-40 flex max-h-[70%] flex-col overflow-hidden rounded-lg border border-white/[0.1] bg-[#20202a]/[0.98] shadow-2xl backdrop-blur">
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] p-2">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setSearchCount(
                      workbenchStore.searchTerminal(session.id, searchQuery),
                    );
                  }
                }}
                placeholder={t("workbench.searchTerminal")}
                className="h-7 flex-1 border-white/[0.08] bg-black/20 text-[11px]"
              />
              {searchCount != null && (
                <span className="text-[10px] text-zinc-500">
                  {t("workbench.searchMatches", { count: searchCount })}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {session.commandHistory.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-zinc-500">
                  {t("workbench.noCommandHistory")}
                </p>
              ) : (
                [...session.commandHistory].reverse().map((record) => (
                  <div
                    key={record.id}
                    className="rounded-md border border-white/[0.07] bg-black/20 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          record.endedAt == null
                            ? "bg-blue-400"
                            : record.exitCode === 0
                              ? "bg-emerald-400"
                              : "bg-red-400",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          workbenchStore.jumpToCommand(session.id, record.id)
                        }
                        className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-zinc-200 hover:text-white"
                      >
                        {record.command}
                      </button>
                      {record.exitCode != null && (
                        <span className="text-[9px] text-zinc-500">
                          {t("workbench.exitCode", { code: record.exitCode })}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          workbenchStore.togglePinnedCommand(
                            session.id,
                            record.id,
                          )
                        }
                        title={t("workbench.pinOutput")}
                        className={cn(
                          "text-zinc-500 hover:text-zinc-200",
                          record.pinned && "text-amber-300",
                        )}
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(record.output)
                        }
                        title={t("workbench.copyCommandOutput")}
                        className="text-zinc-500 hover:text-zinc-200"
                      >
                        <Clipboard className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void workbenchStore
                            .rerunCommand(session.id, record.id)
                            .catch((error) =>
                              toast.error(t("workbench.rerunFailed"), {
                                description: String(error),
                              }),
                            )
                        }
                        title={t("workbench.rerunCommand")}
                        className="text-zinc-500 hover:text-emerald-300"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                    </div>
                    {(record.pinned || record.failureHint) && (
                      <div className="mt-2 border-t border-white/[0.06] pt-2">
                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[9px] leading-relaxed text-zinc-400">
                          {record.failureHint ?? record.output}
                        </pre>
                        {record.quickFixCommand && (
                          <button
                            type="button"
                            onClick={() =>
                              void workbenchStore
                                .runQuickFix(session.id, record.id)
                                .then((result) =>
                                  toast.success(
                                    t(
                                      result === "ran"
                                        ? "workbench.quickFixRan"
                                        : "workbench.quickFixCopied",
                                    ),
                                  ),
                                )
                            }
                            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2 py-1 font-mono text-[9px] text-zinc-300 hover:bg-white/[0.06]"
                          >
                            <Wrench className="h-3 w-3" />
                            {record.quickFixCommand}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
