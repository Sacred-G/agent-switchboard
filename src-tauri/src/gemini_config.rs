use crate::config::{get_home_dir, write_text_file};
use crate::error::AppError;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

pub fn get_gemini_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_gemini_override_dir() {
        return custom;
    }

    get_home_dir().join(".gemini")
}

pub fn get_gemini_env_path() -> PathBuf {
    get_gemini_dir().join(".env")
}

///
pub fn parse_env_file(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for line in content.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim().to_string();
            let value = value.trim().to_string();

            if !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_') {
                map.insert(key, value);
            }
        }
    }

    map
}

///
///
///
///
///
///
#[allow(dead_code)]
pub fn parse_env_file_strict(content: &str) -> Result<HashMap<String, String>, AppError> {
    let mut map = HashMap::new();

    for (line_num, line) in content.lines().enumerate() {
        let line = line.trim();
        let line_number = line_num + 1;

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if !line.contains('=') {
            return Err(AppError::localized(
                "gemini.env.parse_error.no_equals",
                format!("Gemini .env Error {line_number} : Missing '=' \n: {line}"),
                format!("Invalid Gemini .env format (line {line_number}): missing '=' separator\nLine: {line}"),
            ));
        }

        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            if key.is_empty() {
                return Err(AppError::localized(
                    "gemini.env.parse_error.empty_key",
                    format!("Gemini .env Error {line_number} : \n: {line}"),
                    format!("Invalid Gemini .env format (line {line_number}): variable name cannot be empty\nLine: {line}"),
                ));
            }

            if !key.chars().all(|c| c.is_alphanumeric() || c == '_') {
                return Err(AppError::localized(
                    "gemini.env.parse_error.invalid_key",
                    format!("Gemini .env Error {line_number} : 、\n: {key}"),
                    format!("Invalid Gemini .env format (line {line_number}): variable name can only contain letters, numbers, and underscores\nVariable: {key}"),
                ));
            }

            map.insert(key.to_string(), value.to_string());
        }
    }

    Ok(map)
}

pub fn serialize_env_file(map: &HashMap<String, String>) -> String {
    let mut lines = Vec::new();

    let mut keys: Vec<_> = map.keys().collect();
    keys.sort();

    for key in keys {
        if let Some(value) = map.get(key) {
            lines.push(format!("{key}={value}"));
        }
    }

    lines.join("\n")
}

pub fn read_gemini_env() -> Result<HashMap<String, String>, AppError> {
    let path = get_gemini_env_path();

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;

    Ok(parse_env_file(&content))
}

pub fn write_gemini_env_atomic(map: &HashMap<String, String>) -> Result<(), AppError> {
    let path = get_gemini_env_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(parent)
                .map_err(|e| AppError::io(parent, e))?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(parent, perms).map_err(|e| AppError::io(parent, e))?;
        }
    }

    let content = serialize_env_file(map);
    write_text_file(&path, &content)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)
            .map_err(|e| AppError::io(&path, e))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms).map_err(|e| AppError::io(&path, e))?;
    }

    Ok(())
}

pub fn env_to_json(env_map: &HashMap<String, String>) -> Value {
    let mut json_map = serde_json::Map::new();

    for (key, value) in env_map {
        json_map.insert(key.clone(), Value::String(value.clone()));
    }

    serde_json::json!({ "env": json_map })
}

pub fn json_to_env(settings: &Value) -> Result<HashMap<String, String>, AppError> {
    let mut env_map = HashMap::new();

    if let Some(env_obj) = settings.get("env").and_then(|v| v.as_object()) {
        for (key, value) in env_obj {
            if let Some(val_str) = value.as_str() {
                env_map.insert(key.clone(), val_str.to_string());
            }
        }
    }

    Ok(env_map)
}

///
///
pub fn validate_gemini_settings(settings: &Value) -> Result<(), AppError> {
    if let Some(env) = settings.get("env") {
        if !env.is_object() {
            return Err(AppError::localized(
                "gemini.validation.invalid_env",
                "Gemini ConfigureError: env must be",
                "Gemini config invalid: env must be an object",
            ));
        }
    }

    if let Some(config) = settings.get("config") {
        if !(config.is_object() || config.is_null()) {
            return Err(AppError::localized(
                "gemini.validation.invalid_config",
                "Gemini ConfigureError: config must be",
                "Gemini config invalid: config must be an object",
            ));
        }
    }

    Ok(())
}

///
pub fn validate_gemini_settings_strict(settings: &Value) -> Result<(), AppError> {
    validate_gemini_settings(settings)?;

    let env_map = json_to_env(settings)?;

    if env_map.is_empty() {
        return Ok(());
    }

    if !env_map.contains_key("GEMINI_API_KEY") {
        return Err(AppError::localized(
            "gemini.validation.missing_api_key",
            "Gemini ConfigureMissing: GEMINI_API_KEY",
            "Gemini config missing required field: GEMINI_API_KEY",
        ));
    }

    Ok(())
}

///
pub fn get_gemini_settings_path() -> PathBuf {
    get_gemini_dir().join("settings.json")
}

///
///
fn update_selected_type(selected_type: &str) -> Result<(), AppError> {
    let settings_path = get_gemini_settings_path();

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let mut settings_content = if settings_path.exists() {
        let content =
            fs::read_to_string(&settings_path).map_err(|e| AppError::io(&settings_path, e))?;
        serde_json::from_str::<Value>(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(obj) = settings_content.as_object_mut() {
        let security = obj
            .entry("security")
            .or_insert_with(|| serde_json::json!({}));

        if let Some(security_obj) = security.as_object_mut() {
            let auth = security_obj
                .entry("auth")
                .or_insert_with(|| serde_json::json!({}));

            if let Some(auth_obj) = auth.as_object_mut() {
                auth_obj.insert(
                    "selectedType".to_string(),
                    Value::String(selected_type.to_string()),
                );
            }
        }
    }

    crate::config::write_json_file(&settings_path, &settings_content)?;

    Ok(())
}

///
/// ```json
/// {
///   "security": {
///     "auth": {
///       "selectedType": "gemini-api-key"
///     }
///   }
/// }
/// ```
///
pub fn write_packycode_settings() -> Result<(), AppError> {
    update_selected_type("gemini-api-key")
}

///
/// ```json
/// {
///   "security": {
///     "auth": {
///       "selectedType": "oauth-personal"
///     }
///   }
/// }
/// ```
///
pub fn write_google_oauth_settings() -> Result<(), AppError> {
    update_selected_type("oauth-personal")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_env_file() {
        let content = r#"
# Comment line
GOOGLE_GEMINI_BASE_URL=https://example.com
GEMINI_API_KEY=sk-test123
GEMINI_MODEL=gemini-3.5-flash

# Another comment
"#;

        let map = parse_env_file(content);

        assert_eq!(map.len(), 3);
        assert_eq!(
            map.get("GOOGLE_GEMINI_BASE_URL"),
            Some(&"https://example.com".to_string())
        );
        assert_eq!(map.get("GEMINI_API_KEY"), Some(&"sk-test123".to_string()));
        assert_eq!(
            map.get("GEMINI_MODEL"),
            Some(&"gemini-3.5-flash".to_string())
        );
    }

    #[test]
    fn test_serialize_env_file() {
        let mut map = HashMap::new();
        map.insert("GEMINI_API_KEY".to_string(), "sk-test".to_string());
        map.insert("GEMINI_MODEL".to_string(), "gemini-3.5-flash".to_string());

        let content = serialize_env_file(&map);

        assert!(content.contains("GEMINI_API_KEY=sk-test"));
        assert!(content.contains("GEMINI_MODEL=gemini-3.5-flash"));
    }

    #[test]
    fn test_env_json_conversion() {
        let mut env_map = HashMap::new();
        env_map.insert("GEMINI_API_KEY".to_string(), "test-key".to_string());

        let json = env_to_json(&env_map);
        let converted = json_to_env(&json).unwrap();

        assert_eq!(
            converted.get("GEMINI_API_KEY"),
            Some(&"test-key".to_string())
        );
    }

    #[test]
    fn test_parse_env_file_strict_success() {
        let content = r#"
# Comment line
GOOGLE_GEMINI_BASE_URL=https://example.com
GEMINI_API_KEY=sk-test123
GEMINI_MODEL=gemini-3.5-flash

# Another comment
"#;

        let result = parse_env_file_strict(content);
        assert!(result.is_ok());

        let map = result.unwrap();
        assert_eq!(map.len(), 3);
        assert_eq!(
            map.get("GOOGLE_GEMINI_BASE_URL"),
            Some(&"https://example.com".to_string())
        );
        assert_eq!(map.get("GEMINI_API_KEY"), Some(&"sk-test123".to_string()));
        assert_eq!(
            map.get("GEMINI_MODEL"),
            Some(&"gemini-3.5-flash".to_string())
        );
    }

    #[test]
    fn test_parse_env_file_strict_missing_equals() {
        let content = "GOOGLE_GEMINI_BASE_URL=https://example.com
INVALID_LINE_WITHOUT_EQUALS
GEMINI_API_KEY=sk-test123";

        let result = parse_env_file_strict(content);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let err_msg = format!("{err:?}");
        assert!(err_msg.contains(" 2 ") || err_msg.contains("line 2"));
        assert!(err_msg.contains("INVALID_LINE_WITHOUT_EQUALS"));
    }

    #[test]
    fn test_parse_env_file_strict_empty_key() {
        let content = "GOOGLE_GEMINI_BASE_URL=https://example.com
=value_without_key
GEMINI_API_KEY=sk-test123";

        let result = parse_env_file_strict(content);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let err_msg = format!("{err:?}");
        assert!(err_msg.contains(" 2 ") || err_msg.contains("line 2"));
        assert!(err_msg.contains("empty") || err_msg.contains(""));
    }

    #[test]
    fn test_parse_env_file_strict_invalid_key_characters() {
        let content = "GOOGLE_GEMINI_BASE_URL=https://example.com
INVALID KEY WITH SPACES=value
GEMINI_API_KEY=sk-test123";

        let result = parse_env_file_strict(content);
        assert!(result.is_err());

        let err = result.unwrap_err();
        let err_msg = format!("{err:?}");
        assert!(err_msg.contains(" 2 ") || err_msg.contains("line 2"));
        assert!(err_msg.contains("INVALID KEY WITH SPACES"));
    }

    #[test]
    fn test_parse_env_file_lax_vs_strict() {
        let content = "VALID_KEY=value
INVALID LINE
KEY_WITH-DASH=value";

        let lax_result = parse_env_file(content);
        assert_eq!(lax_result.len(), 1);
        assert_eq!(lax_result.get("VALID_KEY"), Some(&"value".to_string()));

        let strict_result = parse_env_file_strict(content);
        assert!(strict_result.is_err());
    }

    #[test]
    fn test_packycode_settings_structure() {
        let settings_content = serde_json::json!({
            "security": {
                "auth": {
                    "selectedType": "gemini-api-key"
                }
            }
        });

        assert_eq!(
            settings_content["security"]["auth"]["selectedType"],
            "gemini-api-key"
        );
    }

    #[test]
    fn test_packycode_settings_merge() {
        let mut existing_settings = serde_json::json!({
            "otherField": "should-be-kept",
            "security": {
                "otherSetting": "also-kept",
                "auth": {
                    "otherAuth": "preserved"
                }
            }
        });

        if let Some(obj) = existing_settings.as_object_mut() {
            let security = obj
                .entry("security")
                .or_insert_with(|| serde_json::json!({}));

            if let Some(security_obj) = security.as_object_mut() {
                let auth = security_obj
                    .entry("auth")
                    .or_insert_with(|| serde_json::json!({}));

                if let Some(auth_obj) = auth.as_object_mut() {
                    auth_obj.insert(
                        "selectedType".to_string(),
                        Value::String("gemini-api-key".to_string()),
                    );
                }
            }
        }

        assert_eq!(existing_settings["otherField"], "should-be-kept");
        assert_eq!(existing_settings["security"]["otherSetting"], "also-kept");
        assert_eq!(
            existing_settings["security"]["auth"]["otherAuth"],
            "preserved"
        );
        assert_eq!(
            existing_settings["security"]["auth"]["selectedType"],
            "gemini-api-key"
        );
    }

    #[test]
    fn test_google_oauth_settings_structure() {
        let settings_content = serde_json::json!({
            "security": {
                "auth": {
                    "selectedType": "oauth-personal"
                }
            }
        });

        assert_eq!(
            settings_content["security"]["auth"]["selectedType"],
            "oauth-personal"
        );
    }

    #[test]
    fn test_validate_empty_env_for_oauth() {
        let settings = serde_json::json!({
            "env": {}
        });

        assert!(validate_gemini_settings(&settings).is_ok());
        assert!(validate_gemini_settings_strict(&settings).is_ok());
    }

    #[test]
    fn test_validate_env_with_api_key() {
        let settings = serde_json::json!({
            "env": {
                "GEMINI_API_KEY": "sk-test123",
                "GEMINI_MODEL": "gemini-3.5-flash"
            }
        });

        assert!(validate_gemini_settings(&settings).is_ok());
        assert!(validate_gemini_settings_strict(&settings).is_ok());
    }

    #[test]
    fn test_validate_env_without_api_key_relaxed() {
        let settings = serde_json::json!({
            "env": {
                "GEMINI_MODEL": "gemini-3.5-flash"
            }
        });

        assert!(validate_gemini_settings(&settings).is_ok());
        assert!(validate_gemini_settings_strict(&settings).is_err());
    }

    #[test]
    fn test_validate_invalid_env_type() {
        let settings = serde_json::json!({
            "env": "invalid_string"
        });

        assert!(validate_gemini_settings(&settings).is_err());
    }
}
