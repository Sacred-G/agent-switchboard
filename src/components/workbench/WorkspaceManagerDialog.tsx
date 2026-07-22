import { Clock3, FolderKanban, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkbenchWorkspaceRecord } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WorkspaceManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: WorkbenchWorkspaceRecord[];
  activeId?: string;
  onOpenWorkspace: (id: string) => Promise<boolean>;
  onCreateWorkspace: () => Promise<boolean>;
  onImportWorkspace: () => Promise<boolean>;
}

export function WorkspaceManagerDialog({
  open,
  onOpenChange,
  workspaces,
  activeId,
  onOpenWorkspace,
  onCreateWorkspace,
  onImportWorkspace,
}: WorkspaceManagerDialogProps) {
  const { t } = useTranslation();
  const runAndClose = async (action: () => Promise<boolean>) => {
    if (await action()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("workbench.workspaceManagerTitle")}</DialogTitle>
          <DialogDescription>
            {t("workbench.workspaceManagerDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void runAndClose(onCreateWorkspace)}
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("workbench.newWorkspace")}
            </button>
            <button
              type="button"
              onClick={() => void runAndClose(onImportWorkspace)}
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("workbench.importWorkspace")}
            </button>
          </div>

          <div className="space-y-2">
            {workspaces.map((workspace) => {
              const active = workspace.id === activeId;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={active}
                  onClick={() =>
                    void runAndClose(() => onOpenWorkspace(workspace.id))
                  }
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:border-blue-500/25 disabled:bg-blue-500/[0.04]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                    <FolderKanban className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {workspace.name}
                      </span>
                      {active && (
                        <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase text-blue-400">
                          {t("workbench.activeWorkspace")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>
                        {t("workbench.panelCount", {
                          count: workspace.document.panels.length,
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(workspace.lastOpenedAt)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] capitalize text-muted-foreground">
                    {workspace.document.layout.replace(/-/g, " ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
