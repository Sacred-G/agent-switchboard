use serde_json::Value;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";

static APP_CONFIG_DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn override_cache() -> &'static RwLock<Option<PathBuf>> {
    APP_CONFIG_DIR_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn update_cached_override(value: Option<PathBuf>) {
    if let Ok(mut guard) = override_cache().write() {
        *guard = value;
    }
}

pub fn get_app_config_dir_override() -> Option<PathBuf> {
    override_cache().read().ok()?.clone()
}

fn read_override_from_store(app: &tauri::AppHandle) -> Option<PathBuf> {
    let store = match app.store_builder("app_paths.json").build() {
        Ok(store) => store,
        Err(e) => {
            log::warn!(" Store: {e}");
            return None;
        }
    };

    match store.get(STORE_KEY_APP_CONFIG_DIR) {
        Some(Value::String(path_str)) => {
            let path_str = path_str.trim();
            if path_str.is_empty() {
                return None;
            }

            let path = resolve_path(path_str);

            if !path.exists() {
                log::warn!(
                    "The app_config_dir configured in Store does not exist: {path:?}\n\
                     Using the default path instead."
                );
                return None;
            }

            log::info!(" Store  app_config_dir: {path:?}");
            Some(path)
        }
        Some(_) => {
            log::warn!("Store  {STORE_KEY_APP_CONFIG_DIR} ");
            None
        }
        None => None,
    }
}

pub fn refresh_app_config_dir_override(app: &tauri::AppHandle) -> Option<PathBuf> {
    let value = read_override_from_store(app);
    update_cached_override(value.clone());
    value
}

pub fn set_app_config_dir_to_store(
    app: &tauri::AppHandle,
    path: Option<&str>,
) -> Result<(), AppError> {
    let store = app
        .store_builder("app_paths.json")
        .build()
        .map_err(|e| AppError::Message(format!(" Store failed: {e}")))?;

    match path {
        Some(p) => {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                store.set(STORE_KEY_APP_CONFIG_DIR, Value::String(trimmed.to_string()));
                log::info!(" app_config_dir Write Store: {trimmed}");
            } else {
                store.delete(STORE_KEY_APP_CONFIG_DIR);
                log::info!(" Store  app_config_dir Configure");
            }
        }
        None => {
            store.delete(STORE_KEY_APP_CONFIG_DIR);
            log::info!(" Store  app_config_dir Configure");
        }
    }

    store
        .save()
        .map_err(|e| AppError::Message(format!(" Store failed: {e}")))?;

    refresh_app_config_dir_override(app);
    Ok(())
}

fn resolve_path(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    } else if let Some(stripped) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    } else if let Some(stripped) = raw.strip_prefix("~\\") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }

    PathBuf::from(raw)
}

pub fn migrate_app_config_dir_from_settings(app: &tauri::AppHandle) -> Result<(), AppError> {
    log::info!("app_config_dir Configure");

    let _ = refresh_app_config_dir_override(app);
    Ok(())
}
