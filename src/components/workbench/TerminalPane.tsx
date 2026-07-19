import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import { workbenchStore, type WorkbenchSession } from "./store";
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
  onRemove: () => void;
}

export function TerminalPane({
  session,
  onClose,
  onRemove,
}: TerminalPaneProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput((transcript) => {
    void workbenchStore.writeInput(session.id, transcript);
  });

  useEffect(() => {
    if (!voice.error) return;
    toast.error(t("workbench.voiceInputFailed"), {
      description: t(`workbench.voiceErrors.${voice.error}`, {
        defaultValue: voice.error,
      }),
    });
  }, [t, voice.error]);

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
              "p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/60",
              voice.isListening && "bg-red-500/15 text-red-400 animate-pulse",
              !voice.isSupported && "cursor-not-allowed opacity-40",
            )}
          >
            {voice.isListening ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
          </button>
        )}
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
      <div className="relative flex-1 min-h-0">
        <div
          ref={hostRef}
          className="h-full min-h-0 p-1"
          onMouseDown={() => workbenchStore.focus(session.id)}
        />
        {voice.isListening && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md border border-red-500/30 bg-background/95 px-3 py-2 text-xs text-foreground shadow-lg">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {voice.preview || t("workbench.listening")}
          </div>
        )}
      </div>
    </div>
  );
}
