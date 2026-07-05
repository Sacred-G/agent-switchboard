//!
//!

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub const EVENT_USAGE_LOG_RECORDED: &str = "usage-log-recorded";

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(200);

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

static EMIT_SCHEDULED: AtomicBool = AtomicBool::new(false);

///
pub fn init(handle: AppHandle) {
    if APP_HANDLE.set(handle).is_err() {
        log::debug!("usage_events::init ");
    } else {
        log::info!("[usage-event] AppHandle ");
    }
}

///
pub fn notify_log_recorded() {
    let Some(handle) = APP_HANDLE.get() else {
        return;
    };

    if EMIT_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }

    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(DEBOUNCE_WINDOW);
        EMIT_SCHEDULED.store(false, Ordering::Release);

        if let Err(e) = handle.emit(EVENT_USAGE_LOG_RECORDED, ()) {
            log::warn!("emit {EVENT_USAGE_LOG_RECORDED} failed: {e}");
        }
    });
}
