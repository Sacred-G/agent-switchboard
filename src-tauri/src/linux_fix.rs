//!
//!
//!

use std::time::Duration;

use tauri::{PhysicalSize, WebviewWindow};

const REALIZE_WAIT: Duration = Duration::from_millis(200);

const RESIZE_GAP: Duration = Duration::from_millis(100);

const RECONCILE_WAIT: Duration = Duration::from_millis(500);

///
pub(crate) fn nudge_main_window(window: WebviewWindow) {
    let _ = window.set_focus();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REALIZE_WAIT).await;

        let _ = window.set_focus();

        //
        match window.inner_size() {
            Ok(original) => {
                let bumped = PhysicalSize::new(original.width.saturating_add(1), original.height);
                let _ = window.set_size(bumped);
                tokio::time::sleep(RESIZE_GAP).await;
                let _ = window.set_size(original);
                log::info!("Linux:  focus + surface ");

                //
                tokio::time::sleep(RECONCILE_WAIT).await;
                match window.inner_size() {
                    Ok(after) => {
                        if after.width != original.width || after.height != original.height {
                            log::info!(
                                "Linux nudge  drift: expected={}x{}, got={}x{}",
                                original.width,
                                original.height,
                                after.width,
                                after.height
                            );
                            let _ = window.set_size(original);
                            if let Ok(final_size) = window.inner_size() {
                                if final_size.width != original.width
                                    || final_size.height != original.height
                                {
                                    log::warn!(
                                        "Linux nudge  drift : expected={}x{}, got={}x{}",
                                        original.width,
                                        original.height,
                                        final_size.width,
                                        final_size.height
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Linux nudge:  inner_size failed: {e}");
                    }
                }
            }
            Err(e) => {
                log::warn!("Linux nudge: Read inner_size failed resize: {e}");
            }
        }
    });
}
