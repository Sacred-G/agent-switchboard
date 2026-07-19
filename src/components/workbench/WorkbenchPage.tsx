import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { extractErrorMessage } from "@/utils/errorUtils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TerminalPane } from "./TerminalPane";
import { AddSessionDialog } from "./AddSessionDialog";
import { workbenchStore, MAX_SESSIONS, type AddSessionOptions } from "./store";

function gridClasses(count: number): string {
  // Slots shown = sessions + one "add" tile (until full).
  const slots = Math.min(count + 1, MAX_SESSIONS);
  if (slots <= 1) return "grid-cols-1 grid-rows-1";
  if (slots === 2) return "grid-cols-2 grid-rows-1";
  if (slots <= 4) return "grid-cols-2 grid-rows-2";
  if (slots <= 6) return "grid-cols-3 grid-rows-2";
  return "grid-cols-3 grid-rows-3";
}

export function WorkbenchPage() {
  const { t } = useTranslation();
  const sessions = useSyncExternalStore(
    workbenchStore.subscribe,
    workbenchStore.getSessions,
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const handleAdd = async (options: AddSessionOptions) => {
    try {
      await workbenchStore.addSession(options);
    } catch (error) {
      toast.error(t("workbench.launchFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
      throw error;
    }
  };

  const requestRemove = (id: string) => {
    const session = workbenchStore.getSessions().find((s) => s.id === id);
    if (session?.status === "running") {
      setRemoveTarget(id);
    } else {
      void workbenchStore.removeSession(id);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 px-6 pb-2">
      <div
        className={`grid gap-2 flex-1 min-h-0 ${gridClasses(sessions.length)}`}
      >
        {sessions.map((session) => (
          <TerminalPane
            key={session.id}
            session={session}
            onClose={() => void workbenchStore.closeSession(session.id)}
            onRemove={() => requestRemove(session.id)}
          />
        ))}
        {sessions.length < MAX_SESSIONS && (
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 hover:bg-muted/40 transition-colors min-h-[120px]"
          >
            <Plus className="w-6 h-6" />
            <span className="text-sm font-medium">
              {t("workbench.addSession")}
            </span>
            <span className="text-xs">
              {t("workbench.slotsUsed", {
                used: sessions.length,
                max: MAX_SESSIONS,
              })}
            </span>
          </button>
        )}
      </div>

      <AddSessionDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onSubmit={handleAdd}
      />

      <ConfirmDialog
        isOpen={Boolean(removeTarget)}
        title={t("workbench.removeConfirmTitle")}
        message={t("workbench.removeConfirmMessage")}
        onConfirm={() => {
          if (removeTarget) {
            void workbenchStore.removeSession(removeTarget);
          }
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
