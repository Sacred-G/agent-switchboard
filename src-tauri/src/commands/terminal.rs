#![allow(non_snake_case)]

//! Workbench terminal sessions: embedded PTY-backed CLI sessions rendered by
//! xterm.js in the frontend. Each session is identified by a frontend-generated
//! id; output is streamed via Tauri events, input/resize/close via commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::app_config::AppType;
use crate::services::ProviderService;

use super::misc::{
    extract_env_vars_from_config, get_user_shell, provider_command_flag_for_shell,
    resolve_launch_cwd,
};

pub const TERMINAL_OUTPUT_EVENT: &str = "workbench-terminal-output";
pub const TERMINAL_EXIT_EVENT: &str = "workbench-terminal-exit";

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl TerminalRegistry {
    /// Best-effort kill of all live PTY children (used on app exit).
    pub fn kill_all(&self) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for (id, mut session) in sessions.drain() {
            if let Err(e) = session.killer.kill() {
                log::warn!("workbench: failed to kill terminal {id}: {e}");
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct OutputPayload {
    id: String,
    /// Base64-encoded raw PTY bytes (preserves UTF-8 across chunk boundaries).
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    exitCode: Option<u32>,
}

fn collect_provider_env(
    state: &crate::store::AppState,
    app: &str,
    provider_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let providers = ProviderService::list(state, app_type.clone())
        .map_err(|e| format!("failed to list providers: {e}"))?;
    let provider = providers
        .get(provider_id)
        .ok_or_else(|| format!("provider not found: {provider_id}"))?;
    Ok(extract_env_vars_from_config(
        &provider.settings_config,
        &app_type,
    ))
}

#[cfg(not(target_os = "windows"))]
fn build_command(command: Option<&str>) -> CommandBuilder {
    let shell = get_user_shell();
    let mut cmd = CommandBuilder::new(&shell);
    match command {
        Some(line) if !line.trim().is_empty() => {
            cmd.arg(provider_command_flag_for_shell(&shell));
            cmd.arg(line);
        }
        _ => {
            // Login shell so the user's PATH/profile is loaded (GUI apps on
            // macOS don't inherit the interactive shell environment).
            cmd.arg("-l");
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

#[cfg(target_os = "windows")]
fn build_command(command: Option<&str>) -> CommandBuilder {
    // Silence unused-import warnings on Windows builds.
    let _ = (get_user_shell, provider_command_flag_for_shell);
    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    let mut cmd = CommandBuilder::new(comspec);
    if let Some(line) = command {
        if !line.trim().is_empty() {
            cmd.arg("/C");
            cmd.arg(line);
        }
    }
    cmd
}

#[tauri::command]
pub async fn workbench_create_terminal(
    app_handle: AppHandle,
    state: State<'_, crate::store::AppState>,
    registry: State<'_, TerminalRegistry>,
    id: String,
    command: Option<String>,
    app: Option<String>,
    providerId: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<bool, String> {
    {
        let sessions = registry
            .sessions
            .lock()
            .map_err(|_| "terminal registry poisoned".to_string())?;
        if sessions.contains_key(&id) {
            return Err(format!("terminal already exists: {id}"));
        }
    }

    let launch_cwd = resolve_launch_cwd(cwd)?;

    let mut cmd = build_command(command.as_deref());
    if let Some(dir) = &launch_cwd {
        cmd.cwd(dir);
    }
    if let (Some(app_str), Some(provider_id)) = (app.as_deref(), providerId.as_deref()) {
        for (key, value) in collect_provider_env(state.inner(), app_str, provider_id)? {
            cmd.env(key, value);
        }
    }

    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn command: {e}"))?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| "terminal registry poisoned".to_string())?;
        sessions.insert(
            id.clone(),
            PtySession {
                writer,
                master: pair.master,
                killer,
            },
        );
    }

    let sessions = registry.sessions.clone();
    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_handle.emit(
                        TERMINAL_OUTPUT_EVENT,
                        OutputPayload {
                            id: thread_id.clone(),
                            data,
                        },
                    );
                }
            }
        }
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&thread_id);
        }
        let _ = app_handle.emit(
            TERMINAL_EXIT_EVENT,
            ExitPayload {
                id: thread_id,
                exitCode: exit_code,
            },
        );
    });

    Ok(true)
}

#[tauri::command]
pub async fn workbench_write_terminal(
    registry: State<'_, TerminalRegistry>,
    id: String,
    data: String,
) -> Result<bool, String> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| "terminal registry poisoned".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("failed to write to terminal: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn workbench_resize_terminal(
    registry: State<'_, TerminalRegistry>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "terminal registry poisoned".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("terminal not found: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to resize terminal: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn workbench_close_terminal(
    registry: State<'_, TerminalRegistry>,
    id: String,
) -> Result<bool, String> {
    let session = {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| "terminal registry poisoned".to_string())?;
        sessions.remove(&id)
    };
    if let Some(mut session) = session {
        // The reader thread emits the exit event once the child goes away.
        if let Err(e) = session.killer.kill() {
            log::warn!("workbench: failed to kill terminal {id}: {e}");
        }
    }
    Ok(true)
}

#[tauri::command]
pub async fn workbench_list_terminals(
    registry: State<'_, TerminalRegistry>,
) -> Result<Vec<String>, String> {
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "terminal registry poisoned".to_string())?;
    Ok(sessions.keys().cloned().collect())
}
