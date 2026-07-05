use crate::database::Database;
use crate::services::{ProxyService, UsageCache};
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub proxy_service: ProxyService,
    pub usage_cache: Arc<UsageCache>,
}

impl AppState {
    pub fn new(db: Arc<Database>) -> Self {
        let proxy_service = ProxyService::new(db.clone());

        Self {
            db,
            proxy_service,
            usage_cache: Arc::new(UsageCache::new()),
        }
    }
}
