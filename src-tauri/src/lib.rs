mod app_config;
mod app_store;
mod auto_launch;
mod claude_desktop_config;
mod claude_mcp;
mod claude_plugin;
mod codex_config;
mod codex_history_migration;
mod commands;
mod config;
mod database;
mod deeplink;
mod error;
mod gemini_config;
mod gemini_mcp;
pub mod hermes_config;
mod init_status;
mod lightweight;
#[cfg(target_os = "linux")]
mod linux_fix;
mod mcp;
mod openclaw_config;
mod opencode_config;
mod panic_hook;
mod prompt;
mod prompt_files;
mod provider;
mod provider_defaults;
mod proxy;
mod services;
mod session_manager;
mod settings;
mod store;

mod tray;
mod usage_events;
mod usage_script;

pub use app_config::{AppType, InstalledSkill, McpApps, McpServer, MultiAppConfig, SkillApps};
pub use codex_config::{get_codex_auth_path, get_codex_config_path, write_codex_live_atomic};
pub use commands::open_provider_terminal;
pub use commands::*;
pub use config::{get_claude_mcp_path, get_claude_settings_path, read_json_file};
pub use database::Database;
pub use deeplink::{import_provider_from_deeplink, parse_deeplink_url, DeepLinkImportRequest};
pub use error::AppError;
pub use mcp::{
    import_from_claude, import_from_codex, import_from_gemini, remove_server_from_claude,
    remove_server_from_codex, remove_server_from_gemini, sync_enabled_to_claude,
    sync_enabled_to_codex, sync_enabled_to_gemini, sync_single_server_to_claude,
    sync_single_server_to_codex, sync_single_server_to_gemini,
};
pub use provider::{Provider, ProviderMeta};
pub use services::{
    skill::{migrate_skills_to_ssot, ImportSkillSelection},
    ConfigService, EndpointLatency, McpService, PromptService, ProviderService, ProxyService,
    SkillService, SpeedtestService,
};
pub use settings::{update_settings, AppSettings};
pub use store::AppState;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use std::sync::Arc;
#[cfg(target_os = "macos")]
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::RunEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[cfg(target_os = "windows")]
fn set_windows_app_user_model_id(app: &tauri::AppHandle) {
    let app_id = app.config().identifier.clone();
    let wide_app_id: Vec<u16> = app_id.encode_utf16().chain(std::iter::once(0)).collect();

    let result = unsafe {
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(wide_app_id.as_ptr())
    };

    if result < 0 {
        log::warn!("failed to set Windows AppUserModelID: 0x{result:08X}");
    } else {
        log::debug!("Windows AppUserModelID  {app_id}");
    }
}

fn redact_url_for_log(url_str: &str) -> String {
    match url::Url::parse(url_str) {
        Ok(url) => {
            let mut output = format!("{}://", url.scheme());
            if let Some(host) = url.host_str() {
                output.push_str(host);
            }
            output.push_str(url.path());

            let mut keys: Vec<String> = url.query_pairs().map(|(k, _)| k.to_string()).collect();
            keys.sort();
            keys.dedup();

            if !keys.is_empty() {
                output.push_str("?[keys:");
                output.push_str(&keys.join(","));
                output.push(']');
            }

            output
        }
        Err(_) => {
            let base = url_str.split('#').next().unwrap_or(url_str);
            match base.split_once('?') {
                Some((prefix, _)) => format!("{prefix}?[redacted]"),
                None => base.to_string(),
            }
        }
    }
}

///
fn handle_deeplink_url(
    app: &tauri::AppHandle,
    url_str: &str,
    focus_main_window: bool,
    source: &str,
) -> bool {
    if !url_str.starts_with("agent-switchboard://") {
        return false;
    }

    let redacted_url = redact_url_for_log(url_str);
    log::info!("✓ Deep link URL detected from {source}: {redacted_url}");
    log::debug!("Deep link URL (raw) from {source}: {url_str}");

    match crate::deeplink::parse_deeplink_url(url_str) {
        Ok(request) => {
            log::info!(
                "✓ Successfully parsed deep link: resource={}, app={:?}, name={:?}",
                request.resource,
                request.app,
                request.name
            );

            if let Err(e) = app.emit("deeplink-import", &request) {
                log::error!("✗ failed to emit deeplink-import event: {e}");
            } else {
                log::info!("✓ Emitted deeplink-import event to frontend");
            }

            if focus_main_window {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    #[cfg(target_os = "linux")]
                    {
                        linux_fix::nudge_main_window(window.clone());
                    }
                    log::info!("✓ Window shown and focused");
                }
            }
        }
        Err(e) => {
            log::error!("✗ failed to parse deep link URL: {e}");

            if let Err(emit_err) = app.emit(
                "deeplink-error",
                serde_json::json!({
                    "url": url_str,
                    "error": e.to_string()
                }),
            ) {
                log::error!("✗ failed to emit deeplink-error event: {emit_err}");
            }
        }
    }

    true
}

#[tauri::command]
async fn update_tray_menu(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    match tray::create_tray_menu(&app, state.inner()) {
        Ok(new_menu) => {
            if let Some(tray) = app.tray_by_id(tray::TRAY_ID) {
                tray.set_menu(Some(new_menu))
                    .map_err(|e| format!("failed: {e}"))?;
                return Ok(true);
            }
            Ok(false)
        }
        Err(err) => {
            log::error!("failed to create tray menu: {err}");
            Ok(false)
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_tray_icon() -> Option<Image<'static>> {
    const ICON_BYTES: &[u8] = include_bytes!("../icons/tray/macos/statusbar_template_3x.png");

    match Image::from_bytes(ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(err) => {
            log::warn!("failed to load macOS tray icon: {err}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migrate old configuration directory if it exists
    config::migrate_cc_switch_dir();

    panic_hook::setup_panic_hook();

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            log::info!("=== Single Instance Callback Triggered ===");
            log::debug!("Args count: {}", args.len());
            for (i, arg) in args.iter().enumerate() {
                log::debug!("  arg[{i}]: {}", redact_url_for_log(arg));
            }

            if crate::lightweight::is_lightweight_mode() {
                if let Err(e) = crate::lightweight::exit_lightweight_mode(app) {
                    log::error!("failed to exit lightweight mode and rebuild window: {e}");
                }
            }

            // Check for deep link URL in args (mainly for Windows/Linux command line)
            let mut found_deeplink = false;
            for arg in &args {
                if handle_deeplink_url(app, arg, false, "single_instance args") {
                    found_deeplink = true;
                    break;
                }
            }

            if !found_deeplink {
                log::info!("ℹ No deep link URL found in args (this is expected on macOS when launched via system)");
            }

            // Show and focus window regardless
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                #[cfg(target_os = "linux")]
                {
                    linux_fix::nudge_main_window(window.clone());
                }
            }
        }));
    }

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let in_db_recovery = crate::init_status::get_init_error()
                    .map(|p| p.kind.as_deref() == Some("db_version_too_new"))
                    .unwrap_or(false);
                if in_db_recovery {
                    api.prevent_close();
                    window.app_handle().exit(0);
                    return;
                }

                let settings = crate::settings::get_settings();

                if settings.minimize_to_tray_on_close {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    {
                        let _ = window.set_skip_taskbar(true);
                    }
                    #[cfg(target_os = "macos")]
                    {
                        tray::apply_tray_policy(window.app_handle(), false);
                    }
                } else {
                    api.prevent_close();
                    window.app_handle().exit(0);
                }
            }
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .setup(|app| {
            let _ = rustls::crypto::ring::default_provider().install_default();

            app_store::refresh_app_config_dir_override(app.handle());
            panic_hook::init_app_config_dir(crate::config::get_app_config_dir());
            #[cfg(target_os = "windows")]
            set_windows_app_user_model_id(app.handle());

            #[cfg(desktop)]
            {
                if let Err(e) = app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())
                {
                    log::warn!(" Updater failed: {e}");
                }
            }
            {
                use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

                let log_dir = panic_hook::get_log_dir();

                if let Err(e) = std::fs::create_dir_all(&log_dir) {
                    eprintln!("failed: {e}");
                }

                let log_file_path = log_dir.join("agent-switchboard.log");
                let _ = std::fs::remove_file(&log_file_path);

                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Trace)
                        .targets([
                            Target::new(TargetKind::Stdout),
                            Target::new(TargetKind::Folder {
                                path: log_dir,
                                file_name: Some("agent-switchboard".into()),
                            }),
                        ])
                        .rotation_strategy(RotationStrategy::KeepSome(2))
                        .max_file_size(1024 * 1024 * 1024)
                        .timezone_strategy(TimezoneStrategy::UseLocal)
                        .build(),
                )?;
            }

            usage_events::init(app.handle().clone());

            let app_config_dir = crate::config::get_app_config_dir();
            let db_path = app_config_dir.join("agent-switchboard.db");
            let json_path = app_config_dir.join("config.json");

            let has_json = json_path.exists();
            let has_db = db_path.exists();

            let migration_config = if !has_db && has_json {
                log::info!("ConfigureConfigure...");

                loop {
                    match crate::app_config::MultiAppConfig::load() {
                        Ok(config) => {
                            log::info!("✓ ConfigureSuccess");
                            break Some(config);
                        }
                        Err(e) => {
                            log::error!("Configurefailed: {e}");
                            if !show_migration_error_dialog(app.handle(), &e.to_string()) {
                                log::info!("Exit");
                                std::process::exit(1);
                            }
                            log::info!("RetryConfigure");
                        }
                    }
                }
            } else {
                None
            };

            //
            //
            match crate::database::Database::stored_user_version_exceeds_supported(&db_path) {
                Ok(Some(version)) => {
                    log::warn!("v{version}");
                    crate::init_status::set_init_error(crate::init_status::InitErrorPayload {
                        path: db_path.display().to_string(),
                        error: format!(
                            "{version} {}。",
                            crate::database::SCHEMA_VERSION
                        ),
                        kind: Some("db_version_too_new".to_string()),
                        db_version: Some(version),
                        supported_version: Some(crate::database::SCHEMA_VERSION),
                    });
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    return Ok(());
                }
                Ok(None) => {}
                Err(e) => {
                    log::warn!("failed to pre-check database version, continuing normal initialization process: {e}");
                }
            }

            let db = loop {
                match crate::database::Database::init() {
                    Ok(db) => break Arc::new(db),
                    Err(e) => {
                        log::error!("failed to init database: {e}");

                        if !show_database_init_error_dialog(app.handle(), &db_path, &e.to_string())
                        {
                            log::info!("Exit");
                            std::process::exit(1);
                        }

                        log::info!("Retry");
                    }
                }
            };

            if let Some(config) = migration_config {
                log::info!("...");

                match db.migrate_from_json(&config) {
                    Ok(_) => {
                        log::info!("✓ ConfigureSuccess");
                        crate::init_status::set_migration_success();
                        let archive_path = json_path.with_extension("json.migrated");
                        if let Err(e) = std::fs::rename(&json_path, &archive_path) {
                            log::warn!("Configurefailed: {e}");
                        } else {
                            log::info!("✓ Configure config.json.migrated");
                        }
                    }
                    Err(e) => {
                        log::error!("Configurefailed: {e}Configure");
                    }
                }
            }

            let app_state = AppState::new(db);

            app_state.proxy_service.set_app_handle(app.handle().clone());

            // ============================================================
            // ============================================================

            match app_state.db.init_default_skill_repos() {
                Ok(count) if count > 0 => {
                    log::info!("✓ Initialized {count} default skill repositories");
                }
                Ok(_) => {}
                Err(e) => log::warn!("✗ failed to initialize default skill repos: {e}"),
            }

            match app_state.db.get_setting("skills_ssot_migration_pending") {
                Ok(Some(flag)) if flag == "true" || flag == "1" => {
                    let has_existing = app_state
                        .db
                        .get_all_installed_skills()
                        .map(|skills| !skills.is_empty())
                        .unwrap_or(false);

                    if has_existing {
                        log::info!(
                            "Detected skills_ssot_migration_pending but skills table not empty; skipping auto import."
                        );
                        let _ = app_state
                            .db
                            .set_setting("skills_ssot_migration_pending", "false");
                    } else {
                        match crate::services::skill::migrate_skills_to_ssot(&app_state.db) {
                            Ok(count) => {
                                log::info!("✓ Auto imported {count} skill(s) into SSOT");
                                if count > 0 {
                                    crate::init_status::set_skills_migration_result(count);
                                }
                                let _ = app_state
                                    .db
                                    .set_setting("skills_ssot_migration_pending", "false");
                            }
                            Err(e) => {
                                log::warn!("✗ failed to auto import legacy skills to SSOT: {e}");
                                crate::init_status::set_skills_migration_error(e.to_string());
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => log::warn!("✗ failed to read skills migration flag: {e}"),
            }

            //
            //
            let first_run_already_confirmed = crate::settings::get_settings()
                .first_run_notice_confirmed
                .unwrap_or(false);
            let fresh_install_at_startup =
                app_state.db.is_providers_empty().unwrap_or(false);

            for app_type in
                crate::app_config::AppType::all().filter(|t| !t.is_additive_mode())
            {
                if !crate::services::provider::should_import_default_config_on_startup(
                    &app_state,
                    &app_type,
                )
                .unwrap_or(false)
                {
                    log::debug!(
                        "○ {} already has providers; live import skipped",
                        app_type.as_str()
                    );
                    continue;
                }

                match crate::services::provider::import_default_config(
                    &app_state,
                    app_type.clone(),
                ) {
                    Ok(true) => log::info!(
                        "✓ Imported live config for {} as default provider",
                        app_type.as_str()
                    ),
                    Ok(false) => log::debug!(
                        "○ {} already has providers; live import skipped",
                        app_type.as_str()
                    ),
                    Err(e) => log::debug!(
                        "○ No live config to import for {}: {e}",
                        app_type.as_str()
                    ),
                }
            }

            match app_state.db.init_default_official_providers() {
                Ok(count) if count > 0 => {
                    log::info!("✓ Seeded {count} official provider(s)");
                }
                Ok(_) => {}
                Err(e) => log::warn!("✗ failed to seed official providers: {e}"),
            }

            {
                let db_for_codex_history_migration = app_state.db.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    match crate::codex_history_migration::maybe_migrate_codex_third_party_history_provider_bucket(
                        &db_for_codex_history_migration,
                    ) {
                        Ok(outcome) => {
                            if let Some(reason) = outcome.skipped_reason {
                                log::debug!("○ Codex history provider bucket migration skipped: {reason}");
                            } else {
                                log::info!(
                                    "✓ Codex history provider bucket migration completed: sources={}, jsonl_files={}, state_rows={}",
                                    outcome.source_provider_ids.len(),
                                    outcome.migrated_jsonl_files,
                                    outcome.migrated_state_rows
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!("✗ Codex history provider bucket migration failed: {e}");
                        }
                    }

                    match crate::codex_history_migration::maybe_migrate_codex_provider_template_bucket(
                        &db_for_codex_history_migration,
                    ) {
                        Ok(outcome) => {
                            if let Some(reason) = outcome.skipped_reason {
                                log::debug!("○ Codex provider template bucket migration skipped: {reason}");
                            } else if !outcome.migrated_provider_ids.is_empty() {
                                log::info!(
                                    "✓ Codex provider template bucket migration completed: providers={}",
                                    outcome.migrated_provider_ids.len()
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!("✗ Codex provider template bucket migration failed: {e}");
                        }
                    }

                    match crate::codex_history_migration::maybe_migrate_codex_official_history_to_unified_bucket() {
                        Ok(outcome) => {
                            if let Some(reason) = outcome.skipped_reason {
                                log::debug!("○ Codex official history unify migration skipped: {reason}");
                            } else {
                                log::info!(
                                    "✓ Codex official history unify migration completed: jsonl_files={}, state_rows={}",
                                    outcome.migrated_jsonl_files,
                                    outcome.migrated_state_rows
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!("✗ Codex official history unify migration failed: {e}");
                        }
                    }
                });
            }

            if !first_run_already_confirmed && fresh_install_at_startup {
                log::info!("✓ First-run welcome notice pending");
            }

            //
            //
            match crate::services::provider::import_opencode_providers_from_live(&app_state) {
                Ok(count) if count > 0 => {
                    log::info!("✓ Imported {count} OpenCode provider(s) from live config");
                }
                Ok(_) => log::debug!("○ No new OpenCode providers to import"),
                Err(e) => log::warn!("✗ failed to import OpenCode providers: {e}"),
            }
            match crate::services::provider::import_openclaw_providers_from_live(&app_state) {
                Ok(count) if count > 0 => {
                    log::info!("✓ Imported {count} OpenClaw provider(s) from live config");
                }
                Ok(_) => log::debug!("○ No new OpenClaw providers to import"),
                Err(e) => log::warn!("✗ failed to import OpenClaw providers: {e}"),
            }
            match crate::services::provider::import_hermes_providers_from_live(&app_state) {
                Ok(count) if count > 0 => {
                    log::info!("✓ Imported {count} Hermes provider(s) from live config");
                }
                Ok(_) => log::debug!("○ No new Hermes providers to import"),
                Err(e) => log::warn!("✗ failed to import Hermes providers: {e}"),
            }

            {
                let has_omo = app_state
                    .db
                    .get_all_providers("opencode")
                    .map(|providers| providers.values().any(|p| p.category.as_deref() == Some("omo")))
                    .unwrap_or(false);
                if !has_omo {
                    match crate::services::OmoService::import_from_local(&app_state, &crate::services::omo::STANDARD) {
                        Ok(provider) => {
                            log::info!("✓ Imported OMO config from local as provider '{}'", provider.name);
                        }
                        Err(AppError::OmoConfigNotFound) => {
                            log::debug!("○ No OMO config to import");
                        }
                        Err(e) => {
                            log::warn!("✗ failed to import OMO config from local: {e}");
                        }
                    }
                }
            }

            // 2.3 OMO Slim config import (when no omo-slim provider in DB, import from local)
            {
                let has_omo_slim = app_state
                    .db
                    .get_all_providers("opencode")
                    .map(|providers| {
                        providers
                            .values()
                            .any(|p| p.category.as_deref() == Some("omo-slim"))
                    })
                    .unwrap_or(false);
                if !has_omo_slim {
                    match crate::services::OmoService::import_from_local(&app_state, &crate::services::omo::SLIM) {
                        Ok(provider) => {
                            log::info!(
                                "✓ Imported OMO Slim config from local as provider '{}'",
                                provider.name
                            );
                        }
                        Err(AppError::OmoConfigNotFound) => {
                            log::debug!("○ No OMO Slim config to import");
                        }
                        Err(e) => {
                            log::warn!("✗ failed to import OMO Slim config from local: {e}");
                        }
                    }
                }
            }

            if app_state.db.is_mcp_table_empty().unwrap_or(false) {
                log::info!("MCP table empty, importing from live configurations...");

                match crate::services::mcp::McpService::import_from_claude(&app_state) {
                    Ok(count) if count > 0 => {
                        log::info!("✓ Imported {count} MCP server(s) from Claude");
                    }
                    Ok(_) => log::debug!("○ No Claude MCP servers found to import"),
                    Err(e) => log::warn!("✗ failed to import Claude MCP: {e}"),
                }

                match crate::services::mcp::McpService::import_from_codex(&app_state) {
                    Ok(count) if count > 0 => {
                        log::info!("✓ Imported {count} MCP server(s) from Codex");
                    }
                    Ok(_) => log::debug!("○ No Codex MCP servers found to import"),
                    Err(e) => log::warn!("✗ failed to import Codex MCP: {e}"),
                }

                match crate::services::mcp::McpService::import_from_gemini(&app_state) {
                    Ok(count) if count > 0 => {
                        log::info!("✓ Imported {count} MCP server(s) from Gemini");
                    }
                    Ok(_) => log::debug!("○ No Gemini MCP servers found to import"),
                    Err(e) => log::warn!("✗ failed to import Gemini MCP: {e}"),
                }

                match crate::services::mcp::McpService::import_from_opencode(&app_state) {
                    Ok(count) if count > 0 => {
                        log::info!("✓ Imported {count} MCP server(s) from OpenCode");
                    }
                    Ok(_) => log::debug!("○ No OpenCode MCP servers found to import"),
                    Err(e) => log::warn!("✗ failed to import OpenCode MCP: {e}"),
                }

                match crate::services::mcp::McpService::import_from_hermes(&app_state) {
                    Ok(count) if count > 0 => {
                        log::info!("✓ Imported {count} MCP server(s) from Hermes");
                    }
                    Ok(_) => log::debug!("○ No Hermes MCP servers found to import"),
                    Err(e) => log::warn!("✗ failed to import Hermes MCP: {e}"),
                }
            }

            if app_state.db.is_prompts_table_empty().unwrap_or(false) {
                log::info!("Prompts table empty, importing from live configurations...");

                for app in [
                    crate::app_config::AppType::Claude,
                    crate::app_config::AppType::Codex,
                    crate::app_config::AppType::Gemini,
                    crate::app_config::AppType::OpenCode,
                    crate::app_config::AppType::OpenClaw,
                    crate::app_config::AppType::Hermes,
                ] {
                    match crate::services::prompt::PromptService::import_from_file_on_first_launch(
                        &app_state,
                        app.clone(),
                    ) {
                        Ok(count) if count > 0 => {
                            log::info!("✓ Imported {count} prompt(s) for {}", app.as_str());
                        }
                        Ok(_) => log::debug!("○ No prompt file found for {}", app.as_str()),
                        Err(e) => log::warn!("✗ failed to import prompt for {}: {e}", app.as_str()),
                    }
                }
            }

            if let Err(e) = app_store::migrate_app_config_dir_from_settings(app.handle()) {
                log::warn!("failed to migrate app_config_dir: {e}");
            }


            log::info!("=== Registering deep-link URL handler ===");

            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                #[cfg(target_os = "linux")]
                {
                    // Use Tauri's path API to get correct path (includes app identifier)
                    // tauri-plugin-deep-link writes to: ~/.local/share/com.agent-switchboard.desktop/applications/agent-switchboard-handler.desktop
                    // Only register if .desktop file doesn't exist to avoid overwriting user customizations
                    let should_register = app
                        .path()
                        .data_dir()
                        .map(|d| !d.join("applications/agent-switchboard-handler.desktop").exists())
                        .unwrap_or(true);

                    if should_register {
                        if let Err(e) = app.deep_link().register_all() {
                            log::error!("✗ failed to register deep link schemes: {}", e);
                        } else {
                            log::info!("✓ Deep link schemes registered (Linux)");
                        }
                    } else {
                        log::info!("⊘ Deep link handler already exists, skipping registration");
                    }
                }

                #[cfg(all(debug_assertions, windows))]
                {
                    if let Err(e) = app.deep_link().register_all() {
                        log::error!("✗ failed to register deep link schemes: {}", e);
                    } else {
                        log::info!("✓ Deep link schemes registered (Windows debug)");
                    }
                }
            }

            app.deep_link().on_open_url({
                let app_handle = app.handle().clone();
                move |event| {
                    log::info!("=== Deep Link Event Received (on_open_url) ===");
                    let urls = event.urls();
                    log::info!("Received {} URL(s)", urls.len());

                    if crate::lightweight::is_lightweight_mode() {
                        if let Err(e) = crate::lightweight::exit_lightweight_mode(&app_handle) {
                            log::error!("failed to exit lightweight mode and rebuild window: {e}");
                        }
                    }

                    for (i, url) in urls.iter().enumerate() {
                        let url_str = url.as_str();
                        log::debug!("  URL[{i}]: {}", redact_url_for_log(url_str));

                        if handle_deeplink_url(&app_handle, url_str, true, "on_open_url") {
                            break; // Process only first agent-switchboard:// URL
                        }
                    }
                }
            });
            log::info!("✓ Deep-link URL handler registered");

            let menu = tray::create_tray_menu(app.handle(), &app_state)?;

            let mut tray_builder = TrayIconBuilder::with_id(tray::TRAY_ID)
                .tooltip("Agent Switchboard")
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Enter { .. } | TrayIconEvent::Click { .. } => {
                        let app = tray.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            crate::tray::refresh_all_usage_in_tray(&app).await;
                        });
                    }
                    _ => log::debug!("unhandled event {event:?}"),
                })
                .menu(&menu)
                .on_menu_event(|app, event| {
                    tray::handle_tray_menu_event(app, &event.id.0);
                })
                .show_menu_on_left_click(true);

            #[cfg(target_os = "macos")]
            {
                if let Some(icon) = macos_tray_icon() {
                    tray_builder = tray_builder.icon(icon).icon_as_template(true);
                } else if let Some(icon) = app.default_window_icon() {
                    log::warn!("Falling back to default window icon for tray");
                    tray_builder = tray_builder.icon(icon.clone());
                } else {
                    log::warn!("failed to load macOS tray icon for tray");
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                } else {
                    log::warn!("failed to get default window icon for tray");
                }
            }

            let _tray = tray_builder.build(app)?;
            crate::services::webdav_auto_sync::start_worker(
                app_state.db.clone(),
                app.handle().clone(),
            );
            crate::services::s3_auto_sync::start_worker(
                app_state.db.clone(),
                app.handle().clone(),
            );
            app.manage(app_state);

            {
                let db = &app.state::<AppState>().db;
                if let Ok(log_config) = db.get_log_config() {
                    log::set_max_level(log_config.to_level_filter());
                    log::info!(
                        "Configure: enabled={}, level={}",
                        log_config.enabled,
                        log_config.level
                    );
                }
            }

            let skill_service = SkillService::new();
            app.manage(commands::skill::SkillServiceState(Arc::new(skill_service)));

            {
                use crate::proxy::providers::copilot_auth::CopilotAuthManager;
                use commands::CopilotAuthState;
                use tokio::sync::RwLock;

                let app_config_dir = crate::config::get_app_config_dir();
                let copilot_auth_manager = CopilotAuthManager::new(app_config_dir);
                app.manage(CopilotAuthState(Arc::new(RwLock::new(copilot_auth_manager))));
                log::info!("✓ CopilotAuthManager initialized");
            }

            {
                use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
                use commands::CodexOAuthState;
                use tokio::sync::RwLock;

                let app_config_dir = crate::config::get_app_config_dir();
                let codex_oauth_manager = CodexOAuthManager::new(app_config_dir);
                app.manage(CodexOAuthState(Arc::new(RwLock::new(codex_oauth_manager))));
                log::info!("✓ CodexOAuthManager initialized");
            }

            {
                let db = &app.state::<AppState>().db;
                let proxy_url = db.get_global_proxy_url().ok().flatten();

                if let Err(e) = crate::proxy::http_client::init(proxy_url.as_deref()) {
                    log::error!(
                        "[GlobalProxy] [GP-005] failed to initialize with saved config: {e}"
                    );

                    if proxy_url.is_some() {
                        log::warn!(
                            "[GlobalProxy] [GP-006] Clearing invalid proxy config from database"
                        );
                        if let Err(clear_err) = db.set_global_proxy_url(None) {
                            log::error!(
                                "[GlobalProxy] [GP-007] failed to clear invalid config: {clear_err}"
                            );
                        }
                    }

                    if let Err(fallback_err) = crate::proxy::http_client::init(None) {
                        log::error!(
                            "[GlobalProxy] [GP-008] failed to initialize direct connection: {fallback_err}"
                        );
                    }
                }
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();

                let has_backups = match state.db.has_any_live_backup().await {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!(" Live failed: {e}");
                        false
                    }
                };
                let live_taken_over = state.proxy_service.detect_takeover_in_live_configs();

                if has_backups || live_taken_over {
                    log::warn!("Exit Live Configure...");
                    if let Err(e) = state.proxy_service.recover_from_crash().await {
                        log::error!(" Live Configurefailed: {e}");
                    } else {
                        log::info!("Live Configure");
                    }
                }

                initialize_common_config_snippets(&state);

                restore_proxy_state_on_startup(&state).await;

                // Periodic backup check (on startup)
                if let Err(e) = state.db.periodic_backup_if_needed() {
                    log::warn!("Periodic backup failed on startup: {e}");
                }

                // Periodic maintenance timer: run once per day while the app is running
                let db_for_timer = state.db.clone();
                tauri::async_runtime::spawn(async move {
                    const PERIODIC_MAINTENANCE_INTERVAL_SECS: u64 = 24 * 60 * 60;
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
                        PERIODIC_MAINTENANCE_INTERVAL_SECS,
                    ));
                    interval.tick().await; // skip immediate first tick (already checked above)
                    loop {
                        interval.tick().await;
                        if let Err(e) = db_for_timer.periodic_backup_if_needed() {
                            log::warn!("Periodic maintenance timer failed: {e}");
                        }
                    }
                });

                let db_for_session_sync = state.db.clone();
                tauri::async_runtime::spawn(async move {
                    const SESSION_SYNC_INTERVAL_SECS: u64 = 60;

                    fn run_step<T>(name: &str, result: Result<T, crate::error::AppError>) {
                        if let Err(e) = result {
                            log::warn!("{name} failed: {e}");
                        }
                    }

                    let db = &db_for_session_sync;

                    run_step(
                        "Usage cost startup backfill",
                        db.backfill_missing_usage_costs(),
                    );
                    run_step(
                        "Session usage initial sync",
                        crate::services::session_usage::sync_claude_session_logs(db),
                    );
                    run_step(
                        "Codex usage initial sync",
                        crate::services::session_usage_codex::sync_codex_usage(db),
                    );
                    run_step(
                        "Gemini usage initial sync",
                        crate::services::session_usage_gemini::sync_gemini_usage(db),
                    );
                    run_step(
                        "OpenCode usage initial sync",
                        crate::services::session_usage_opencode::sync_opencode_usage(db),
                    );

                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
                        SESSION_SYNC_INTERVAL_SECS,
                    ));
                    interval.tick().await; // skip immediate first tick
                    loop {
                        interval.tick().await;
                        run_step(
                            "Session usage periodic sync",
                            crate::services::session_usage::sync_claude_session_logs(db),
                        );
                        run_step(
                            "Codex usage periodic sync",
                            crate::services::session_usage_codex::sync_codex_usage(db),
                        );
                        run_step(
                            "Gemini usage periodic sync",
                            crate::services::session_usage_gemini::sync_gemini_usage(db),
                        );
                        run_step(
                            "OpenCode usage periodic sync",
                            crate::services::session_usage_opencode::sync_opencode_usage(db),
                        );
                    }
                });
            });

            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::{WebViewExt, SettingsExt, HardwareAccelerationPolicy};
                        let wk_webview = webview.inner();
                        if let Some(settings) = WebViewExt::settings(&wk_webview) {
                            SettingsExt::set_hardware_acceleration_policy(&settings, HardwareAccelerationPolicy::Never);
                            log::info!(" WebKitGTK ");
                        }
                    });
                }
            }

            let settings = crate::settings::get_settings();
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "linux")]
                let _ = window.set_decorations(!settings.use_app_window_controls);
                if settings.silent_startup {
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    let _ = window.set_skip_taskbar(true);
                    #[cfg(target_os = "macos")]
                    tray::apply_tray_policy(app.handle(), false);
                    log::info!("Silent startup mode: main window is hidden");
                } else {
                    let _ = window.show();
                    log::info!("Normal: ");

                    #[cfg(target_os = "linux")]
                    {
                        linux_fix::nudge_main_window(window.clone());
                    }
                }
            }


            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_providers,
            commands::get_current_provider,
            commands::add_provider,
            commands::update_provider,
            commands::delete_provider,
            commands::remove_provider_from_live_config,
            commands::switch_provider,
            commands::import_default_config,
            commands::get_claude_desktop_status,
            commands::get_claude_desktop_default_routes,
            commands::import_claude_desktop_providers_from_claude,
            commands::ensure_claude_desktop_official_provider,
            commands::get_claude_config_status,
            commands::get_config_status,
            commands::get_claude_code_config_path,
            commands::get_config_dir,
            commands::open_config_folder,
            commands::pick_directory,
            commands::open_external,
            commands::get_init_error,
            commands::get_migration_result,
            commands::get_skills_migration_result,
            commands::get_app_config_path,
            commands::open_app_config_folder,
            commands::get_claude_common_config_snippet,
            commands::set_claude_common_config_snippet,
            commands::get_common_config_snippet,
            commands::set_common_config_snippet,
            commands::extract_common_config_snippet,
            commands::read_live_provider_settings,
            commands::get_settings,
            commands::save_settings,
            commands::has_codex_unify_history_backup,
            commands::restore_codex_unified_history,
            commands::get_rectifier_config,
            commands::set_rectifier_config,
            commands::get_optimizer_config,
            commands::set_optimizer_config,
            commands::get_copilot_optimizer_config,
            commands::set_copilot_optimizer_config,
            commands::get_log_config,
            commands::set_log_config,
            commands::restart_app,
            commands::install_update_and_restart,
            commands::check_app_update_available,
            commands::check_for_updates,
            commands::is_portable_mode,
            commands::copy_text_to_clipboard,
            commands::get_claude_plugin_status,
            commands::read_claude_plugin_config,
            commands::apply_claude_plugin_config,
            commands::is_claude_plugin_applied,
            commands::apply_claude_onboarding_skip,
            commands::clear_claude_onboarding_skip,
            // Claude MCP management
            commands::get_claude_mcp_status,
            commands::read_claude_mcp_config,
            commands::upsert_claude_mcp_server,
            commands::delete_claude_mcp_server,
            commands::validate_mcp_command,
            // usage query
            commands::queryProviderUsage,
            commands::testUsageScript,
            // subscription quota
            commands::get_subscription_quota,
            commands::get_codex_oauth_quota,
            commands::get_codex_oauth_models,
            commands::get_coding_plan_quota,
            commands::get_balance,
            // New MCP via config.json (SSOT)
            commands::get_mcp_config,
            commands::upsert_mcp_server_in_config,
            commands::delete_mcp_server_in_config,
            commands::set_mcp_enabled,
            // Unified MCP management
            commands::get_mcp_servers,
            commands::upsert_mcp_server,
            commands::delete_mcp_server,
            commands::toggle_mcp_app,
            commands::import_mcp_from_apps,
            // Prompt management
            commands::get_prompts,
            commands::upsert_prompt,
            commands::delete_prompt,
            commands::enable_prompt,
            commands::import_prompt_from_file,
            commands::get_current_prompt_file_content,
            // model list fetch (OpenAI-compatible /v1/models)
            commands::fetch_models_for_config,
            // ours: endpoint speed test + custom endpoint management
            commands::test_api_endpoints,
            commands::get_custom_endpoints,
            commands::add_custom_endpoint,
            commands::remove_custom_endpoint,
            commands::update_endpoint_last_used,
            // app_config_dir override via Store
            commands::get_app_config_dir_override,
            commands::set_app_config_dir_override,
            // provider sort order management
            commands::update_providers_sort_order,
            // theirs: config import/export and dialogs
            commands::export_config_to_file,
            commands::import_config_from_file,
            commands::webdav_test_connection,
            commands::webdav_sync_upload,
            commands::webdav_sync_download,
            commands::webdav_sync_save_settings,
            commands::webdav_sync_fetch_remote_info,
            commands::s3_test_connection,
            commands::s3_sync_upload,
            commands::s3_sync_download,
            commands::s3_sync_save_settings,
            commands::s3_sync_fetch_remote_info,
            commands::save_file_dialog,
            commands::open_file_dialog,
            commands::open_zip_file_dialog,
            commands::create_db_backup,
            commands::list_db_backups,
            commands::restore_db_backup,
            commands::rename_db_backup,
            commands::delete_db_backup,
            commands::sync_current_providers_live,
            // Deep link import
            commands::parse_deeplink,
            commands::merge_deeplink_config,
            commands::import_from_deeplink,
            commands::import_from_deeplink_unified,
            update_tray_menu,
            // Environment variable management
            commands::check_env_conflicts,
            commands::delete_env_vars,
            commands::restore_env_backup,
            // Skill management (v3.10.0+ unified)
            commands::get_installed_skills,
            commands::get_skill_backups,
            commands::delete_skill_backup,
            commands::install_skill_unified,
            commands::uninstall_skill_unified,
            commands::restore_skill_backup,
            commands::toggle_skill_app,
            commands::scan_unmanaged_skills,
            commands::import_skills_from_apps,
            commands::discover_available_skills,
            commands::check_skill_updates,
            commands::update_skill,
            commands::migrate_skill_storage,
            commands::search_skills_sh,
            // Skill management (legacy API compatibility)
            commands::get_skills,
            commands::get_skills_for_app,
            commands::install_skill,
            commands::install_skill_for_app,
            commands::uninstall_skill,
            commands::uninstall_skill_for_app,
            commands::get_skill_repos,
            commands::add_skill_repo,
            commands::remove_skill_repo,
            commands::install_skills_from_zip,
            // Auto launch
            commands::set_auto_launch,
            commands::get_auto_launch_status,
            // Proxy server management
            commands::start_proxy_server,
            commands::stop_proxy_server,
            commands::stop_proxy_with_restore,
            commands::get_proxy_takeover_status,
            commands::set_proxy_takeover_for_app,
            commands::get_proxy_status,
            commands::get_proxy_config,
            commands::update_proxy_config,
            // Global & Per-App Config
            commands::get_global_proxy_config,
            commands::update_global_proxy_config,
            commands::get_proxy_config_for_app,
            commands::update_proxy_config_for_app,
            commands::get_default_cost_multiplier,
            commands::set_default_cost_multiplier,
            commands::get_pricing_model_source,
            commands::set_pricing_model_source,
            commands::is_proxy_running,
            commands::is_live_takeover_active,
            commands::switch_proxy_provider,
            // Proxy failover commands
            commands::get_provider_health,
            commands::reset_circuit_breaker,
            commands::get_circuit_breaker_config,
            commands::update_circuit_breaker_config,
            commands::get_circuit_breaker_stats,
            // Failover queue management
            commands::get_failover_queue,
            commands::get_available_providers_for_failover,
            commands::add_to_failover_queue,
            commands::remove_from_failover_queue,
            commands::get_auto_failover_enabled,
            commands::set_auto_failover_enabled,
            // Usage statistics
            commands::get_usage_summary,
            commands::get_usage_summary_by_app,
            commands::get_usage_trends,
            commands::get_provider_stats,
            commands::get_model_stats,
            commands::get_request_logs,
            commands::get_request_detail,
            commands::get_model_pricing,
            commands::update_model_pricing,
            commands::delete_model_pricing,
            commands::check_provider_limits,
            // Session usage sync
            commands::sync_session_usage,
            commands::get_usage_data_sources,
            // Stream health check
            commands::stream_check_provider,
            commands::stream_check_all_providers,
            commands::get_stream_check_config,
            commands::save_stream_check_config,
            // Session manager
            commands::list_sessions,
            commands::get_session_messages,
            commands::delete_session,
            commands::delete_sessions,
            commands::launch_session_terminal,
            commands::get_tool_versions,
            commands::run_tool_lifecycle_action,
            commands::probe_tool_installations,
            // Provider terminal
            commands::open_provider_terminal,
            // Universal Provider management
            commands::get_universal_providers,
            commands::get_universal_provider,
            commands::upsert_universal_provider,
            commands::delete_universal_provider,
            commands::sync_universal_provider,
            // OpenCode specific
            commands::import_opencode_providers_from_live,
            commands::get_opencode_live_provider_ids,
            // OpenClaw specific
            commands::import_openclaw_providers_from_live,
            commands::get_openclaw_live_provider_ids,
            commands::get_openclaw_live_provider,
            commands::scan_openclaw_config_health,
            commands::get_openclaw_default_model,
            commands::set_openclaw_default_model,
            commands::get_openclaw_model_catalog,
            commands::set_openclaw_model_catalog,
            commands::get_openclaw_agents_defaults,
            commands::set_openclaw_agents_defaults,
            commands::get_openclaw_env,
            commands::set_openclaw_env,
            commands::get_openclaw_tools,
            commands::set_openclaw_tools,
            // Hermes specific
            commands::import_hermes_providers_from_live,
            commands::get_hermes_live_provider_ids,
            commands::get_hermes_live_provider,
            commands::get_hermes_model_config,
            commands::open_hermes_web_ui,
            commands::launch_hermes_dashboard,
            commands::get_hermes_memory,
            commands::set_hermes_memory,
            commands::get_hermes_memory_limits,
            commands::set_hermes_memory_enabled,
            // Global upstream proxy
            commands::get_global_proxy_url,
            commands::set_global_proxy_url,
            commands::test_proxy_url,
            commands::get_upstream_proxy_status,
            commands::scan_local_proxies,
            // Window theme control
            commands::set_window_theme,
            // Generic managed auth commands
            commands::auth_start_login,
            commands::auth_poll_for_account,
            commands::auth_list_accounts,
            commands::auth_get_status,
            commands::auth_remove_account,
            commands::auth_set_default_account,
            commands::auth_logout,
            // Copilot OAuth commands (multi-account support)
            commands::copilot_start_device_flow,
            commands::copilot_poll_for_auth,
            commands::copilot_poll_for_account,
            commands::copilot_list_accounts,
            commands::copilot_remove_account,
            commands::copilot_set_default_account,
            commands::copilot_get_auth_status,
            commands::copilot_logout,
            commands::copilot_is_authenticated,
            commands::copilot_get_token,
            commands::copilot_get_token_for_account,
            commands::copilot_get_models,
            commands::copilot_get_models_for_account,
            commands::copilot_get_usage,
            commands::copilot_get_usage_for_account,
            // OMO commands
            commands::read_omo_local_file,
            commands::get_current_omo_provider_id,
            commands::disable_current_omo,
            commands::read_omo_slim_local_file,
            commands::get_current_omo_slim_provider_id,
            commands::disable_current_omo_slim,
            // Workspace files (OpenClaw)
            commands::read_workspace_file,
            commands::write_workspace_file,
            // Daily memory files (OpenClaw workspace)
            commands::list_daily_memory_files,
            commands::read_daily_memory_file,
            commands::write_daily_memory_file,
            commands::delete_daily_memory_file,
            commands::search_daily_memory_files,
            commands::open_workspace_directory,
            // lightweight mode (for testing or low-resource environments)
            commands::enter_lightweight_mode,
            commands::exit_lightweight_mode,
            commands::is_lightweight_mode,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, code, .. } = &event {
            match classify_exit_request(*code) {
                ExitRequestAction::StayInTray => {
                    log::info!("Runtime triggered exit request (no live windows), blocking exit to keep tray running in background");
                    api.prevent_exit();
                    return;
                }
                //
                //
                ExitRequestAction::DeferToTauriRestart => {
                    log::info!(" (code={code:?}) Tauri  re-exec");
                    return;
                }
                ExitRequestAction::CleanupAndExit => {}
            }

            log::info!("Exit (code={code:?})...");
            api.prevent_exit();

            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                save_window_state_before_exit(&app_handle);
                cleanup_before_exit(&app_handle).await;
                remove_tray_icon_before_exit(&app_handle);
                log::info!("Exit");

                tokio::time::sleep(std::time::Duration::from_millis(100)).await;

                std::process::exit(0);
            });
            return;
        }

        #[cfg(target_os = "macos")]
        {
            match event {
                RunEvent::Reopen { .. } => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        #[cfg(target_os = "windows")]
                        {
                            let _ = window.set_skip_taskbar(false);
                        }
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        tray::apply_tray_policy(app_handle, true);
                    } else if crate::lightweight::is_lightweight_mode() {
                        if let Err(e) = crate::lightweight::exit_lightweight_mode(app_handle) {
                            log::error!("failed to exit lightweight mode and rebuild window: {e}");
                        }
                    }
                }
                RunEvent::Opened { urls } => {
                    if let Some(url) = urls.first() {
                        let url_str = url.to_string();
                        log::info!("RunEvent::Opened with URL: {url_str}");

                        if url_str.starts_with("agent-switchboard://") {
                            if crate::lightweight::is_lightweight_mode() {
                                if let Err(e) = crate::lightweight::exit_lightweight_mode(app_handle)
                                {
                                    log::error!("failed to exit lightweight mode and rebuild window: {e}");
                                }
                            }

                            match crate::deeplink::parse_deeplink_url(&url_str) {
                                Ok(request) => {
                                    log::info!(
                                        "Successfully parsed deep link from RunEvent::Opened: resource={}, app={:?}",
                                        request.resource,
                                        request.app
                                    );

                                    if let Err(e) =
                                        app_handle.emit("deeplink-import", &request)
                                    {
                                        log::error!(
                                            "failed to emit deep link event from RunEvent::Opened: {e}"
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "failed to parse deep link URL from RunEvent::Opened: {e}"
                                    );

                                    if let Err(emit_err) = app_handle.emit(
                                        "deeplink-error",
                                        serde_json::json!({
                                            "url": url_str,
                                            "error": e.to_string()
                                        }),
                                    ) {
                                        log::error!(
                                            "failed to emit deep link error event from RunEvent::Opened: {emit_err}"
                                        );
                                    }
                                }
                            }

                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}

// ============================================================
// ============================================================

///
pub async fn cleanup_before_exit(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<store::AppState>() {
        let proxy_service = &state.proxy_service;

        let has_backups = match state.db.has_any_live_backup().await {
            Ok(v) => v,
            Err(e) => {
                log::error!("Exit Live failed: {e}");
                false
            }
        };
        let live_taken_over = proxy_service.detect_takeover_in_live_configs();
        let needs_restore = has_backups || live_taken_over;

        if needs_restore {
            log::info!(" Live Configure...");
            if let Err(e) = proxy_service.stop_with_restore_keep_state().await {
                log::error!("Exit Live Configurefailed: {e}");
            } else {
                log::info!(" Live Configure");
            }
            return;
        }

        if proxy_service.is_running().await {
            log::info!("...");
            if let Err(e) = proxy_service.stop().await {
                log::error!("Exitfailed: {e}");
            }
            log::info!("");
        }
    }
}

///
///
pub(crate) fn remove_tray_icon_before_exit(app_handle: &tauri::AppHandle) {
    if let Some(tray) = app_handle.tray_by_id(tray::TRAY_ID) {
        if let Err(e) = tray.set_visible(false) {
            log::warn!("Exitfailed: {e}");
        } else {
            log::info!("");
        }
    }
}

// ============================================================
// ============================================================

///
async fn restore_proxy_state_on_startup(state: &store::AppState) {
    let mut apps_to_restore = Vec::new();
    for app_type in ["claude", "codex", "gemini"] {
        if let Ok(config) = state.db.get_proxy_config_for_app(app_type).await {
            if config.enabled {
                apps_to_restore.push(app_type);
            }
        }
    }

    if apps_to_restore.is_empty() {
        log::debug!("");
        return;
    }

    log::info!(": {apps_to_restore:?}");

    for app_type in apps_to_restore {
        match state
            .proxy_service
            .set_takeover_for_app(app_type, true)
            .await
        {
            Ok(()) => {
                log::info!("✓  {app_type} ");
            }
            Err(e) => {
                log::error!("✗  {app_type} failed: {e}");
                if let Err(clear_err) = state
                    .proxy_service
                    .set_takeover_for_app(app_type, false)
                    .await
                {
                    log::error!(" {app_type} failed: {clear_err}");
                }
            }
        }
    }
}

fn initialize_common_config_snippets(state: &store::AppState) {
    // Auto-extract common config snippets from clean live files when snippet is missing.
    // This must run before proxy takeover is restored on startup, otherwise we'd read
    // proxy-placeholder configs instead of the user's actual live settings.
    for app_type in crate::app_config::AppType::all() {
        if !state
            .db
            .should_auto_extract_config_snippet(app_type.as_str())
            .unwrap_or(false)
        {
            continue;
        }

        let settings = match crate::services::provider::ProviderService::read_live_settings(
            app_type.clone(),
        ) {
            Ok(s) => s,
            Err(_) => continue,
        };

        match crate::services::provider::ProviderService::extract_common_config_snippet_from_settings(
            app_type.clone(),
            &settings,
        ) {
            Ok(snippet) if !snippet.is_empty() && snippet != "{}" => {
                match state.db.set_config_snippet(app_type.as_str(), Some(snippet)) {
                    Ok(()) => {
                        let _ = state.db.set_config_snippet_cleared(app_type.as_str(), false);
                        log::info!(
                            "✓ Auto-extracted common config snippet for {}",
                            app_type.as_str()
                        );
                    }
                    Err(e) => log::warn!(
                        "✗ failed to save config snippet for {}: {e}",
                        app_type.as_str()
                    ),
                }
            }
            Ok(_) => log::debug!(
                "○ Live config for {} has no extractable common fields",
                app_type.as_str()
            ),
            Err(e) => log::warn!(
                "✗ failed to extract config snippet for {}: {e}",
                app_type.as_str()
            ),
        }
    }

    let should_run_legacy_migration = state
        .db
        .is_legacy_common_config_migrated()
        .map(|done| !done)
        .unwrap_or(true);

    if should_run_legacy_migration {
        for app_type in [
            crate::app_config::AppType::Claude,
            crate::app_config::AppType::Codex,
            crate::app_config::AppType::Gemini,
        ] {
            if let Err(e) = crate::services::provider::ProviderService::migrate_legacy_common_config_usage_if_needed(
                state,
                app_type.clone(),
            ) {
                log::warn!(
                    "✗ failed to migrate legacy common-config usage for {}: {e}",
                    app_type.as_str()
                );
            }
        }

        if let Err(e) = state.db.set_legacy_common_config_migrated(true) {
            log::warn!("✗ failed to persist legacy common-config migration flag: {e}");
        }
    }
}

// ============================================================
// ============================================================

fn show_migration_error_dialog(app: &tauri::AppHandle, error: &str) -> bool {
    let title = "Migration failed";

    let message = format!(
        "An error occurred while migrating configuration:\n\n{error}\n\n\
        Your data is NOT lost - the old config file is still preserved.\n\
        Consider rolling back to an older Agent Switchboard version.\n\n\
        Click 'Retry' to attempt migration again\n\
        Click 'Exit' to close the program"
    );

    let retry_text = "Retry";
    let exit_text = "Exit";

    app.dialog()
        .message(&message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            retry_text.to_string(),
            exit_text.to_string(),
        ))
        .blocking_show()
}

fn show_database_init_error_dialog(
    app: &tauri::AppHandle,
    db_path: &std::path::Path,
    error: &str,
) -> bool {
    let title = "Database Initialization failed";

    let message = format!(
        "An error occurred while initializing or migrating the database:\n\n{error}\n\n\
        Database file path:\n{db}\n\n\
        Your data is NOT lost - the app will not delete the database automatically.\n\
        Common causes include: newer database version, corrupted file, permission issues, or low disk space.\n\n\
        Suggestions:\n\
        1) Back up the entire config directory (including agent-switchboard.db)\n\
        2) If you see “database version is newer”, please upgrade Agent Switchboard\n\
        3) If this happened right after upgrading, consider rolling back to export/backup then upgrade again\n\n\
        Click 'Retry' to attempt initialization again\n\
        Click 'Exit' to close the program",
        db = db_path.display()
    );

    let retry_text = "Retry";
    let exit_text = "Exit";

    app.dialog()
        .message(&message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(
            retry_text.to_string(),
            exit_text.to_string(),
        ))
        .blocking_show()
}

// ============================================================
// ============================================================

///
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExitRequestAction {
    StayInTray,
    DeferToTauriRestart,
    CleanupAndExit,
}

fn classify_exit_request(code: Option<i32>) -> ExitRequestAction {
    match code {
        None => ExitRequestAction::StayInTray,
        Some(tauri::RESTART_EXIT_CODE) => ExitRequestAction::DeferToTauriRestart,
        Some(_) => ExitRequestAction::CleanupAndExit,
    }
}

// ============================================================
// ============================================================

fn window_state_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED
}

pub fn save_window_state_before_exit(app_handle: &tauri::AppHandle) {
    if let Err(err) = app_handle.save_window_state(window_state_flags()) {
        log::error!("Exitfailed: {err}");
    } else {
        log::info!("Exit");
    }
}

///
pub fn destroy_single_instance_lock(app_handle: &tauri::AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    tauri_plugin_single_instance::destroy(app_handle);
}

///
///
pub fn restart_process(app_handle: &tauri::AppHandle) -> ! {
    remove_tray_icon_before_exit(app_handle);
    destroy_single_instance_lock(app_handle);
    tauri::process::restart(&app_handle.env());
}

#[cfg(test)]
mod tests {
    use super::{classify_exit_request, ExitRequestAction};

    #[test]
    fn no_code_keeps_app_alive_in_tray() {
        assert_eq!(classify_exit_request(None), ExitRequestAction::StayInTray);
    }

    #[test]
    fn restart_exit_code_defers_to_tauri_default_restart() {
        assert_eq!(
            classify_exit_request(Some(tauri::RESTART_EXIT_CODE)),
            ExitRequestAction::DeferToTauriRestart
        );
    }

    #[test]
    fn user_exit_codes_run_cleanup_then_exit() {
        assert_eq!(
            classify_exit_request(Some(0)),
            ExitRequestAction::CleanupAndExit
        );
        assert_eq!(
            classify_exit_request(Some(1)),
            ExitRequestAction::CleanupAndExit
        );
    }
}
