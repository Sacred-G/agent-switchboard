import { invoke } from "@tauri-apps/api/core";

import type { AppId } from "@/lib/api/types";

export type AppType =
  | "claude"
  | "claude-desktop"
  | "codex"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes";

export interface SkillApps {
  claude: boolean;
  "claude-desktop"?: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
  openclaw: boolean;
  hermes: boolean;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SkillApps;
  installedAt: number;
  contentHash?: string;
  updatedAt: number;
}

export interface SkillUninstallResult {
  backupPath?: string;
}

export interface SkillBackupEntry {
  backupId: string;
  backupPath: string;
  createdAt: number;
  skill: InstalledSkill;
}

export interface DiscoverableSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
}

export interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  foundIn: string[];
  path: string;
}

export interface ImportSkillSelection {
  directory: string;
  apps: SkillApps;
}

export interface Skill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  installed: boolean;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
}

export interface SkillUpdateInfo {
  id: string;
  name: string;
  currentHash?: string;
  remoteHash: string;
}

export interface MigrationResult {
  migratedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface SkillsShDiscoverableSkill {
  key: string;
  name: string;
  directory: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  installs: number;
  readmeUrl?: string;
}

export interface SkillsShSearchResult {
  skills: SkillsShDiscoverableSkill[];
  totalCount: number;
  query: string;
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

// ========== API ==========

export const skillsApi = {
  async getInstalled(): Promise<InstalledSkill[]> {
    return await invoke("get_installed_skills");
  },

  async getBackups(): Promise<SkillBackupEntry[]> {
    return await invoke("get_skill_backups");
  },

  async deleteBackup(backupId: string): Promise<boolean> {
    return await invoke("delete_skill_backup", { backupId });
  },

  async installUnified(
    skill: DiscoverableSkill,
    currentApp: AppId,
  ): Promise<InstalledSkill> {
    return await invoke("install_skill_unified", { skill, currentApp });
  },

  async uninstallUnified(id: string): Promise<SkillUninstallResult> {
    return await invoke("uninstall_skill_unified", { id });
  },

  async restoreBackup(
    backupId: string,
    currentApp: AppId,
  ): Promise<InstalledSkill> {
    return await invoke("restore_skill_backup", { backupId, currentApp });
  },

  async toggleApp(id: string, app: AppId, enabled: boolean): Promise<boolean> {
    return await invoke("toggle_skill_app", { id, app, enabled });
  },

  async scanUnmanaged(): Promise<UnmanagedSkill[]> {
    return await invoke("scan_unmanaged_skills");
  },

  async importFromApps(
    imports: ImportSkillSelection[],
  ): Promise<InstalledSkill[]> {
    return await invoke("import_skills_from_apps", { imports });
  },

  async discoverAvailable(): Promise<DiscoverableSkill[]> {
    return await invoke("discover_available_skills");
  },

  async checkUpdates(): Promise<SkillUpdateInfo[]> {
    return await invoke("check_skill_updates");
  },

  async updateSkill(id: string): Promise<InstalledSkill> {
    return await invoke("update_skill", { id });
  },

  async migrateStorage(
    target: "cc_switch" | "unified",
  ): Promise<MigrationResult> {
    return await invoke("migrate_skill_storage", { target });
  },

  async searchSkillsSh(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SkillsShSearchResult> {
    return await invoke("search_skills_sh", { query, limit, offset });
  },

  async getAll(app: AppId = "claude"): Promise<Skill[]> {
    if (app === "claude") {
      return await invoke("get_skills");
    }
    return await invoke("get_skills_for_app", { app });
  },

  async install(directory: string, app: AppId = "claude"): Promise<boolean> {
    if (app === "claude") {
      return await invoke("install_skill", { directory });
    }
    return await invoke("install_skill_for_app", { app, directory });
  },

  async uninstall(
    directory: string,
    app: AppId = "claude",
  ): Promise<SkillUninstallResult> {
    if (app === "claude") {
      return await invoke("uninstall_skill", { directory });
    }
    return await invoke("uninstall_skill_for_app", { app, directory });
  },

  async getRepos(): Promise<SkillRepo[]> {
    return await invoke("get_skill_repos");
  },

  async addRepo(repo: SkillRepo): Promise<boolean> {
    return await invoke("add_skill_repo", { repo });
  },

  async removeRepo(owner: string, name: string): Promise<boolean> {
    return await invoke("remove_skill_repo", { owner, name });
  },

  async openZipFileDialog(): Promise<string | null> {
    return await invoke("open_zip_file_dialog");
  },

  async installFromZip(
    filePath: string,
    currentApp: AppId,
  ): Promise<InstalledSkill[]> {
    return await invoke("install_skills_from_zip", { filePath, currentApp });
  },
};
