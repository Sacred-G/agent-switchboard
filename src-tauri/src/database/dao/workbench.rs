use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_WORKSPACE_NAME_CHARS: usize = 120;
const MAX_DOCUMENT_BYTES: usize = 1_000_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchWorkspaceRecord {
    pub id: String,
    pub name: String,
    pub document: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: i64,
}

fn validate_id(id: &str) -> Result<&str, AppError> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppError::InvalidInput(
            "workspace id contains unsupported characters".to_string(),
        ));
    }
    Ok(id)
}

fn validate_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "workspace name cannot be empty".to_string(),
        ));
    }
    if name.chars().count() > MAX_WORKSPACE_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "workspace name is too long or contains control characters".to_string(),
        ));
    }
    Ok(name)
}

fn serialize_document(document: &serde_json::Value) -> Result<String, AppError> {
    if !document.is_object() {
        return Err(AppError::InvalidInput(
            "workspace document must be a JSON object".to_string(),
        ));
    }
    let json = serde_json::to_string(document)
        .map_err(|error| AppError::Config(format!("failed to serialize workspace: {error}")))?;
    if json.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::InvalidInput(
            "workspace document exceeds the 1 MB limit".to_string(),
        ));
    }
    Ok(json)
}

fn parse_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkbenchWorkspaceRecord> {
    let document: String = row.get(2)?;
    let document = serde_json::from_str(&document).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            document.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(WorkbenchWorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        document,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_opened_at: row.get(5)?,
    })
}

impl Database {
    pub fn list_workbench_workspaces(&self) -> Result<Vec<WorkbenchWorkspaceRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut statement = conn.prepare(
            "SELECT id, name, document, created_at, updated_at, last_opened_at
             FROM workbench_workspaces
             ORDER BY last_opened_at DESC, updated_at DESC",
        )?;
        let rows = statement.query_map([], parse_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn get_workbench_workspace(
        &self,
        id: &str,
    ) -> Result<Option<WorkbenchWorkspaceRecord>, AppError> {
        let id = validate_id(id)?;
        let conn = lock_conn!(self.conn);
        conn.query_row(
            "SELECT id, name, document, created_at, updated_at, last_opened_at
             FROM workbench_workspaces WHERE id = ?1",
            params![id],
            parse_row,
        )
        .optional()
        .map_err(AppError::from)
    }

    pub fn save_workbench_workspace(
        &self,
        id: &str,
        name: &str,
        document: &serde_json::Value,
        opened: bool,
    ) -> Result<WorkbenchWorkspaceRecord, AppError> {
        let id = validate_id(id)?;
        let name = validate_name(name)?;
        let document_json = serialize_document(document)?;
        let now = chrono::Utc::now().timestamp_millis();
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO workbench_workspaces
                (id, name, document, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                document = excluded.document,
                updated_at = excluded.updated_at,
                last_opened_at = CASE WHEN ?5 THEN excluded.last_opened_at
                                      ELSE workbench_workspaces.last_opened_at END",
            params![id, name, document_json, now, opened],
        )?;
        drop(conn);
        self.get_workbench_workspace(id)?.ok_or_else(|| {
            AppError::Database("workspace disappeared immediately after saving".to_string())
        })
    }

    pub fn touch_workbench_workspace(&self, id: &str) -> Result<(), AppError> {
        let id = validate_id(id)?;
        let conn = lock_conn!(self.conn);
        let changed = conn.execute(
            "UPDATE workbench_workspaces SET last_opened_at = ?2 WHERE id = ?1",
            params![id, chrono::Utc::now().timestamp_millis()],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput("workspace not found".to_string()));
        }
        Ok(())
    }

    pub fn delete_workbench_workspace(&self, id: &str) -> Result<(), AppError> {
        let id = validate_id(id)?;
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM workbench_workspaces WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }
}
