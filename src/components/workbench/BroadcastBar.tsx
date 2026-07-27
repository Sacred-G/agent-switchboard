import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio, Send, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { workbenchStore, type WorkbenchSession } from "./store";

interface BroadcastBarProps {
  sessions: WorkbenchSession[];
  onClose: () => void;
}

/**
 * Type once, send to many. Lets the user pick which running panels receive
 * the same input (e.g. the same prompt across several agents) and dispatch it
 * with or without submitting (Enter).
 */
export function BroadcastBar({ sessions, onClose }: BroadcastBarProps) {
  const { t } = useTranslation();
  const runnable = useMemo(
    () => sessions.filter((session) => session.status === "running"),
    [sessions],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(runnable.map((session) => session.id)),
  );
  const [text, setText] = useState("");

  const targets = runnable
    .filter((session) => selected.has(session.id))
    .map((session) => session.id);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async (submit: boolean) => {
    if (!text.trim() || targets.length === 0) return;
    const delivered = await workbenchStore.broadcastInput(
      targets,
      text,
      submit,
    );
    toast.success(t("workbench.broadcastSent", { count: delivered }));
    if (submit) setText("");
  };

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-blue-500/30 bg-blue-500/5 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-xs font-medium">
          {t("workbench.broadcastTitle")}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          title={t("workbench.broadcastClose")}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {runnable.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {t("workbench.broadcastNoTargets")}
          </span>
        ) : (
          runnable.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => toggle(session.id)}
              aria-pressed={selected.has(session.id)}
              className={cn(
                "max-w-[140px] truncate rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                selected.has(session.id)
                  ? "border-blue-500/50 bg-blue-500/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {session.title}
            </button>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send(true);
          }}
          placeholder={t("workbench.broadcastPlaceholder")}
          className="h-7 flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void send(false)}
          disabled={!text.trim() || targets.length === 0}
          title={t("workbench.broadcastTypeOnly")}
          className="rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {t("workbench.broadcastType")}
        </button>
        <button
          type="button"
          onClick={() => void send(true)}
          disabled={!text.trim() || targets.length === 0}
          title={t("workbench.broadcastSend")}
          className="flex items-center gap-1 rounded-md bg-blue-500/90 px-2 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Send className="h-3 w-3" />
          {t("workbench.broadcastSendLabel", { count: targets.length })}
        </button>
      </div>
    </div>
  );
}
