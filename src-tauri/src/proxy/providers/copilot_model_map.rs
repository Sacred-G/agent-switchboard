//!
//!

use super::copilot_auth::CopilotModel;
use serde_json::Value;

pub(super) fn normalize_to_copilot_id(client_id: &str) -> Option<String> {
    let trimmed = client_id.trim();
    let bytes = trimmed.as_bytes();

    if bytes.len() < 8 || !bytes[..7].eq_ignore_ascii_case(b"claude-") {
        return None;
    }

    let has_one_m_bracket = ends_with_ascii_ci(bytes, b"[1m]");

    if trimmed.contains('.') && !has_one_m_bracket {
        return None;
    }

    let (base, has_1m_suffix) = split_one_m_suffix(trimmed);
    let stripped = strip_trailing_date(base);
    let dotted = dashes_to_dot_in_last_version(stripped);

    if dotted.is_none() && !has_1m_suffix {
        return None;
    }

    let mut candidate = dotted.unwrap_or_else(|| stripped.to_string());
    if has_1m_suffix {
        candidate.push_str("-1m");
    }
    (candidate != trimmed).then_some(candidate)
}

pub fn apply_copilot_model_normalization(mut body: Value) -> Value {
    let Some(orig) = body.get("model").and_then(|v| v.as_str()) else {
        return body;
    };
    if let Some(normalized) = normalize_to_copilot_id(orig) {
        log::debug!("[CopilotNormalizer] {orig} → {normalized}");
        body["model"] = Value::String(normalized);
    }
    body
}

fn ends_with_ascii_ci(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len()
        && haystack[haystack.len() - needle.len()..].eq_ignore_ascii_case(needle)
}

fn split_one_m_suffix(id: &str) -> (&str, bool) {
    let bytes = id.as_bytes();
    if ends_with_ascii_ci(bytes, b"[1m]") {
        return (&id[..bytes.len() - 4], true);
    }
    if ends_with_ascii_ci(bytes, b"-1m") {
        return (&id[..bytes.len() - 3], true);
    }
    (id, false)
}

fn strip_trailing_date(id: &str) -> &str {
    let Some(last_dash) = id.rfind('-') else {
        return id;
    };
    let suffix = &id[last_dash + 1..];
    if suffix.len() == 8 && suffix.bytes().all(|b| b.is_ascii_digit()) {
        &id[..last_dash]
    } else {
        id
    }
}

fn dashes_to_dot_in_last_version(id: &str) -> Option<String> {
    let last_dash = id.rfind('-')?;
    let last_segment = &id[last_dash + 1..];
    if last_segment.is_empty() || !last_segment.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let head = &id[..last_dash];
    let prev_dash = head.rfind('-')?;
    let prev_segment = &head[prev_dash + 1..];
    if prev_segment.is_empty() || !prev_segment.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{head}.{last_segment}"))
}

///
///
pub fn resolve_against_models(client_id: &str, models: &[CopilotModel]) -> Option<String> {
    let normalized = normalize_to_copilot_id(client_id);
    let target = normalized.as_deref().unwrap_or(client_id);

    if models.iter().any(|m| m.id.eq_ignore_ascii_case(target)) {
        return normalized.filter(|s| s != client_id);
    }

    let fallback = family_fallback(target, models)?;
    if fallback.eq_ignore_ascii_case(client_id) {
        None
    } else {
        Some(fallback)
    }
}

fn detect_family(id: &str) -> Option<&'static str> {
    let lower = id.to_ascii_lowercase();
    if lower.contains("haiku") {
        Some("haiku")
    } else if lower.contains("sonnet") {
        Some("sonnet")
    } else if lower.contains("opus") {
        Some("opus")
    } else {
        None
    }
}

fn extract_major_minor(id: &str) -> Option<(u32, u32)> {
    let lower = id.to_ascii_lowercase();
    let family = detect_family(&lower)?;
    let after = &lower[lower.find(family)? + family.len()..];
    let after = after.strip_prefix('-')?;
    let segment = after.split(['-', '[', ' ']).next()?;
    let mut parts = segment.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor))
}

fn family_fallback(target: &str, models: &[CopilotModel]) -> Option<String> {
    let family = detect_family(target)?;
    let want_1m = target.ends_with("-1m");

    let pick_best = |require_1m: bool| -> Option<String> {
        models
            .iter()
            .filter(|m| {
                let lower = m.id.to_ascii_lowercase();
                lower.contains(family) && lower.ends_with("-1m") == require_1m
            })
            .filter_map(|m| extract_major_minor(&m.id).map(|v| (m, v)))
            .max_by_key(|(_, v)| *v)
            .map(|(m, _)| m.id.clone())
    };

    if want_1m {
        pick_best(true).or_else(|| pick_best(false))
    } else {
        pick_best(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dashes_to_dot_basic() {
        assert_eq!(
            normalize_to_copilot_id("claude-sonnet-4-6"),
            Some("claude-sonnet-4.6".to_string())
        );
        assert_eq!(
            normalize_to_copilot_id("claude-opus-4-6"),
            Some("claude-opus-4.6".to_string())
        );
        assert_eq!(
            normalize_to_copilot_id("claude-haiku-4-5"),
            Some("claude-haiku-4.5".to_string())
        );
    }

    #[test]
    fn one_m_bracket_to_dash() {
        assert_eq!(
            normalize_to_copilot_id("claude-sonnet-4-6[1m]"),
            Some("claude-sonnet-4.6-1m".to_string())
        );
        assert_eq!(
            normalize_to_copilot_id("claude-opus-4-6[1m]"),
            Some("claude-opus-4.6-1m".to_string())
        );
    }

    #[test]
    fn one_m_bracket_on_already_dotted() {
        assert_eq!(
            normalize_to_copilot_id("claude-sonnet-4.6[1m]"),
            Some("claude-sonnet-4.6-1m".to_string())
        );
    }

    #[test]
    fn date_suffix_stripped() {
        assert_eq!(
            normalize_to_copilot_id("claude-haiku-4-5-20251001"),
            Some("claude-haiku-4.5".to_string())
        );
        assert_eq!(
            normalize_to_copilot_id("claude-sonnet-4-5-20250929"),
            Some("claude-sonnet-4.5".to_string())
        );
    }

    #[test]
    fn already_copilot_format_returns_none() {
        assert_eq!(normalize_to_copilot_id("claude-sonnet-4.6"), None);
        assert_eq!(normalize_to_copilot_id("claude-opus-4.6-1m"), None);
        assert_eq!(normalize_to_copilot_id("claude-haiku-4.5"), None);
    }

    #[test]
    fn non_claude_models_untouched() {
        assert_eq!(normalize_to_copilot_id("gpt-5"), None);
        assert_eq!(normalize_to_copilot_id("gpt-4o-mini"), None);
        assert_eq!(normalize_to_copilot_id("o3"), None);
        assert_eq!(normalize_to_copilot_id(""), None);
    }

    #[test]
    fn legacy_three_part_versions_untouched() {
        assert_eq!(normalize_to_copilot_id("claude-3-5-sonnet"), None);
        assert_eq!(normalize_to_copilot_id("claude-3-5-sonnet-20241022"), None);
    }

    #[test]
    fn case_insensitive_on_prefix_and_suffix() {
        assert_eq!(
            normalize_to_copilot_id("Claude-Sonnet-4-6"),
            Some("Claude-Sonnet-4.6".to_string())
        );
        assert_eq!(
            normalize_to_copilot_id("claude-sonnet-4-6[1M]"),
            Some("claude-sonnet-4.6-1m".to_string())
        );
    }

    #[test]
    fn bracket_one_m_with_date_combined() {
        assert_eq!(
            normalize_to_copilot_id("claude-haiku-4-5-20251001[1m]"),
            Some("claude-haiku-4.5-1m".to_string())
        );
    }

    #[test]
    fn apply_rewrites_body() {
        let body = json!({"model": "claude-sonnet-4-6", "max_tokens": 1024});
        let out = apply_copilot_model_normalization(body);
        assert_eq!(out["model"], "claude-sonnet-4.6");
        assert_eq!(out["max_tokens"], 1024);
    }

    #[test]
    fn apply_no_change_when_already_normalized() {
        let body = json!({"model": "claude-sonnet-4.6"});
        let out = apply_copilot_model_normalization(body);
        assert_eq!(out["model"], "claude-sonnet-4.6");
    }

    #[test]
    fn apply_handles_missing_model() {
        let body = json!({"messages": []});
        let out = apply_copilot_model_normalization(body);
        assert!(out.get("model").is_none());
    }

    fn model(id: &str) -> CopilotModel {
        CopilotModel {
            id: id.to_string(),
            name: id.to_string(),
            vendor: "anthropic".to_string(),
            model_picker_enabled: true,
        }
    }

    #[test]
    fn resolve_exact_match_after_normalize() {
        let models = vec![
            model("claude-sonnet-4.6"),
            model("claude-opus-4.6"),
            model("claude-haiku-4.5"),
        ];
        assert_eq!(
            resolve_against_models("claude-sonnet-4-6", &models),
            Some("claude-sonnet-4.6".to_string())
        );
    }

    #[test]
    fn resolve_returns_none_when_already_valid() {
        let models = vec![model("claude-sonnet-4.6")];
        assert_eq!(resolve_against_models("claude-sonnet-4.6", &models), None);
    }

    #[test]
    fn resolve_falls_back_to_highest_family_version() {
        let models = vec![
            model("claude-opus-4.5"),
            model("claude-opus-4.6"),
            model("claude-sonnet-4.6"),
        ];
        assert_eq!(
            resolve_against_models("claude-opus-4.8", &models),
            Some("claude-opus-4.6".to_string())
        );
    }

    #[test]
    fn resolve_prefers_1m_when_requested() {
        let models = vec![
            model("claude-sonnet-4.6"),
            model("claude-sonnet-4.6-1m"),
            model("claude-opus-4.6"),
        ];
        assert_eq!(
            resolve_against_models("claude-sonnet-4-6[1m]", &models),
            Some("claude-sonnet-4.6-1m".to_string())
        );
    }

    #[test]
    fn resolve_falls_back_to_base_when_1m_unavailable() {
        let models = vec![model("claude-sonnet-4.6")];
        assert_eq!(
            resolve_against_models("claude-sonnet-4-6[1m]", &models),
            Some("claude-sonnet-4.6".to_string())
        );
    }

    #[test]
    fn resolve_returns_none_when_family_absent() {
        let models = vec![model("claude-sonnet-4.6"), model("claude-haiku-4.5")];
        assert_eq!(resolve_against_models("claude-opus-4.6", &models), None);
    }

    #[test]
    fn resolve_handles_non_claude_target() {
        let models = vec![model("claude-sonnet-4.6")];
        assert_eq!(resolve_against_models("gpt-5", &models), None);
    }
}
