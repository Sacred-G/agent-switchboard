import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import { workbenchStore, type WorkbenchSession } from "./store";

const AGENT_ICON: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
};

interface TerminalPaneProps {
  session: WorkbenchSession;
  onClose: () => void;
  onRemove: () => void;
}

export function TerminalPane({
  session,
  onClose,
  onRemove,
}: TerminalPaneProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex flex-col h-full min-h-0 rounded-lg border border-border overflow-hidden bg-[#16161e]">
      <div className="flex items-center gap-2 px-2 h-8 shrink-0 bg-muted/80 border-b border-border">
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            isRunning ? "bg-emerald-500" : "bg-zinc-500",
          )}
          title={
            isRunning
              ? t("workbench.statusRunning")
              : t("workbench.statusExited")
          }
        />
        {icon && <ProviderIcon icon={icon} name={session.title} size={14} />}
        <span className="text-xs font-medium truncate">{session.title}</span>
        {session.subtitle && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/60 text-muted-foreground whitespace-nowrap">
            {session.subtitle}
          </span>
        )}
        <span className="flex-1" />
        {isRunning && (
          <button
            type="button"
            onClick={onClose}
            title={t("workbench.stopSession")}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            <Square className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title={t("workbench.removeSession")}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div
        ref={hostRef}
        className="flex-1 min-h-0 p-1"
        onMouseDown={() => workbenchStore.focus(session.id)}
      />
    </div>
  );
}
