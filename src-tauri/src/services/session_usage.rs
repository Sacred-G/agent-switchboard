//!
//!
//! ```text
//! ```

use crate::config::get_claude_config_dir;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::calculator::{CostCalculator, ModelPricing};
use crate::proxy::usage::parser::TokenUsage;
use crate::services::usage_stats::{
    effective_usage_log_filter, find_model_pricing, should_skip_session_insert, DedupKey,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSyncResult {
    pub imported: u32,
    pub skipped: u32,
    pub files_scanned: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceSummary {
    pub data_source: String,
    pub request_count: u32,
    pub total_cost_usd: String,
}

#[derive(Debug)]
struct ParsedAssistantUsage {
    message_id: String,
    model: String,
    input_tokens: u32,
    output_tokens: u32,
    cache_read_tokens: u32,
    cache_creation_tokens: u32,
    stop_reason: Option<String>,
    timestamp: Option<String>,
    session_id: Option<String>,
}

pub fn sync_claude_session_logs(db: &Database) -> Result<SessionSyncResult, AppError> {
    let projects_dir = get_claude_config_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(SessionSyncResult {
            imported: 0,
            skipped: 0,
            files_scanned: 0,
            errors: vec![],
        });
    }

    let mut result = SessionSyncResult {
        imported: 0,
        skipped: 0,
        files_scanned: 0,
        errors: vec![],
    };

    let jsonl_files = collect_jsonl_files(&projects_dir);

    for file_path in &jsonl_files {
        result.files_scanned += 1;

        match sync_single_file(db, file_path) {
            Ok((imported, skipped)) => {
                result.imported += imported;
                result.skipped += skipped;
            }
            Err(e) => {
                let msg = format!("{}: {e}", file_path.display());
                log::warn!("[SESSION-SYNC] Parsefailed: {msg}");
                result.errors.push(msg);
            }
        }
    }

    if result.imported > 0 {
        log::info!(
            "[SESSION-SYNC] Sync complete: imported {} items, skipped {} items, scanned {} files",
            result.imported,
            result.skipped,
            result.files_scanned
        );
    }

    Ok(result)
}

///
///
fn collect_jsonl_files(projects_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    let entries = match fs::read_dir(projects_dir) {
        Ok(e) => e,
        Err(_) => return files,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(sub_entries) = fs::read_dir(&path) {
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    files.push(sub_path);
                } else if sub_path.is_dir() {
                    let subagents_dir = sub_path.join("subagents");
                    if subagents_dir.is_dir() {
                        push_jsonl_children(&subagents_dir, &mut files);

                        let workflows_dir = subagents_dir.join("workflows");
                        if workflows_dir.is_dir() {
                            if let Ok(wf_entries) = fs::read_dir(&workflows_dir) {
                                for wf_entry in wf_entries.flatten() {
                                    let wf_path = wf_entry.path();
                                    if wf_path.is_dir() {
                                        push_jsonl_children(&wf_path, &mut files);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    files
}

fn push_jsonl_children(dir: &Path, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                files.push(path);
            }
        }
    }
}

fn sync_single_file(db: &Database, file_path: &Path) -> Result<(u32, u32), AppError> {
    let file_path_str = file_path.to_string_lossy().to_string();

    let metadata = fs::metadata(file_path)
        .map_err(|e| AppError::Config(format!("failed to read file metadata: {e}")))?;
    let file_modified = metadata_modified_nanos(&metadata);

    let (last_modified, last_offset) = get_sync_state(db, &file_path_str)?;

    if file_modified <= last_modified {
        return Ok((0, 0));
    }

    let file =
        fs::File::open(file_path).map_err(|e| AppError::Config(format!("failed to open file: {e}")))?;
    let reader = BufReader::new(file);

    let mut line_offset: i64 = 0;
    let mut messages: HashMap<String, ParsedAssistantUsage> = HashMap::new();
    let mut current_session_id: Option<String> = None;

    for line_result in reader.lines() {
        line_offset += 1;

        if line_offset <= last_offset {
            continue;
        }

        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if current_session_id.is_none() {
            if let Some(sid) = value.get("sessionId").and_then(|v| v.as_str()) {
                current_session_id = Some(sid.to_string());
            }
        }

        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }

        let message = match value.get("message") {
            Some(m) => m,
            None => continue,
        };

        let msg_id = match message.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        let usage = match message.get("usage") {
            Some(u) => u,
            None => continue,
        };

        let parsed = ParsedAssistantUsage {
            message_id: msg_id.clone(),
            model: message
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            input_tokens: usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            output_tokens: usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_read_tokens: usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            stop_reason: message
                .get("stop_reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            timestamp: value
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            session_id: current_session_id.clone(),
        };

        let should_replace = match messages.get(&msg_id) {
            None => true,
            Some(existing) => {
                if parsed.stop_reason.is_some() && existing.stop_reason.is_none() {
                    true
                }
                else if parsed.stop_reason.is_some() == existing.stop_reason.is_some() {
                    parsed.output_tokens > existing.output_tokens
                } else {
                    false
                }
            }
        };

        if should_replace {
            messages.insert(msg_id, parsed);
        }
    }

    let mut imported: u32 = 0;
    let mut skipped: u32 = 0;

    for msg in messages.values() {
        //
        //
        let has_billable_tokens = msg.input_tokens > 0
            || msg.output_tokens > 0
            || msg.cache_read_tokens > 0
            || msg.cache_creation_tokens > 0;
        if !has_billable_tokens {
            continue;
        }

        let request_id = format!(
            "{}{}",
            crate::proxy::usage::parser::SESSION_REQUEST_ID_PREFIX,
            msg.message_id
        );

        match insert_session_log_entry(db, &request_id, msg) {
            Ok(true) => imported += 1,
            Ok(false) => skipped += 1,
            Err(e) => {
                log::warn!("[SESSION-SYNC] Insert failed ({}): {e}", msg.message_id);
                skipped += 1;
            }
        }
    }

    update_sync_state(db, &file_path_str, file_modified, line_offset)?;

    Ok((imported, skipped))
}

///
/// Shared by all session_usage_* parsers.
pub(crate) fn get_sync_state(db: &Database, file_path: &str) -> Result<(i64, i64), AppError> {
    let conn = lock_conn!(db.conn);
    let result = conn.query_row(
        "SELECT last_modified, last_line_offset FROM session_log_sync WHERE file_path = ?1",
        rusqlite::params![file_path],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    );
    Ok(result.unwrap_or((0, 0)))
}

///
pub(crate) fn metadata_modified_nanos(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

///
/// Shared by all session_usage_* parsers.
pub(crate) fn update_sync_state(
    db: &Database,
    file_path: &str,
    last_modified: i64,
    last_offset: i64,
) -> Result<(), AppError> {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let conn = lock_conn!(db.conn);
    conn.execute(
        "INSERT OR REPLACE INTO session_log_sync (file_path, last_modified, last_line_offset, last_synced_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![file_path, last_modified, last_offset, now],
    )
    .map_err(|e| AppError::Database(format!("Syncfailed: {e}")))?;
    Ok(())
}

fn insert_session_log_entry(
    db: &Database,
    request_id: &str,
    msg: &ParsedAssistantUsage,
) -> Result<bool, AppError> {
    let conn = lock_conn!(db.conn);

    let created_at = msg
        .timestamp
        .as_ref()
        .and_then(|ts| {
            chrono::DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| dt.timestamp())
        })
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        });

    let dedup_key = DedupKey {
        app_type: "claude",
        model: &msg.model,
        input_tokens: msg.input_tokens,
        output_tokens: msg.output_tokens,
        cache_read_tokens: msg.cache_read_tokens,
        cache_creation_tokens: msg.cache_creation_tokens,
        created_at,
    };
    if should_skip_session_insert(&conn, request_id, &dedup_key)? {
        return Ok(false);
    }

    let usage = TokenUsage {
        input_tokens: msg.input_tokens,
        output_tokens: msg.output_tokens,
        cache_read_tokens: msg.cache_read_tokens,
        cache_creation_tokens: msg.cache_creation_tokens,
        model: Some(msg.model.clone()),
        message_id: None,
    };

    let pricing = find_model_pricing_for_session(&conn, &msg.model);
    let multiplier = Decimal::from(1);
    let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) = match pricing
    {
        Some(p) => {
            let cost = CostCalculator::calculate(&usage, &p, multiplier);
            (
                cost.input_cost.to_string(),
                cost.output_cost.to_string(),
                cost.cache_read_cost.to_string(),
                cost.cache_creation_cost.to_string(),
                cost.total_cost.to_string(),
            )
        }
        None => (
            "0".to_string(),
            "0".to_string(),
            "0".to_string(),
            "0".to_string(),
            "0".to_string(),
        ),
    };

    let inserted_rows = conn
        .execute(
            "INSERT OR IGNORE INTO proxy_request_logs (
            request_id, provider_id, app_type, model, request_model,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd,
            latency_ms, first_token_ms, status_code, error_message, session_id,
            provider_type, is_streaming, cost_multiplier, created_at, data_source
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            rusqlite::params![
                request_id,
                "_session",
                "claude",           // app_type
                msg.model,
                msg.model,          // request_model = model
                msg.input_tokens,
                msg.output_tokens,
                msg.cache_read_tokens,
                msg.cache_creation_tokens,
                input_cost,
                output_cost,
                cache_read_cost,
                cache_creation_cost,
                total_cost,
                0i64,
                Option::<i64>::None, // first_token_ms
                200i64,
                Option::<String>::None, // error_message
                msg.session_id,
                Some("session_log"), // provider_type
                1i64,
                "1.0",              // cost_multiplier
                created_at,
                "session_log",      // data_source
            ],
        )
        .map_err(|e| AppError::Database(format!("failed: {e}")))?;

    if inserted_rows > 0 {
        crate::usage_events::notify_log_recorded();
    }

    Ok(true)
}

fn find_model_pricing_for_session(
    conn: &rusqlite::Connection,
    model_id: &str,
) -> Option<ModelPricing> {
    find_model_pricing(conn, model_id)
}

pub fn get_data_source_breakdown(db: &Database) -> Result<Vec<DataSourceSummary>, AppError> {
    let conn = lock_conn!(db.conn);

    let effective_filter = effective_usage_log_filter("l");
    let sql = format!(
        "SELECT COALESCE(l.data_source, 'proxy') as ds, COUNT(*) as cnt,
                COALESCE(SUM(CAST(l.total_cost_usd AS REAL)), 0) as cost
         FROM proxy_request_logs l
         WHERE {effective_filter}
         GROUP BY ds
         ORDER BY cnt DESC"
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows = stmt.query_map([], |row| {
        Ok(DataSourceSummary {
            data_source: row.get(0)?,
            request_count: row.get::<_, i64>(1)? as u32,
            total_cost_usd: format!("{:.6}", row.get::<_, f64>(2)?),
        })
    })?;

    let mut summaries = Vec::new();
    for row in rows {
        summaries.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }

    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_usage_from_jsonl_line() {
        let line = r#"{"type":"assistant","message":{"id":"msg_test123","model":"claude-opus-4-6","usage":{"input_tokens":3,"output_tokens":150,"cache_read_input_tokens":5000,"cache_creation_input_tokens":10000},"stop_reason":"end_turn"},"timestamp":"2026-04-05T12:00:00Z","sessionId":"session-abc"}"#;

        let value: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(
            value.get("type").and_then(|t| t.as_str()),
            Some("assistant")
        );

        let message = value.get("message").unwrap();
        let usage = message.get("usage").unwrap();

        assert_eq!(usage.get("input_tokens").unwrap().as_u64().unwrap(), 3);
        assert_eq!(usage.get("output_tokens").unwrap().as_u64().unwrap(), 150);
        assert_eq!(
            usage
                .get("cache_read_input_tokens")
                .unwrap()
                .as_u64()
                .unwrap(),
            5000
        );
        assert_eq!(
            usage
                .get("cache_creation_input_tokens")
                .unwrap()
                .as_u64()
                .unwrap(),
            10000
        );
        assert_eq!(
            message.get("stop_reason").unwrap().as_str().unwrap(),
            "end_turn"
        );
    }

    #[test]
    fn test_dedup_by_message_id() {
        let mut messages: HashMap<String, ParsedAssistantUsage> = HashMap::new();

        let intermediate = ParsedAssistantUsage {
            message_id: "msg_1".to_string(),
            model: "claude-opus-4-6".to_string(),
            input_tokens: 3,
            output_tokens: 26,
            cache_read_tokens: 5000,
            cache_creation_tokens: 10000,
            stop_reason: None,
            timestamp: Some("2026-04-05T12:00:00Z".to_string()),
            session_id: None,
        };
        messages.insert("msg_1".to_string(), intermediate);

        let final_entry = ParsedAssistantUsage {
            message_id: "msg_1".to_string(),
            model: "claude-opus-4-6".to_string(),
            input_tokens: 3,
            output_tokens: 1349,
            cache_read_tokens: 5000,
            cache_creation_tokens: 10000,
            stop_reason: Some("end_turn".to_string()),
            timestamp: Some("2026-04-05T12:00:00Z".to_string()),
            session_id: None,
        };

        let should_replace = final_entry.stop_reason.is_some()
            && messages.get("msg_1").unwrap().stop_reason.is_none();
        assert!(should_replace);

        messages.insert("msg_1".to_string(), final_entry);
        assert_eq!(messages.get("msg_1").unwrap().output_tokens, 1349);
    }

    #[test]
    fn test_insert_claude_session_skips_matching_proxy_log() -> Result<(), AppError> {
        let db = Database::memory()?;
        {
            let conn = lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model, request_model,
                    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                    total_cost_usd, latency_ms, status_code, created_at, data_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rusqlite::params![
                    "proxy-different-id",
                    "openai-compatible",
                    "claude",
                    "claude-sonnet-4-5",
                    "claude-sonnet-4-5",
                    100,
                    20,
                    10,
                    5,
                    "0.10",
                    100,
                    200,
                    1000,
                    "proxy"
                ],
            )?;
        }

        let msg = ParsedAssistantUsage {
            message_id: "msg_1".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 10,
            cache_creation_tokens: 5,
            stop_reason: Some("end_turn".to_string()),
            timestamp: Some("1970-01-01T00:16:45Z".to_string()),
            session_id: Some("session-1".to_string()),
        };

        let inserted = insert_session_log_entry(&db, "session:msg_1", &msg)?;
        assert!(!inserted);

        let conn = lock_conn!(db.conn);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM proxy_request_logs", [], |row| {
            row.get(0)
        })?;
        assert_eq!(count, 1);

        Ok(())
    }

    #[test]
    fn test_collect_jsonl_files_includes_subagents() {
        let tmp = std::env::temp_dir().join(format!("agent-switchboard-test-{}", uuid::Uuid::new_v4()));
        let project = tmp.join("project");
        let session_dir = project.join("test-session");
        let subagents_dir = session_dir.join("subagents");
        fs::create_dir_all(&subagents_dir).unwrap();

        fs::write(project.join("main.jsonl"), "{}").unwrap();
        fs::write(subagents_dir.join("agent-abc.jsonl"), "{}").unwrap();

        let files = collect_jsonl_files(&tmp);
        assert_eq!(files.len(), 2);
        let paths: Vec<String> = files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        assert!(paths.iter().any(|p| p.contains("main.jsonl")));
        assert!(paths.iter().any(|p| p.contains("agent-abc.jsonl")));

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_collect_jsonl_files_includes_workflow_subagents() {
        let tmp = std::env::temp_dir().join(format!("agent-switchboard-test-{}", uuid::Uuid::new_v4()));
        let project = tmp.join("project");
        let session_dir = project.join("test-session");
        let subagents_dir = session_dir.join("subagents");
        let wf_dir = subagents_dir.join("workflows").join("wf_test123");
        fs::create_dir_all(&wf_dir).unwrap();

        fs::write(project.join("main.jsonl"), "{}").unwrap();
        fs::write(subagents_dir.join("agent-plain.jsonl"), "{}").unwrap();
        fs::write(wf_dir.join("agent-wf.jsonl"), "{}").unwrap();
        fs::write(wf_dir.join("journal.jsonl"), "{}").unwrap();

        let files = collect_jsonl_files(&tmp);
        let paths: Vec<String> = files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();

        assert_eq!(files.len(), 4);
        assert!(paths.iter().any(|p| p.contains("main.jsonl")));
        assert!(paths.iter().any(|p| p.contains("agent-plain.jsonl")));
        assert!(
            paths.iter().any(|p| p.contains("agent-wf.jsonl")),
            "Workflow  agent transcript "
        );

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_sync_imports_billable_message_without_stop_reason() -> Result<(), AppError> {
        let db = Database::memory()?;
        let tmp = std::env::temp_dir().join(format!("agent-switchboard-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        let file = tmp.join("agent-wf.jsonl");

        let billable = r#"{"type":"assistant","message":{"id":"msg_nostop","model":"claude-opus-4-8","usage":{"input_tokens":2,"output_tokens":1,"cache_read_input_tokens":48719,"cache_creation_input_tokens":2061}},"timestamp":"2026-06-07T13:01:23Z","sessionId":"session-wf"}"#;
        let empty = r#"{"type":"assistant","message":{"id":"msg_empty","model":"claude-opus-4-8","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}},"timestamp":"2026-06-07T13:01:24Z","sessionId":"session-wf"}"#;
        fs::write(&file, format!("{billable}\n{empty}\n")).unwrap();

        let (imported, _skipped) = sync_single_file(&db, &file)?;
        assert_eq!(
            imported, 1,
            " cache  stop_reason  message "
        );

        let conn = lock_conn!(db.conn);
        let cache_read: i64 = conn.query_row(
            "SELECT cache_read_tokens FROM proxy_request_logs WHERE request_id = 'session:msg_nostop'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(cache_read, 48719, "cache_read ");
        let empty_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM proxy_request_logs WHERE request_id = 'session:msg_empty')",
            [],
            |row| row.get(0),
        )?;
        assert!(!empty_exists, " 0 token  message ");
        drop(conn);

        fs::remove_dir_all(&tmp).ok();
        Ok(())
    }
}
