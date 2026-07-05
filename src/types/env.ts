export interface EnvConflict {
  varName: string;

  varValue: string;

  sourceType: "system" | "file";

  sourcePath: string;
}

export interface BackupInfo {
  backupPath: string;

  timestamp: string;

  conflicts: EnvConflict[];
}
