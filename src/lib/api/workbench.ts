import { invoke } from "@tauri-apps/api/core";

export type WorkbenchLayoutPreset =
  | "single"
  | "side-by-side"
  | "grid-2x2"
  | "dashboard";
export type WorkbenchPanelView = "terminal" | "preview";
export type WorkbenchActivity = "working" | "waiting" | "failed" | "complete";

export interface WorkbenchCommandRecord {
  id: string;
  command: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  output: string;
  pinned?: boolean;
  failureHint?: string;
  quickFixCommand?: string;
  terminalLine?: number;
}

export interface PersistedWorkbenchPanel {
  id: string;
  agent: "claude" | "codex" | "gemini" | "opencode" | "shell" | "custom";
  authMode: "subscription" | "api";
  app?: string;
  providerId?: string;
  providerName?: string;
  command?: string;
  title: string;
  subtitle?: string;
  cwd?: string;
  sourceCwd?: string;
  worktreeBranch?: string;
  commandHistory?: WorkbenchCommandRecord[];
  notifyOnComplete?: boolean;
  previewUrl?: string;
  detectedUrls: string[];
  view: WorkbenchPanelView;
  order: number;
  size?: number;
}

export interface WorkbenchWorkspaceDocument {
  schemaVersion: 1;
  layout: WorkbenchLayoutPreset;
  focusedPanelId?: string;
  columnRatio?: number;
  rowRatio?: number;
  panels: PersistedWorkbenchPanel[];
}

export interface WorkbenchWorkspaceRecord {
  id: string;
  name: string;
  document: WorkbenchWorkspaceDocument;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface WorkbenchWorkspaceExport {
  format: "agent-switchboard-workspace";
  version: 1;
  name: string;
  document: WorkbenchWorkspaceDocument;
}

export interface WorkbenchWorktree {
  path: string;
  repositoryRoot: string;
  branch: string;
}

export interface WorkbenchProjectCommand {
  name: string;
  command: string;
  kind: "server" | "task";
}

export interface WorkbenchGitStatus {
  branch: string;
  primaryBranch: string;
  dirty: boolean;
  changedFiles: string[];
  latestCommit: string;
  latestCommitSubject: string;
}

export const workbenchApi = {
  list(): Promise<WorkbenchWorkspaceRecord[]> {
    return invoke("list_workbench_workspaces");
  },

  get(id: string): Promise<WorkbenchWorkspaceRecord | null> {
    return invoke("get_workbench_workspace", { id });
  },

  save(
    id: string,
    name: string,
    document: WorkbenchWorkspaceDocument,
    opened = false,
  ): Promise<WorkbenchWorkspaceRecord> {
    return invoke("save_workbench_workspace", { id, name, document, opened });
  },

  touch(id: string): Promise<void> {
    return invoke("touch_workbench_workspace", { id });
  },

  delete(id: string): Promise<void> {
    return invoke("delete_workbench_workspace", { id });
  },

  export(
    path: string,
    name: string,
    document: WorkbenchWorkspaceDocument,
  ): Promise<void> {
    return invoke("export_workbench_workspace", { path, name, document });
  },

  import(path: string): Promise<WorkbenchWorkspaceExport> {
    return invoke("import_workbench_workspace", { path });
  },

  createWorktree(options: {
    repository: string;
    workspaceId: string;
    panelId: string;
    branch?: string;
  }): Promise<WorkbenchWorktree> {
    return invoke("create_workbench_worktree", options);
  },

  removeWorktree(repository: string, worktreePath: string): Promise<void> {
    return invoke("remove_workbench_worktree", { repository, worktreePath });
  },

  detectProjectCommands(directory: string): Promise<WorkbenchProjectCommand[]> {
    return invoke("detect_workbench_project_commands", { directory });
  },

  getWorktreeStatus(
    repository: string,
    worktreePath: string,
  ): Promise<WorkbenchGitStatus> {
    return invoke("get_workbench_worktree_status", {
      repository,
      worktreePath,
    });
  },

  getWorktreeDiff(repository: string, worktreePath: string): Promise<string> {
    return invoke("get_workbench_worktree_diff", { repository, worktreePath });
  },

  commitWorktree(
    repository: string,
    worktreePath: string,
    message: string,
  ): Promise<WorkbenchGitStatus> {
    return invoke("commit_workbench_worktree", {
      repository,
      worktreePath,
      message,
    });
  },

  discardWorktree(
    repository: string,
    worktreePath: string,
  ): Promise<WorkbenchGitStatus> {
    return invoke("discard_workbench_worktree_changes", {
      repository,
      worktreePath,
    });
  },

  migrateWorktree(repository: string, worktreePath: string): Promise<void> {
    return invoke("migrate_workbench_worktree_changes", {
      repository,
      worktreePath,
    });
  },

  mergeWorktree(repository: string, worktreePath: string): Promise<void> {
    return invoke("merge_workbench_worktree", { repository, worktreePath });
  },
};
