use std::str::FromStr;
use tauri::{Emitter, State};

use crate::app_config::AppType;
use crate::services::subscription::{CredentialStatus, SubscriptionQuota};
use crate::store::AppState;

///
#[tauri::command]
pub async fn get_subscription_quota(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tool: String,
) -> Result<SubscriptionQuota, String> {
    let inner = crate::services::subscription::get_subscription_quota(&tool).await;
    let snapshot = match &inner {
        Ok(q) => q.clone(),
        Err(err_msg) => SubscriptionQuota::error(&tool, CredentialStatus::Valid, err_msg.clone()),
    };
    if let Ok(app_type) = AppType::from_str(&tool) {
        let payload = serde_json::json!({
            "kind": "subscription",
            "appType": app_type.as_str(),
            "data": &snapshot,
        });
        if let Err(e) = app.emit("usage-cache-updated", payload) {
            log::error!("emit usage-cache-updated (subscription) failed: {e}");
        }
        state.usage_cache.put_subscription(app_type, snapshot);
        crate::tray::schedule_tray_refresh(&app);
    }
    inner
}
