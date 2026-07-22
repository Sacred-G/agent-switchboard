use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Stdio;
use tauri::{AppHandle, Manager, State};

use crate::database::WorkbenchWorkspaceRecord;
use crate::store::AppState;

const WORKSPACE_EXPORT_FORMAT: &str = "agent-switchboard-workspace";
const WORKSPACE_EXPORT_VERSION: u32 = 1;
const MAX_WORKSPACE_FILE_BYTES: u64 = 1_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchWorktree {
    path: String,
    repository_root: String,
    branch: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchProjectCommand {
    name: String,
    command: String,
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchGitStatus {
    branch: String,
    primary_branch: String,
    dirty: bool,
    changed_files: Vec<String>,
    latest_commit: String,
    latest_commit_subject: String,
}

fn git_output_with_input(cwd: &Path, args: &[&str], input: &[u8]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to run git: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open git stdin".to_string())?
        .write_all(input)
        .map_err(|error| format!("failed to write git input: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for git: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("git command failed with status {}", output.status)
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn resolve_managed_worktree(
    app: &AppHandle,
    repository: &str,
    worktree_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let storage_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("worktrees")
        .canonicalize()
        .map_err(|error| format!("failed to resolve worktree storage: {error}"))?;
    let worktree = PathBuf::from(worktree_path.trim())
        .canonicalize()
        .map_err(|error| format!("failed to resolve worktree: {error}"))?;
    if !worktree.starts_with(&storage_root) {
        return Err("refusing to manage a worktree outside app storage".to_string());
    }
    let root = PathBuf::from(git_output(
        Path::new(repository.trim()),
        &["rev-parse", "--show-toplevel"],
    )?)
    .canonicalize()
    .map_err(|error| format!("failed to resolve repository root: {error}"))?;
    let registered = git_output(&root, &["worktree", "list", "--porcelain"])?;
    let marker = format!("worktree {}", worktree.to_string_lossy());
    if !registered.lines().any(|line| line == marker) {
        return Err("worktree is not registered with this repository".to_string());
    }
    Ok((root, worktree))
}

fn worktree_status(root: &Path, worktree: &Path) -> Result<WorkbenchGitStatus, String> {
    let branch = git_output(worktree, &["branch", "--show-current"])?;
    let primary_branch = git_output(root, &["branch", "--show-current"])?;
    let porcelain = git_output(worktree, &["status", "--porcelain=v1"])?;
    let mut changed_files = porcelain
        .lines()
        .map(|line| {
            line.find(char::is_whitespace)
                .map(|index| line[index..].trim_start())
                .unwrap_or(line)
                .to_string()
        })
        .collect::<BTreeSet<_>>();
    for file in git_output(
        worktree,
        &["diff", "--name-only", &format!("{primary_branch}...HEAD")],
    )?
    .lines()
    {
        changed_files.insert(file.to_string());
    }
    let latest = git_output(worktree, &["log", "-1", "--format=%h%x00%s"])?;
    let (latest_commit, latest_commit_subject) = latest.split_once('\0').unwrap_or((&latest, ""));
    Ok(WorkbenchGitStatus {
        branch,
        primary_branch,
        dirty: !porcelain.is_empty(),
        changed_files: changed_files.into_iter().collect(),
        latest_commit: latest_commit.to_string(),
        latest_commit_subject: latest_commit_subject.to_string(),
    })
}

fn detect_project_commands(directory: &Path) -> Result<Vec<WorkbenchProjectCommand>, String> {
    let directory = directory
        .canonicalize()
        .map_err(|error| format!("failed to resolve working directory: {error}"))?;
    if !directory.is_dir() {
        return Err("working directory does not exist".to_string());
    }
    let package_path = directory.join("package.json");
    if package_path.is_file() {
        let metadata = std::fs::metadata(&package_path)
            .map_err(|error| format!("failed to inspect package.json: {error}"))?;
        if metadata.len() > 512_000 {
            return Err("package.json exceeds the 512 KB limit".to_string());
        }
        let document: Value = serde_json::from_slice(
            &std::fs::read(&package_path)
                .map_err(|error| format!("failed to read package.json: {error}"))?,
        )
        .map_err(|error| format!("package.json is invalid: {error}"))?;
        let manager = if directory.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if directory.join("yarn.lock").exists() {
            "yarn"
        } else if directory.join("bun.lock").exists() || directory.join("bun.lockb").exists() {
            "bun"
        } else {
            "npm"
        };
        let Some(scripts) = document.get("scripts").and_then(Value::as_object) else {
            return Ok(Vec::new());
        };
        let priority = ["dev", "start", "test", "build", "lint", "typecheck"];
        let mut names: Vec<&str> = scripts.keys().map(String::as_str).collect();
        names.sort_by_key(|name| {
            priority
                .iter()
                .position(|candidate| candidate == name)
                .unwrap_or(priority.len())
        });
        names.truncate(12);
        return Ok(names
            .into_iter()
            .map(|name| WorkbenchProjectCommand {
                name: name.to_string(),
                command: match manager {
                    "npm" => format!("npm run {name}"),
                    _ => format!("{manager} {name}"),
                },
                kind: if matches!(name, "dev" | "start" | "serve" | "preview") {
                    "server".to_string()
                } else {
                    "task".to_string()
                },
            })
            .collect());
    }
    let commands = if directory.join("Cargo.toml").is_file() {
        vec![
            ("run", "cargo run", "server"),
            ("test", "cargo test", "task"),
            ("check", "cargo check", "task"),
        ]
    } else {
        Vec::new()
    };
    Ok(commands
        .into_iter()
        .map(|(name, command, kind)| WorkbenchProjectCommand {
            name: name.to_string(),
            command: command.to_string(),
            kind: kind.to_string(),
        })
        .collect())
}

#[tauri::command]
pub async fn detect_workbench_project_commands(
    directory: String,
) -> Result<Vec<WorkbenchProjectCommand>, String> {
    detect_project_commands(Path::new(directory.trim()))
}

fn git_output(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!("git command failed with status {}", output.status)
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_worktree_identifier(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 80
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_string())
}

fn create_worktree_at(
    storage_root: &Path,
    repository: &str,
    workspace_id: &str,
    panel_id: &str,
    requested_branch: Option<&str>,
) -> Result<WorkbenchWorktree, String> {
    let workspace_id = validate_worktree_identifier(workspace_id, "workspace id")?;
    let panel_id = validate_worktree_identifier(panel_id, "panel id")?;
    let repository = PathBuf::from(repository.trim());
    if !repository.is_dir() {
        return Err("working directory does not exist".to_string());
    }
    let repository = repository
        .canonicalize()
        .map_err(|error| format!("failed to resolve working directory: {error}"))?;
    let root = PathBuf::from(git_output(&repository, &["rev-parse", "--show-toplevel"])?);
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve repository root: {error}"))?;
    let default_branch = format!(
        "switchboard/{}-{}",
        &workspace_id[..8.min(workspace_id.len())],
        &panel_id[..8.min(panel_id.len())]
    );
    let branch = requested_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&default_branch)
        .to_string();
    git_output(&root, &["check-ref-format", "--branch", &branch])?;

    let path = storage_root.join(&workspace_id).join(&panel_id);
    if path.exists() {
        return Err("worktree destination already exists".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "worktree destination is invalid".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create worktree storage: {error}"))?;
    let path_text = path.to_string_lossy().into_owned();
    git_output(
        &root,
        &["worktree", "add", "-b", &branch, &path_text, "HEAD"],
    )?;

    Ok(WorkbenchWorktree {
        path: path_text,
        repository_root: root.to_string_lossy().into_owned(),
        branch,
    })
}

#[tauri::command]
pub async fn create_workbench_worktree(
    app: AppHandle,
    repository: String,
    workspaceId: String,
    panelId: String,
    branch: Option<String>,
) -> Result<WorkbenchWorktree, String> {
    let storage_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("worktrees");
    create_worktree_at(
        &storage_root,
        &repository,
        &workspaceId,
        &panelId,
        branch.as_deref(),
    )
}

#[tauri::command]
pub async fn remove_workbench_worktree(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<(), String> {
    let storage_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("worktrees");
    let storage_root = storage_root
        .canonicalize()
        .map_err(|error| format!("failed to resolve worktree storage: {error}"))?;
    let worktree = PathBuf::from(worktreePath.trim())
        .canonicalize()
        .map_err(|error| format!("failed to resolve worktree: {error}"))?;
    if !worktree.starts_with(&storage_root) {
        return Err("refusing to remove a worktree outside app storage".to_string());
    }
    let root = PathBuf::from(git_output(
        Path::new(repository.trim()),
        &["rev-parse", "--show-toplevel"],
    )?);
    let registered = git_output(&root, &["worktree", "list", "--porcelain"])?;
    let marker = format!("worktree {}", worktree.to_string_lossy());
    if !registered.lines().any(|line| line == marker) {
        return Err("worktree is not registered with this repository".to_string());
    }
    if !git_output(&worktree, &["status", "--porcelain"])?.is_empty() {
        return Err(
            "worktree has uncommitted changes; commit or stash them before removing this panel"
                .to_string(),
        );
    }
    let path_text = worktree.to_string_lossy().into_owned();
    git_output(&root, &["worktree", "remove", &path_text])?;
    Ok(())
}

#[tauri::command]
pub async fn get_workbench_worktree_status(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<WorkbenchGitStatus, String> {
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    worktree_status(&root, &worktree)
}

#[tauri::command]
pub async fn get_workbench_worktree_diff(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<String, String> {
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    let primary_branch = git_output(&root, &["branch", "--show-current"])?;
    let diff = git_output(
        &worktree,
        &["diff", "--no-ext-diff", "--binary", &primary_branch],
    )?;
    if diff.len() > 500_000 {
        return Err("worktree diff exceeds the 500 KB review limit".to_string());
    }
    Ok(diff)
}

#[tauri::command]
pub async fn commit_workbench_worktree(
    app: AppHandle,
    repository: String,
    worktreePath: String,
    message: String,
) -> Result<WorkbenchGitStatus, String> {
    let message = message.trim();
    if message.is_empty() || message.chars().count() > 200 || message.chars().any(char::is_control)
    {
        return Err("commit message must be between 1 and 200 characters".to_string());
    }
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    git_output(&worktree, &["add", "-A"])?;
    git_output(&worktree, &["commit", "-m", message])?;
    worktree_status(&root, &worktree)
}

#[tauri::command]
pub async fn discard_workbench_worktree_changes(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<WorkbenchGitStatus, String> {
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    git_output(&worktree, &["reset", "--hard", "HEAD"])?;
    git_output(&worktree, &["clean", "-fd"])?;
    worktree_status(&root, &worktree)
}

#[tauri::command]
pub async fn migrate_workbench_worktree_changes(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<(), String> {
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    if !git_output(&root, &["status", "--porcelain"])?.is_empty() {
        return Err("primary workspace must be clean before applying a worktree patch".to_string());
    }
    let status = git_output(&worktree, &["status", "--porcelain"])?;
    if status.lines().any(|line| line.starts_with("??")) {
        return Err("commit untracked files before applying this worktree as a patch".to_string());
    }
    let primary_branch = git_output(&root, &["branch", "--show-current"])?;
    let patch = git_output(&worktree, &["diff", "--binary", &primary_branch])?;
    if patch.is_empty() {
        return Err("there are no changes to apply".to_string());
    }
    git_output_with_input(&root, &["apply", "--index", "-"], patch.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn merge_workbench_worktree(
    app: AppHandle,
    repository: String,
    worktreePath: String,
) -> Result<(), String> {
    let (root, worktree) = resolve_managed_worktree(&app, &repository, &worktreePath)?;
    if !git_output(&root, &["status", "--porcelain"])?.is_empty() {
        return Err("primary workspace must be clean before merging".to_string());
    }
    if !git_output(&worktree, &["status", "--porcelain"])?.is_empty() {
        return Err("commit or discard worktree changes before merging".to_string());
    }
    let branch = git_output(&worktree, &["branch", "--show-current"])?;
    if let Err(error) = git_output(&root, &["merge", "--no-ff", &branch]) {
        let _ = git_output(&root, &["merge", "--abort"]);
        return Err(format!("merge failed and was aborted: {error}"));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchWorkspaceExport {
    format: String,
    version: u32,
    name: String,
    document: Value,
}

fn validate_workspace_document(document: &Value) -> Result<(), String> {
    let object = document
        .as_object()
        .ok_or_else(|| "workspace document must be a JSON object".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported workspace document version".to_string());
    }
    let layout = object
        .get("layout")
        .and_then(Value::as_str)
        .ok_or_else(|| "workspace layout is missing".to_string())?;
    if !matches!(layout, "single" | "side-by-side" | "grid-2x2" | "dashboard") {
        return Err("workspace layout is not supported".to_string());
    }
    let panels = object
        .get("panels")
        .and_then(Value::as_array)
        .ok_or_else(|| "workspace panels must be an array".to_string())?;
    if panels.len() > 9 {
        return Err("workspace cannot contain more than 9 panels".to_string());
    }
    let mut panel_ids = HashSet::new();
    for panel in panels {
        let panel = panel
            .as_object()
            .ok_or_else(|| "workspace panel must be a JSON object".to_string())?;
        let id = panel
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "workspace panel id is missing".to_string())?;
        if id.is_empty() || id.len() > 80 || !panel_ids.insert(id) {
            return Err("workspace panel ids must be unique and non-empty".to_string());
        }
        let agent = panel
            .get("agent")
            .and_then(Value::as_str)
            .ok_or_else(|| "workspace panel agent is missing".to_string())?;
        if !matches!(
            agent,
            "claude" | "codex" | "gemini" | "opencode" | "shell" | "custom"
        ) {
            return Err("workspace panel agent is not supported".to_string());
        }
        let auth_mode = panel
            .get("authMode")
            .and_then(Value::as_str)
            .ok_or_else(|| "workspace panel auth mode is missing".to_string())?;
        if !matches!(auth_mode, "subscription" | "api") {
            return Err("workspace panel auth mode is not supported".to_string());
        }
        let view = panel
            .get("view")
            .and_then(Value::as_str)
            .ok_or_else(|| "workspace panel view is missing".to_string())?;
        if !matches!(view, "terminal" | "preview") {
            return Err("workspace panel view is not supported".to_string());
        }
        if panel.get("title").and_then(Value::as_str).is_none()
            || panel
                .get("detectedUrls")
                .and_then(Value::as_array)
                .is_none()
            || panel.get("order").and_then(Value::as_u64).is_none()
        {
            return Err("workspace panel metadata is incomplete".to_string());
        }
        for field in ["cwd", "sourceCwd", "worktreeBranch", "previewUrl"] {
            if panel.get(field).is_some_and(|value| !value.is_string()) {
                return Err(format!("workspace panel {field} must be a string"));
            }
        }
        if let Some(history) = panel.get("commandHistory") {
            let history = history
                .as_array()
                .ok_or_else(|| "workspace command history must be an array".to_string())?;
            if history.len() > 50 {
                return Err("workspace command history cannot exceed 50 entries".to_string());
            }
            for record in history {
                let record = record
                    .as_object()
                    .ok_or_else(|| "workspace command record must be an object".to_string())?;
                let command = record.get("command").and_then(Value::as_str).unwrap_or("");
                let output = record.get("output").and_then(Value::as_str).unwrap_or("");
                if command.is_empty() || command.len() > 4_096 || output.len() > 32_000 {
                    return Err("workspace command record exceeds its limits".to_string());
                }
            }
        }
        if panel
            .get("notifyOnComplete")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err("workspace notification preference must be boolean".to_string());
        }
    }
    if let Some(focused) = object.get("focusedPanelId").and_then(Value::as_str) {
        if !panel_ids.contains(focused) {
            return Err("focused workspace panel does not exist".to_string());
        }
    }
    Ok(())
}

fn validate_workspace_file_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err("workspace file path must be absolute".to_string());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("workspace files must use the .json extension".to_string());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
pub async fn list_workbench_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkbenchWorkspaceRecord>, String> {
    state.db.list_workbench_workspaces().map_err(Into::into)
}

#[tauri::command]
pub async fn get_workbench_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<WorkbenchWorkspaceRecord>, String> {
    state.db.get_workbench_workspace(&id).map_err(Into::into)
}

#[tauri::command]
pub async fn save_workbench_workspace(
    state: State<'_, AppState>,
    id: String,
    name: String,
    document: Value,
    opened: Option<bool>,
) -> Result<WorkbenchWorkspaceRecord, String> {
    state
        .db
        .save_workbench_workspace(&id, &name, &document, opened.unwrap_or(false))
        .map_err(Into::into)
}

#[tauri::command]
pub async fn touch_workbench_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.touch_workbench_workspace(&id).map_err(Into::into)
}

#[tauri::command]
pub async fn delete_workbench_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.db.delete_workbench_workspace(&id).map_err(Into::into)
}

#[tauri::command]
pub async fn export_workbench_workspace(
    path: String,
    name: String,
    document: Value,
) -> Result<(), String> {
    let path = validate_workspace_file_path(&path)?;
    validate_workspace_document(&document)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("workspace name is invalid".to_string());
    }
    let payload = WorkbenchWorkspaceExport {
        format: WORKSPACE_EXPORT_FORMAT.to_string(),
        version: WORKSPACE_EXPORT_VERSION,
        name: name.to_string(),
        document,
    };
    let bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("failed to serialize workspace: {error}"))?;
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err("workspace file exceeds the 1 MB limit".to_string());
    }
    std::fs::write(&path, bytes).map_err(|error| format!("failed to write workspace file: {error}"))
}

#[tauri::command]
pub async fn import_workbench_workspace(path: String) -> Result<WorkbenchWorkspaceExport, String> {
    let path = validate_workspace_file_path(&path)?;
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("failed to inspect workspace file: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err("workspace file is invalid or exceeds the 1 MB limit".to_string());
    }
    let bytes =
        std::fs::read(&path).map_err(|error| format!("failed to read workspace file: {error}"))?;
    let payload: WorkbenchWorkspaceExport = serde_json::from_slice(&bytes)
        .map_err(|error| format!("workspace file is not valid JSON: {error}"))?;
    if payload.format != WORKSPACE_EXPORT_FORMAT || payload.version != WORKSPACE_EXPORT_VERSION {
        return Err("unsupported workspace export format".to_string());
    }
    let name = payload.name.trim();
    if name.is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("workspace name is invalid".to_string());
    }
    validate_workspace_document(&payload.document)?;
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process::Command;

    #[test]
    fn detects_pnpm_project_commands_in_priority_order() {
        let directory = tempfile::tempdir().expect("temp directory");
        std::fs::write(
            directory.path().join("package.json"),
            r#"{"scripts":{"build":"vite build","dev":"vite","lint":"eslint ."}}"#,
        )
        .expect("write package.json");
        std::fs::write(
            directory.path().join("pnpm-lock.yaml"),
            "lockfileVersion: 9",
        )
        .expect("write lockfile");

        let commands = detect_project_commands(directory.path()).expect("detect commands");
        assert_eq!(commands[0].command, "pnpm dev");
        assert_eq!(commands[0].kind, "server");
        assert_eq!(commands[1].command, "pnpm build");
    }

    #[test]
    fn creates_an_isolated_git_worktree() {
        let repository = tempfile::tempdir().expect("repository");
        let storage = tempfile::tempdir().expect("storage");
        for args in [
            vec!["init"],
            vec!["config", "user.email", "switchboard@example.invalid"],
            vec!["config", "user.name", "Agent Switchboard"],
        ] {
            assert!(Command::new("git")
                .args(args)
                .current_dir(repository.path())
                .status()
                .expect("run git")
                .success());
        }
        std::fs::write(repository.path().join("README.md"), "test").expect("write file");
        assert!(Command::new("git")
            .args(["add", "README.md"])
            .current_dir(repository.path())
            .status()
            .expect("git add")
            .success());
        assert!(Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repository.path())
            .status()
            .expect("git commit")
            .success());

        let worktree = create_worktree_at(
            storage.path(),
            &repository.path().to_string_lossy(),
            "workspace-1234",
            "panel-5678",
            Some("switchboard/test-panel"),
        )
        .expect("create worktree");
        assert_eq!(worktree.branch, "switchboard/test-panel");
        assert!(Path::new(&worktree.path).join("README.md").is_file());
        std::fs::write(Path::new(&worktree.path).join("README.md"), "changed")
            .expect("change worktree file");
        let status = worktree_status(repository.path(), Path::new(&worktree.path))
            .expect("read worktree status");
        assert!(status.dirty);
        assert_eq!(status.changed_files, vec!["README.md"]);
        git_output(Path::new(&worktree.path), &["add", "-A"]).expect("stage change");
        git_output(Path::new(&worktree.path), &["commit", "-m", "agent change"])
            .expect("commit change");
        let committed = worktree_status(repository.path(), Path::new(&worktree.path))
            .expect("read committed status");
        assert!(!committed.dirty);
        assert_eq!(committed.changed_files, vec!["README.md"]);
        git_output(
            repository.path(),
            &["merge", "--no-ff", "switchboard/test-panel"],
        )
        .expect("merge agent branch");
        assert_eq!(
            std::fs::read_to_string(repository.path().join("README.md")).expect("read merged file"),
            "changed"
        );
    }

    #[test]
    fn workspace_export_import_round_trip() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("website.workspace.json");
        let document = json!({
            "schemaVersion": 1,
            "layout": "grid-2x2",
            "panels": [{
                "id": "panel-1",
                "agent": "codex",
                "authMode": "subscription",
                "title": "Codex",
                "detectedUrls": [],
                "view": "terminal",
                "order": 0
            }]
        });

        futures::executor::block_on(export_workbench_workspace(
            path.to_string_lossy().into_owned(),
            "Website redesign".to_string(),
            document.clone(),
        ))
        .expect("export workspace");
        let imported = futures::executor::block_on(import_workbench_workspace(
            path.to_string_lossy().into_owned(),
        ))
        .expect("import workspace");

        assert_eq!(imported.format, WORKSPACE_EXPORT_FORMAT);
        assert_eq!(imported.version, WORKSPACE_EXPORT_VERSION);
        assert_eq!(imported.name, "Website redesign");
        assert_eq!(imported.document, document);
    }

    #[test]
    fn workspace_import_rejects_unversioned_payload() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("invalid.json");
        std::fs::write(&path, br#"{"name":"Invalid","document":{}}"#)
            .expect("write invalid workspace");

        let error = futures::executor::block_on(import_workbench_workspace(
            path.to_string_lossy().into_owned(),
        ))
        .expect_err("reject unversioned workspace");
        assert!(error.contains("workspace file is not valid JSON"));
    }
}
