import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Columns2,
  Copy,
  Download,
  Grid2X2,
  LayoutDashboard,
  List,
  Loader2,
  Plus,
  Radio,
  Square,
  Upload,
} from "lucide-react";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TerminalPane } from "./TerminalPane";
import { AddSessionDialog } from "./AddSessionDialog";
import { WorkspaceManagerDialog } from "./WorkspaceManagerDialog";
import { WorktreeReviewDialog } from "./WorktreeReviewDialog";
import { ActivityDashboard } from "./ActivityDashboard";
import { BroadcastBar } from "./BroadcastBar";
import {
  workbenchStore,
  MAX_SESSIONS,
  type AddSessionOptions,
  type WorkbenchSession,
} from "./store";
import type { WorkbenchLayoutPreset } from "@/lib/api";

function gridClasses(count: number, layout: WorkbenchLayoutPreset): string {
  if (layout === "single") return "grid-cols-1 grid-rows-1";
  if (layout === "side-by-side") return "grid-cols-2 grid-rows-1";
  if (layout === "grid-2x2") return "grid-cols-2 grid-rows-2";
  // Slots shown = sessions + one "add" tile (until full).
  const slots = Math.min(count + 1, MAX_SESSIONS);
  if (slots <= 1) return "grid-cols-1 grid-rows-1";
  if (slots === 2) return "grid-cols-2 grid-rows-1";
  if (slots <= 4) return "grid-cols-2 grid-rows-2";
  if (slots <= 6) return "grid-cols-3 grid-rows-2";
  return "grid-cols-3 grid-rows-3";
}

function isLayoutUnavailable(
  layout: WorkbenchLayoutPreset,
  sessionCount: number,
): boolean {
  return (
    (layout === "side-by-side" && sessionCount > 2) ||
    (layout === "grid-2x2" && sessionCount > 4)
  );
}

interface SortableSessionPaneProps {
  session: WorkbenchSession;
  focused: boolean;
  onClose: () => void;
  onRestart: () => void;
  onRemove: () => void;
  onToggleFocus: () => void;
  onReviewWorktree: () => void;
  sharedCheckout: boolean;
  otherSessions: WorkbenchSession[];
}

function SortableSessionPane({
  session,
  focused,
  onClose,
  onRestart,
  onRemove,
  onToggleFocus,
  onReviewWorktree,
  sharedCheckout,
  otherSessions,
}: SortableSessionPaneProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id, disabled: focused });

  return (
    <div
      ref={setNodeRef}
      className={`h-full min-h-0 ${isDragging ? "z-20 opacity-70" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TerminalPane
        session={session}
        onClose={onClose}
        onRestart={onRestart}
        onRemove={onRemove}
        focused={focused}
        onToggleFocus={onToggleFocus}
        onReviewWorktree={onReviewWorktree}
        sharedCheckout={sharedCheckout}
        otherSessions={otherSessions}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function WorkbenchPage() {
  const { t } = useTranslation();
  const sessions = useSyncExternalStore(
    workbenchStore.subscribe,
    workbenchStore.getSessions,
  );
  const workspace = useSyncExternalStore(
    workbenchStore.subscribe,
    workbenchStore.getState,
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [isWorkspaceManagerOpen, setIsWorkspaceManagerOpen] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string>();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const visibleSessions = workspace.focusedPanelId
    ? sessions.filter((session) => session.id === workspace.focusedPanelId)
    : sessions;
  const canAddInCurrentLayout =
    workspace.layout === "dashboard" ||
    (workspace.layout === "side-by-side" && sessions.length < 2) ||
    (workspace.layout === "grid-2x2" && sessions.length < 4);

  useEffect(() => {
    void workbenchStore.initialize().catch((error) => {
      toast.error(t("workbench.loadWorkspaceFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    });
  }, [t]);

  useEffect(() => {
    const flushWorkspace = () => {
      void workbenchStore.flush().catch(() => {});
    };
    window.addEventListener("beforeunload", flushWorkspace);
    return () => {
      window.removeEventListener("beforeunload", flushWorkspace);
      flushWorkspace();
    };
  }, []);

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

  const handleWorkspaceAction = async (action: () => Promise<void>) => {
    try {
      await action();
      return true;
    } catch (error) {
      toast.error(t("workbench.workspaceActionFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
      return false;
    }
  };

  const removeSession = async (id: string) => {
    try {
      await workbenchStore.removeSession(id);
    } catch (error) {
      toast.error(t("workbench.removeSessionFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const requestRemove = (id: string) => {
    const session = workbenchStore.getSessions().find((s) => s.id === id);
    if (session?.status === "running") {
      setRemoveTarget(id);
    } else {
      void removeSession(id);
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      workbenchStore.reorderSession(String(active.id), String(over.id));
    }
  };

  const startResize = (
    axis: "column" | "row",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const bounds = grid.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const ratio =
        axis === "column"
          ? ((moveEvent.clientX - bounds.left) / bounds.width) * 100
          : ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      workbenchStore.setLayoutRatios(
        axis === "column" ? { columnRatio: ratio } : { rowRatio: ratio },
      );
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  };

  const customGridStyle =
    workspace.layout === "side-by-side"
      ? {
          gridTemplateColumns: `calc(${workspace.columnRatio}% - 4px) calc(${100 - workspace.columnRatio}% - 4px)`,
        }
      : workspace.layout === "grid-2x2"
        ? {
            gridTemplateColumns: `calc(${workspace.columnRatio}% - 4px) calc(${100 - workspace.columnRatio}% - 4px)`,
            gridTemplateRows: `calc(${workspace.rowRatio}% - 4px) calc(${100 - workspace.rowRatio}% - 4px)`,
          }
        : undefined;

  const exportWorkspace = async () => {
    const safeName = workspace.workspaceName
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const path = await saveFileDialog({
      title: t("workbench.exportWorkspace"),
      defaultPath: `${safeName || "workspace"}.workspace.json`,
      filters: [{ name: "Agent Switchboard workspace", extensions: ["json"] }],
    });
    if (path) await workbenchStore.exportWorkspace(path);
  };

  const importWorkspace = async () => {
    const path = await openFileDialog({
      title: t("workbench.importWorkspace"),
      multiple: false,
      directory: false,
      filters: [{ name: "Agent Switchboard workspace", extensions: ["json"] }],
    });
    if (typeof path === "string") await workbenchStore.importWorkspace(path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-2">
      <div className="mb-2 flex h-9 shrink-0 items-center gap-3">
        <input
          key={`${workspace.workspaceId}:${workspace.workspaceName}`}
          defaultValue={workspace.workspaceName}
          aria-label={t("workbench.workspaceName")}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== workspace.workspaceName) {
              void workbenchStore.renameWorkspace(name).catch((error) => {
                toast.error(t("workbench.renameWorkspaceFailed"), {
                  description: extractErrorMessage(error) || undefined,
                });
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 max-w-sm flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-foreground outline-none transition-colors hover:border-border hover:bg-muted/40 focus:border-blue-500/40 focus:bg-background"
        />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("workbench.savedWorkspace")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t("workbench.workspaces")}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">
              {t("workbench.recentWorkspaces")}
            </DropdownMenuLabel>
            {workspace.recentWorkspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={item.id === workspace.workspaceId}
                onSelect={() =>
                  void handleWorkspaceAction(() =>
                    workbenchStore.openWorkspace(item.id),
                  )
                }
                className="flex-col items-start gap-0.5"
              >
                <span className="max-w-full truncate text-xs font-medium">
                  {item.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("workbench.panelCount", {
                    count: item.document.panels.length,
                  })}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                void handleWorkspaceAction(() =>
                  workbenchStore.createWorkspace(),
                )
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t("workbench.newWorkspace")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void handleWorkspaceAction(() =>
                  workbenchStore.duplicateWorkspace(),
                )
              }
            >
              <Copy className="h-3.5 w-3.5" />
              {t("workbench.duplicateWorkspace")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                void handleWorkspaceAction(() => exportWorkspace())
              }
            >
              <Download className="h-3.5 w-3.5" />
              {t("workbench.exportWorkspace")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void handleWorkspaceAction(() => importWorkspace())
              }
            >
              <Upload className="h-3.5 w-3.5" />
              {t("workbench.importWorkspace")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setIsWorkspaceManagerOpen(true)}>
              <List className="h-3.5 w-3.5" />
              {t("workbench.manageWorkspaces")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center rounded-md border border-border bg-background p-0.5">
          {(
            [
              ["single", Square, "workbench.layoutSingle"],
              ["side-by-side", Columns2, "workbench.layoutSideBySide"],
              ["grid-2x2", Grid2X2, "workbench.layoutGrid"],
              ["dashboard", LayoutDashboard, "workbench.layoutDashboard"],
            ] as const
          ).map(([layout, Icon, label]) => {
            const unavailable = isLayoutUnavailable(layout, sessions.length);
            return (
              <button
                key={layout}
                type="button"
                onClick={() => workbenchStore.setLayout(layout)}
                disabled={unavailable}
                aria-pressed={workspace.layout === layout}
                title={t(label)}
                className={`flex h-6 w-7 items-center justify-center rounded-[4px] transition-colors ${
                  workspace.layout === layout
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setBroadcastOpen((value) => !value)}
          disabled={sessions.length < 2}
          aria-pressed={broadcastOpen}
          title={t("workbench.broadcastToggle")}
          className={cn(
            "flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            broadcastOpen
              ? "border-blue-500/50 bg-blue-500/10 text-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Radio className="h-3.5 w-3.5" />
          {t("workbench.broadcast")}
        </button>
      </div>
      <ActivityDashboard
        sessions={sessions}
        focusedPanelId={workspace.focusedPanelId}
        onSelect={(id) => {
          if (workspace.layout === "single") {
            workbenchStore.setFocusedPanel(id);
          } else {
            workbenchStore.focus(id);
          }
        }}
      />
      {broadcastOpen && sessions.length >= 2 && (
        <BroadcastBar
          sessions={sessions}
          onClose={() => setBroadcastOpen(false)}
        />
      )}
      {workspace.loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleSessions.map((session) => session.id)}
            strategy={rectSortingStrategy}
          >
            <div
              ref={gridRef}
              className={`relative grid gap-2 flex-1 min-h-0 ${gridClasses(
                visibleSessions.length,
                workspace.layout,
              )}`}
              style={customGridStyle}
            >
              {visibleSessions.map((session) => (
                <SortableSessionPane
                  key={session.id}
                  session={session}
                  onClose={() => void workbenchStore.closeSession(session.id)}
                  onRestart={() =>
                    void workbenchStore.relaunchSession(session.id)
                  }
                  onRemove={() => requestRemove(session.id)}
                  focused={workspace.focusedPanelId === session.id}
                  onToggleFocus={() =>
                    workbenchStore.setFocusedPanel(
                      workspace.focusedPanelId === session.id
                        ? undefined
                        : session.id,
                    )
                  }
                  onReviewWorktree={() => setReviewSessionId(session.id)}
                  otherSessions={sessions.filter(
                    (candidate) => candidate.id !== session.id,
                  )}
                  sharedCheckout={Boolean(
                    session.cwd &&
                      !session.sourceCwd &&
                      sessions.some(
                        (candidate) =>
                          candidate.id !== session.id &&
                          !candidate.sourceCwd &&
                          candidate.cwd === session.cwd,
                      ),
                  )}
                />
              ))}
              {!workspace.focusedPanelId &&
                canAddInCurrentLayout &&
                sessions.length < MAX_SESSIONS && (
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
              {!workspace.focusedPanelId &&
                (workspace.layout === "side-by-side" ||
                  workspace.layout === "grid-2x2") && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("workbench.resizeColumns")}
                    onPointerDown={(event) => startResize("column", event)}
                    className="absolute bottom-0 top-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none"
                    style={{ left: `${workspace.columnRatio}%` }}
                  >
                    <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-blue-400/60" />
                  </div>
                )}
              {!workspace.focusedPanelId && workspace.layout === "grid-2x2" && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("workbench.resizeRows")}
                  onPointerDown={(event) => startResize("row", event)}
                  className="absolute left-0 right-0 z-30 h-2 -translate-y-1/2 cursor-row-resize touch-none"
                  style={{ top: `${workspace.rowRatio}%` }}
                >
                  <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors hover:bg-blue-400/60" />
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddSessionDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onSubmit={handleAdd}
      />

      <WorkspaceManagerDialog
        open={isWorkspaceManagerOpen}
        onOpenChange={setIsWorkspaceManagerOpen}
        workspaces={workspace.recentWorkspaces}
        activeId={workspace.workspaceId}
        onOpenWorkspace={(id) =>
          handleWorkspaceAction(() => workbenchStore.openWorkspace(id))
        }
        onCreateWorkspace={() =>
          handleWorkspaceAction(() => workbenchStore.createWorkspace())
        }
        onImportWorkspace={() => handleWorkspaceAction(() => importWorkspace())}
      />

      <WorktreeReviewDialog
        open={Boolean(reviewSessionId)}
        onOpenChange={(open) => {
          if (!open) setReviewSessionId(undefined);
        }}
        session={sessions.find((session) => session.id === reviewSessionId)}
      />

      <ConfirmDialog
        isOpen={Boolean(removeTarget)}
        title={t("workbench.removeConfirmTitle")}
        message={t("workbench.removeConfirmMessage")}
        onConfirm={() => {
          if (removeTarget) {
            void removeSession(removeTarget);
          }
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
