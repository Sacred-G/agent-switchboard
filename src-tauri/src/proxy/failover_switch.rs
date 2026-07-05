//!

use crate::database::Database;
use crate::error::AppError;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::RwLock;

///
#[derive(Clone)]
pub struct FailoverSwitchManager {
    pending_switches: Arc<RwLock<HashSet<String>>>,
    db: Arc<Database>,
}

impl FailoverSwitchManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            pending_switches: Arc::new(RwLock::new(HashSet::new())),
            db,
        }
    }

    ///
    ///
    /// # Returns
    pub async fn try_switch(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let switch_key = format!("{app_type}:{provider_id}");

        {
            let mut pending = self.pending_switches.write().await;
            if pending.contains(&switch_key) {
                log::debug!("[Failover] : {app_type} -> {provider_id}");
                return Ok(false);
            }
            pending.insert(switch_key.clone());
        }

        let result = self
            .do_switch(app_handle, app_type, provider_id, provider_name)
            .await;

        {
            let mut pending = self.pending_switches.write().await;
            pending.remove(&switch_key);
        }

        result
    }

    async fn do_switch(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let app_enabled = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(config) => config.enabled,
            Err(e) => {
                log::warn!("[FO-002] Read {app_type} Configure: {e}");
                return Ok(false);
            }
        };

        if !app_enabled {
            log::debug!("[Failover] {app_type} ");
            return Ok(false);
        }

        log::info!("[FO-001] : {app_type} → {provider_name}");

        let mut switched = false;

        if let Some(app) = app_handle {
            if let Some(app_state) = app.try_state::<crate::store::AppState>() {
                switched = app_state
                    .proxy_service
                    .hot_switch_provider(app_type, provider_id)
                    .await
                    .map_err(AppError::Message)?
                    .logical_target_changed;

                if !switched {
                    return Ok(false);
                }

                if let Ok(new_menu) = crate::tray::create_tray_menu(app, app_state.inner()) {
                    if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
                        if let Err(e) = tray.set_menu(Some(new_menu)) {
                            log::error!("[Failover] failed: {e}");
                        }
                    }
                }
            }

            let event_data = serde_json::json!({
                "appType": app_type,
                "providerId": provider_id,
                "source": "failover"
            });
            if let Err(e) = app.emit("provider-switched", event_data) {
                log::error!("[Failover] failed: {e}");
            }
        }

        Ok(switched)
    }
}
