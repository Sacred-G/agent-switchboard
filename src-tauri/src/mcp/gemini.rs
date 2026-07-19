use serde_json::Value;
use std::collections::HashMap;

use crate::app_config::{McpApps, McpConfig, McpServer, MultiAppConfig};
use crate::error::AppError;

use super::validation::{extract_server_spec, validate_server_spec};

fn should_sync_gemini_mcp() -> bool {
    crate::gemini_config::get_gemini_dir().exists()
}

fn collect_enabled_servers(cfg: &McpConfig) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for (id, entry) in cfg.servers.iter() {
        let enabled = entry
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !enabled {
            continue;
        }
        match extract_server_spec(entry) {
            Ok(spec) => {
                out.insert(id.clone(), spec);
            }
            Err(err) => {
                log::warn!("Skip invalid MCP entry '{id}': {err}");
            }
        }
    }
    out
}

pub fn sync_enabled_to_gemini(config: &MultiAppConfig) -> Result<(), AppError> {
    if !should_sync_gemini_mcp() {
        return Ok(());
    }
    let enabled = collect_enabled_servers(&config.mcp.gemini);
    crate::gemini_mcp::set_mcp_servers_map(&enabled)
}

pub fn import_from_gemini(config: &mut MultiAppConfig) -> Result<usize, AppError> {
    let map = crate::gemini_mcp::read_mcp_servers_map()?;
    if map.is_empty() {
        return Ok(0);
    }

    let servers = config.mcp.servers.get_or_insert_with(HashMap::new);

    let mut changed = 0;
    let mut errors = Vec::new();

    for (id, spec) in map.iter() {
        if let Err(e) = validate_server_spec(spec) {
            log::warn!("Skip invalid MCP server '{id}': {e}");
            errors.push(format!("{id}: {e}"));
            continue;
        }

        if let Some(existing) = servers.get_mut(id) {
            if !existing.apps.gemini {
                existing.apps.gemini = true;
                changed += 1;
                log::info!("MCP server '{id}'  Gemini ");
            }
        } else {
            servers.insert(
                id.clone(),
                McpServer {
                    id: id.clone(),
                    name: id.clone(),
                    server: spec.clone(),
                    apps: McpApps {
                        claude: false,
                        codex: false,
                        gemini: true,
                        opencode: false,
                        hermes: false,
                    },
                    description: None,
                    homepage: None,
                    docs: None,
                    tags: Vec::new(),
                },
            );
            changed += 1;
            log::info!(" MCP server '{id}'");
        }
    }

    if !errors.is_empty() {
        log::warn!(" {} failed: {:?}", errors.len(), errors);
    }

    Ok(changed)
}

pub fn sync_single_server_to_gemini(
    _config: &MultiAppConfig,
    id: &str,
    server_spec: &Value,
) -> Result<(), AppError> {
    if !should_sync_gemini_mcp() {
        return Ok(());
    }
    let mut current = crate::gemini_mcp::read_mcp_servers_map()?;

    current.insert(id.to_string(), server_spec.clone());

    crate::gemini_mcp::set_mcp_servers_map(&current)
}

pub fn remove_server_from_gemini(id: &str) -> Result<(), AppError> {
    if !should_sync_gemini_mcp() {
        return Ok(());
    }
    let mut current = crate::gemini_mcp::read_mcp_servers_map()?;

    current.remove(id);

    crate::gemini_mcp::set_mcp_servers_map(&current)
}
