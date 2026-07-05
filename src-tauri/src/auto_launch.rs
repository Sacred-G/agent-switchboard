use crate::error::AppError;
use auto_launch::{AutoLaunch, AutoLaunchBuilder};

#[cfg(target_os = "macos")]
fn get_macos_app_bundle_path(exe_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let path_str = exe_path.to_string_lossy();
    if let Some(app_pos) = path_str.find(".app/Contents/MacOS/") {
        let app_bundle_end = app_pos + 4;
        Some(std::path::PathBuf::from(&path_str[..app_bundle_end]))
    } else {
        None
    }
}

fn get_auto_launch() -> Result<AutoLaunch, AppError> {
    let app_name = "Agent Switchboard";
    let exe_path =
        std::env::current_exe().map_err(|e| AppError::Message(format!(": {e}")))?;

    #[cfg(target_os = "macos")]
    let app_path = get_macos_app_bundle_path(&exe_path).unwrap_or(exe_path);

    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path;

    let auto_launch = AutoLaunchBuilder::new()
        .set_app_name(app_name)
        .set_app_path(&app_path.to_string_lossy())
        .build()
        .map_err(|e| AppError::Message(format!(" AutoLaunch failed: {e}")))?;

    Ok(auto_launch)
}

pub fn enable_auto_launch() -> Result<(), AppError> {
    let auto_launch = get_auto_launch()?;
    auto_launch
        .enable()
        .map_err(|e| AppError::Message(format!("failed: {e}")))?;
    log::info!("");
    Ok(())
}

pub fn disable_auto_launch() -> Result<(), AppError> {
    let auto_launch = get_auto_launch()?;
    auto_launch
        .disable()
        .map_err(|e| AppError::Message(format!("failed: {e}")))?;
    log::info!("");
    Ok(())
}

pub fn is_auto_launch_enabled() -> Result<bool, AppError> {
    let auto_launch = get_auto_launch()?;
    auto_launch
        .is_enabled()
        .map_err(|e| AppError::Message(format!("failed: {e}")))
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_valid() {
        let exe_path = std::path::Path::new("/Applications/Agent Switchboard.app/Contents/MacOS/Agent Switchboard");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from("/Applications/Agent Switchboard.app"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_with_spaces() {
        let exe_path =
            std::path::Path::new("/Users/test/My Apps/Agent Switchboard.app/Contents/MacOS/Agent Switchboard");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from(
                "/Users/test/My Apps/Agent Switchboard.app"
            ))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_not_in_bundle() {
        let exe_path = std::path::Path::new("/usr/local/bin/agent-switchboard");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(result, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_dev_build() {
        let exe_path = std::path::Path::new("/Users/dev/project/target/debug/agent-switchboard");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(result, None);
    }
}
