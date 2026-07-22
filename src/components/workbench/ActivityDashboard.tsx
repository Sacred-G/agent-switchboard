import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import type { WorkbenchActivity } from "@/lib/api";
import type { WorkbenchSession } from "./store";

const AGENT_ICON: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
};

const ACTIVITY_DOT: Record<WorkbenchActivity | "exited", string> = {
  working: "bg-blue-400 animate-pulse",
  waiting: "bg-amber-400",
  failed: "bg-red-500",
  complete: "bg-emerald-500",
  exited: "bg-zinc-500",
};

interface ActivityDashboardProps {
  sessions: WorkbenchSession[];
  focusedPanelId?: string;
  onSelect: (id: string) => void;
}

/**
 * Compact strip showing every panel's live status at a glance, so all agents
 * can be monitored without switching between them. Clicking a chip focuses
 * (or jumps to) that panel.
 */
export function ActivityDashboard({
  sessions,
  focusedPanelId,
  onSelect,
}: ActivityDashboardProps) {
  const { t } = useTranslation();
  if (sessions.length === 0) return null;

  return (
    <div className="mb-2 flex shrink-0 items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("workbench.activityDashboard")}
      </span>
      {sessions.map((session, index) => {
        const state: WorkbenchActivity | "exited" =
          session.status === "exited" ? "exited" : session.activity;
        const icon = AGENT_ICON[session.agent];
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            title={`${session.title} — ${t(
              session.status === "exited"
                ? "workbench.statusExited"
                : `workbench.activity.${session.activity}`,
            )}`}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
              focusedPanelId === session.id
                ? "border-blue-500/50 bg-blue-500/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                ACTIVITY_DOT[state],
              )}
            />
            {icon ? (
              <ProviderIcon icon={icon} name={session.title} size={12} />
            ) : (
              <span className="font-mono text-[10px]">{index + 1}</span>
            )}
            <span className="max-w-[120px] truncate">{session.title}</span>
          </button>
        );
      })}
    </div>
  );
}
