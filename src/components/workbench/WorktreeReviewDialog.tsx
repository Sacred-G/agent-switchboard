import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCommit, GitMerge, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { workbenchApi, type WorkbenchGitStatus } from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { WorkbenchSession } from "./store";

interface WorktreeReviewDialogProps {
  session?: WorkbenchSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DestructiveAction = "discard" | "migrate" | "merge";

export function WorktreeReviewDialog({
  session,
  open,
  onOpenChange,
}: WorktreeReviewDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorkbenchGitStatus>();
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<DestructiveAction>();

  const repository = session?.sourceCwd;
  const worktreePath = session?.cwd;

  const refresh = async () => {
    if (!repository || !worktreePath) return;
    setLoading(true);
    try {
      const [nextStatus, nextDiff] = await Promise.all([
        workbenchApi.getWorktreeStatus(repository, worktreePath),
        workbenchApi.getWorktreeDiff(repository, worktreePath),
      ]);
      setStatus(nextStatus);
      setDiff(nextDiff);
    } catch (error) {
      toast.error(t("workbench.worktreeActionFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, repository, worktreePath]);

  const commit = async () => {
    if (!repository || !worktreePath || !commitMessage.trim()) return;
    setLoading(true);
    try {
      const next = await workbenchApi.commitWorktree(
        repository,
        worktreePath,
        commitMessage.trim(),
      );
      setStatus(next);
      setCommitMessage("");
      await refresh();
      toast.success(t("workbench.worktreeCommitted"));
    } catch (error) {
      toast.error(t("workbench.worktreeActionFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const confirmAction = async () => {
    if (!action || !repository || !worktreePath) return;
    setLoading(true);
    try {
      if (action === "discard") {
        await workbenchApi.discardWorktree(repository, worktreePath);
      } else if (action === "migrate") {
        await workbenchApi.migrateWorktree(repository, worktreePath);
      } else {
        await workbenchApi.mergeWorktree(repository, worktreePath);
      }
      toast.success(
        t(
          `workbench.worktree${action[0].toUpperCase()}${action.slice(1)}Success`,
        ),
      );
      await refresh();
    } catch (error) {
      toast.error(t("workbench.worktreeActionFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    } finally {
      setAction(undefined);
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{t("workbench.reviewWorktree")}</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw
                  className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                />
              </Button>
            </div>
            <DialogDescription>
              {t("workbench.reviewWorktreeDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {status ? (
              <>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">
                      {t("workbench.branch")}
                    </p>
                    <p className="mt-1 truncate font-mono">{status.branch}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("workbench.changedFiles")}
                    </p>
                    <p className="mt-1">
                      {status.changedFiles.length} ·{" "}
                      {status.dirty
                        ? t("workbench.dirty")
                        : t("workbench.clean")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("workbench.latestCommit")}
                    </p>
                    <p
                      className="mt-1 truncate font-mono"
                      title={status.latestCommitSubject}
                    >
                      {status.latestCommit} {status.latestCommitSubject}
                    </p>
                  </div>
                </div>
                {status.changedFiles.length > 0 && (
                  <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                    {status.changedFiles.map((file) => (
                      <code
                        key={file}
                        className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px]"
                      >
                        {file}
                      </code>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder={t("workbench.commitMessage")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commit();
                    }}
                  />
                  <Button
                    onClick={() => void commit()}
                    disabled={loading || !commitMessage.trim()}
                  >
                    <GitCommit className="mr-2 h-4 w-4" />
                    {t("workbench.commitChanges")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAction("migrate")}
                    disabled={loading}
                  >
                    {t("workbench.applyToPrimary")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAction("merge")}
                    disabled={loading || status.dirty}
                  >
                    <GitMerge className="mr-2 h-4 w-4" />
                    {t("workbench.mergeBranch")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setAction("discard")}
                    disabled={loading || !status.dirty}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("workbench.discardChanges")}
                  </Button>
                </div>
                <div className="overflow-hidden rounded-md border bg-[#111118]">
                  <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                    {t("workbench.compareAgainst", {
                      branch: status.primaryBranch,
                    })}
                  </div>
                  <pre className="max-h-[42vh] overflow-auto whitespace-pre p-3 text-[10px] leading-relaxed text-zinc-300">
                    {diff || t("workbench.noWorktreeChanges")}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        isOpen={Boolean(action)}
        title={t(
          `workbench.confirm${action ? action[0].toUpperCase() + action.slice(1) : "Action"}Title`,
        )}
        message={t(
          `workbench.confirm${action ? action[0].toUpperCase() + action.slice(1) : "Action"}Message`,
        )}
        onConfirm={() => void confirmAction()}
        onCancel={() => setAction(undefined)}
      />
    </>
  );
}
