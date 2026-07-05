//!

use super::subscription::{
    CredentialStatus, QuotaTier, SubscriptionQuota, TIER_FIVE_HOUR, TIER_MONTHLY, TIER_WEEKLY_LIMIT,
};
use std::time::{SystemTime, UNIX_EPOCH};


enum CodingPlanProvider {
    Kimi,
    ZhipuCn,
    ZhipuEn,
    MiniMaxCn,
    MiniMaxEn,
    ZenMux,
    Volcengine,
}

fn detect_provider(base_url: &str) -> Option<CodingPlanProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.kimi.com/coding") {
        Some(CodingPlanProvider::Kimi)
    } else if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") {
        Some(CodingPlanProvider::ZhipuCn)
    } else if url.contains("api.z.ai") {
        Some(CodingPlanProvider::ZhipuEn)
    } else if url.contains("api.minimaxi.com") {
        Some(CodingPlanProvider::MiniMaxCn)
    } else if url.contains("api.minimax.io") {
        Some(CodingPlanProvider::MiniMaxEn)
    } else if url.contains("zenmux") {
        Some(CodingPlanProvider::ZenMux)
    } else if url.contains("volces.com/api/coding") {
        Some(CodingPlanProvider::Volcengine)
    } else {
        None
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn millis_to_iso8601(ms: i64) -> Option<String> {
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

fn extract_reset_time(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(n) = value.as_i64() {
        if n <= 0 {
            return None;
        }
        let ms = if n < 1_000_000_000_000 { n * 1000 } else { n };
        return millis_to_iso8601(ms);
    }
    None
}

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn make_error(msg: String) -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: false,
        tiers: vec![],
        extra_usage: None,
        error: Some(msg),
        queried_at: Some(now_millis()),
    }
}

// ── Kimi For Coding ─────────────────────────────────────────

async fn query_kimi(api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get("https://api.kimi.com/coding/v1/usages")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return make_error(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            queried_at: Some(now_millis()),
        };
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return make_error(format!("failed to parse response: {e}")),
    };

    let mut tiers = Vec::new();

    if let Some(limits) = body.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            if let Some(detail) = limit_item.get("detail") {
                let limit = detail.get("limit").and_then(parse_f64).unwrap_or(1.0);
                let remaining = detail.get("remaining").and_then(parse_f64).unwrap_or(0.0);
                let resets_at = detail.get("resetTime").and_then(extract_reset_time);

                let used = (limit - remaining).max(0.0);
                let utilization = if limit > 0.0 {
                    (used / limit) * 100.0
                } else {
                    0.0
                };
                tiers.push(QuotaTier {
                    name: "five_hour".to_string(),
                    utilization,
                    resets_at,
                    used_value_usd: None,
                    max_value_usd: None,
                });
            }
        }
    }

    if let Some(usage) = body.get("usage") {
        let limit = usage.get("limit").and_then(parse_f64).unwrap_or(1.0);
        let remaining = usage.get("remaining").and_then(parse_f64).unwrap_or(0.0);
        let resets_at = usage.get("resetTime").and_then(extract_reset_time);

        let used = (limit - remaining).max(0.0);
        let utilization = if limit > 0.0 {
            (used / limit) * 100.0
        } else {
            0.0
        };
        tiers.push(QuotaTier {
            name: "weekly_limit".to_string(),
            utilization,
            resets_at,
            used_value_usd: None,
            max_value_usd: None,
        });
    }

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}


enum ZhipuWindow {
    FiveHour,
    Weekly,
}

///
///
fn classify_zhipu_window(item: &serde_json::Value) -> Option<ZhipuWindow> {
    match item.get("unit").and_then(|v| v.as_i64()) {
        Some(3) => Some(ZhipuWindow::FiveHour),
        Some(6) => Some(ZhipuWindow::Weekly),
        _ => None,
    }
}

///
///
fn parse_zhipu_token_tiers(data: &serde_json::Value) -> Vec<QuotaTier> {
    type Entry = (Option<i64>, f64, Option<String>);
    let mut five_hour: Option<Entry> = None;
    let mut weekly: Option<Entry> = None;
    let mut unclassified: Vec<Entry> = Vec::new();

    if let Some(limits) = data.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            let limit_type = limit_item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
                continue;
            }
            let percentage = limit_item
                .get("percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let reset_ms = limit_item.get("nextResetTime").and_then(|v| v.as_i64());
            let reset_iso = reset_ms.and_then(millis_to_iso8601);
            let entry = (reset_ms, percentage, reset_iso);
            match classify_zhipu_window(limit_item) {
                Some(ZhipuWindow::FiveHour) if five_hour.is_none() => five_hour = Some(entry),
                Some(ZhipuWindow::Weekly) if weekly.is_none() => weekly = Some(entry),
                _ => unclassified.push(entry),
            }
        }
    }

    unclassified.sort_by_key(|(reset, _, _)| (reset.is_some(), reset.unwrap_or(i64::MIN)));
    for entry in unclassified {
        if five_hour.is_none() {
            five_hour = Some(entry);
        } else if weekly.is_none() {
            weekly = Some(entry);
        }
    }

    let mut tiers = Vec::new();
    for (name, slot) in [(TIER_FIVE_HOUR, five_hour), (TIER_WEEKLY_LIMIT, weekly)] {
        if let Some((_, percentage, resets_at)) = slot {
            tiers.push(QuotaTier {
                name: name.to_string(),
                utilization: percentage,
                resets_at,
                used_value_usd: None,
                max_value_usd: None,
            });
        }
    }
    tiers
}

/// Resolve the Zhipu quota endpoint from the user's configured `base_url`.
///
/// Zhipu ships as two distinct presets (Zhipu GLM = `open.bigmodel.cn`,
/// Zhipu GLM en = `api.z.ai`) that share the same quota path and JSON shape.
/// The quota endpoint lives on the same host as the user's coding endpoint,
/// so we route by `base_url` and let the caller's existing reachability
/// (they're already using this host to run coding) determine success — no
/// cross-host fallback, no auth-error heuristics.
fn zhipu_quota_base(base_url: &str) -> &'static str {
    if base_url.to_lowercase().contains("bigmodel.cn") {
        "https://open.bigmodel.cn"
    } else {
        "https://api.z.ai"
    }
}

async fn query_zhipu(base_url: &str, api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();
    let url = format!(
        "{}/api/monitor/usage/quota/limit",
        zhipu_quota_base(base_url)
    );

    let resp = client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .header("Accept-Language", "en-US,en")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return make_error(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            queried_at: Some(now_millis()),
        };
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return make_error(format!("failed to parse response: {e}")),
    };

    if body.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = body
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return make_error(format!("API error: {msg}"));
    }

    let data = match body.get("data") {
        Some(d) => d,
        None => return make_error("Missing 'data' field in response".to_string()),
    };

    let tiers = parse_zhipu_token_tiers(data);

    let level = data
        .get("level")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: level,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

// ── MiniMax ─────────────────────────────────────────────────

async fn query_minimax(api_key: &str, is_cn: bool) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let api_domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{api_domain}/v1/api/openplatform/coding_plan/remains");

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return make_error(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            queried_at: Some(now_millis()),
        };
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return make_error(format!("failed to parse response: {e}")),
    };

    if let Some(base_resp) = body.get("base_resp") {
        let status_code = base_resp
            .get("status_code")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);
        if status_code != 0 {
            let msg = base_resp
                .get("status_msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return make_error(format!("API error (code {status_code}): {msg}"));
        }
    }

    let tiers = parse_minimax_tiers(&body);

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: None,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

// ── ZenMux ──────────────────────────────────────────────────

async fn query_zenmux(base_url: &str, api_key: &str) -> SubscriptionQuota {
    let client = crate::proxy::http_client::get();

    let resp = client
        .get(base_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return make_error(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Expired,
            credential_message: Some("Invalid API key".to_string()),
            success: false,
            tiers: vec![],
            extra_usage: None,
            error: Some(format!("Authentication failed (HTTP {status})")),
            queried_at: Some(now_millis()),
        };
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return make_error(format!("API error (HTTP {status}): {body}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return make_error(format!("failed to parse response: {e}")),
    };

    if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return make_error(format!("API error: {msg}"));
    }

    let data = match body.get("data") {
        Some(d) => d,
        None => return make_error("Missing 'data' field in response".to_string()),
    };

    let mut tiers = Vec::new();

    if let Some(q5h) = data.get("quota_5_hour") {
        let usage_pct = q5h
            .get("usage_percentage")
            .and_then(parse_f64)
            .unwrap_or(0.0);
        let resets_at = q5h
            .get("resets_at")
            .and_then(|v| v.as_str())
            .map(String::from);
        let used_usd = q5h.get("used_value_usd").and_then(parse_f64);
        let max_usd = q5h.get("max_value_usd").and_then(parse_f64);
        tiers.push(QuotaTier {
            name: "five_hour".to_string(),
            utilization: usage_pct * 100.0,
            resets_at,
            used_value_usd: used_usd,
            max_value_usd: max_usd,
        });
    }

    if let Some(q7d) = data.get("quota_7_day") {
        let usage_pct = q7d
            .get("usage_percentage")
            .and_then(parse_f64)
            .unwrap_or(0.0);
        let resets_at = q7d
            .get("resets_at")
            .and_then(|v| v.as_str())
            .map(String::from);
        let used_usd = q7d.get("used_value_usd").and_then(parse_f64);
        let max_usd = q7d.get("max_value_usd").and_then(parse_f64);
        tiers.push(QuotaTier {
            name: "weekly_limit".to_string(),
            utilization: usage_pct * 100.0,
            resets_at,
            used_value_usd: used_usd,
            max_value_usd: max_usd,
        });
    }

    let plan_tier = data
        .get("plan")
        .and_then(|p| p.get("tier"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let account_status = data
        .get("account_status")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let plan_info = if !plan_tier.is_empty() {
        format!("{plan_tier} ({account_status})")
    } else {
        String::new()
    };

    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: if plan_info.is_empty() {
            None
        } else {
            Some(plan_info)
        },
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

///
///
fn parse_minimax_tiers(body: &serde_json::Value) -> Vec<QuotaTier> {
    let mut tiers = Vec::new();

    let Some(model_remains) = body.get("model_remains").and_then(|v| v.as_array()) else {
        return tiers;
    };

    let Some(item) = model_remains.iter().find(|item| {
        item.get("model_name")
            .and_then(|v| v.as_str())
            .map(|s| s == "general")
            .unwrap_or(false)
    }) else {
        return tiers;
    };

    if let Some(remain_pct) = item
        .get("current_interval_remaining_percent")
        .and_then(|v| v.as_f64())
    {
        let resets_at = item
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_iso8601);
        tiers.push(QuotaTier {
            name: TIER_FIVE_HOUR.to_string(),
            utilization: 100.0 - remain_pct,
            resets_at,
            used_value_usd: None,
            max_value_usd: None,
        });
    }

    if item.get("current_weekly_status").and_then(|v| v.as_i64()) == Some(1) {
        if let Some(remain_pct) = item
            .get("current_weekly_remaining_percent")
            .and_then(|v| v.as_f64())
        {
            let resets_at = item
                .get("weekly_end_time")
                .and_then(|v| v.as_i64())
                .and_then(millis_to_iso8601);
            tiers.push(QuotaTier {
                name: TIER_WEEKLY_LIMIT.to_string(),
                utilization: 100.0 - remain_pct,
                resets_at,
                used_value_usd: None,
                max_value_usd: None,
            });
        }
    }

    tiers
}

//
//

const VOLCENGINE_OPENAPI_HOST: &str = "open.volcengineapi.com";
const VOLCENGINE_API_VERSION: &str = "2024-01-01";
const VOLCENGINE_DEFAULT_REGION: &str = "cn-beijing";

enum VolcCall {
    Body(serde_json::Value),
    Auth(String),
    Soft(String),
}

fn volcengine_region(base_url: &str) -> String {
    let host = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url)
        .split('/')
        .next()
        .unwrap_or("");
    host.split('.')
        .find(|p| p.starts_with("cn-") || p.starts_with("ap-"))
        .map(|p| p.to_string())
        .unwrap_or_else(|| VOLCENGINE_DEFAULT_REGION.to_string())
}

fn volcengine_is_auth_error_code(code: &str) -> bool {
    let c = code.to_lowercase();
    c.contains("auth")
        || c.contains("signature")
        || c.contains("accessdenied")
        || c.contains("denied")
        || c.contains("unauthorized")
        || c.contains("forbidden")
        || c.contains("credential")
        || c.contains("token")
}

fn volcengine_response_error(body: &serde_json::Value) -> Option<(String, String)> {
    let err = body
        .get("ResponseMetadata")
        .and_then(|m| m.get("Error"))
        .or_else(|| body.get("Error"))?;
    let code = err
        .get("Code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let msg = err
        .get("Message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if code.is_empty() && msg.is_empty() {
        None
    } else {
        Some((code, msg))
    }
}

const VOLCENGINE_AKSK_HINT: &str =
    "Check the AccessKey ID / Secret are correct and the account has Ark usage-query (OpenAPI) permission.";

//

const VOLCENGINE_SERVICE: &str = "ark";
const VOLCENGINE_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const VOLCENGINE_SIGNED_HEADERS: &str = "host;x-date;x-content-sha256;content-type";

fn volc_hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<sha2::Sha256>;
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn volc_sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(data))
}

fn volc_uri_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}

fn volcengine_canonical_query(action: &str, region: &str) -> String {
    let mut pairs = [
        ("Action", action),
        ("Region", region),
        ("Version", VOLCENGINE_API_VERSION),
    ];
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", volc_uri_encode(k), volc_uri_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn volcengine_sign(
    access_key_id: &str,
    secret_access_key: &str,
    region: &str,
    canonical_query: &str,
    body: &[u8],
    now: chrono::DateTime<chrono::Utc>,
) -> (String, String, String) {
    let x_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = now.format("%Y%m%d").to_string();
    let x_content_sha256 = volc_sha256_hex(body);

    let canonical_headers = format!(
        "host:{VOLCENGINE_OPENAPI_HOST}\nx-date:{x_date}\nx-content-sha256:{x_content_sha256}\ncontent-type:{VOLCENGINE_CONTENT_TYPE}\n"
    );
    let canonical_request = format!(
        "POST\n/\n{canonical_query}\n{canonical_headers}\n{VOLCENGINE_SIGNED_HEADERS}\n{x_content_sha256}"
    );

    let credential_scope = format!("{short_date}/{region}/{VOLCENGINE_SERVICE}/request");
    let string_to_sign = format!(
        "HMAC-SHA256\n{x_date}\n{credential_scope}\n{}",
        volc_sha256_hex(canonical_request.as_bytes())
    );

    let k_date = volc_hmac_sha256(secret_access_key.as_bytes(), short_date.as_bytes());
    let k_region = volc_hmac_sha256(&k_date, region.as_bytes());
    let k_service = volc_hmac_sha256(&k_region, VOLCENGINE_SERVICE.as_bytes());
    let k_signing = volc_hmac_sha256(&k_service, b"request");
    let signature: String = volc_hmac_sha256(&k_signing, string_to_sign.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();

    let authorization = format!(
        "HMAC-SHA256 Credential={access_key_id}/{credential_scope}, SignedHeaders={VOLCENGINE_SIGNED_HEADERS}, Signature={signature}"
    );
    (authorization, x_date, x_content_sha256)
}

async fn volcengine_openapi_call(
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    action: &str,
) -> VolcCall {
    let client = crate::proxy::http_client::get();
    let canonical_query = volcengine_canonical_query(action, region);
    let url = format!("https://{VOLCENGINE_OPENAPI_HOST}/?{canonical_query}");
    let body: &[u8] = b"";
    let (authorization, x_date, x_content_sha256) = volcengine_sign(
        access_key_id,
        secret_access_key,
        region,
        &canonical_query,
        body,
        chrono::Utc::now(),
    );

    let resp = client
        .post(&url)
        .header("X-Date", x_date)
        .header("X-Content-Sha256", x_content_sha256)
        .header("Content-Type", VOLCENGINE_CONTENT_TYPE)
        .header("Authorization", authorization)
        .body(body.to_vec())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return VolcCall::Soft(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return VolcCall::Auth(format!(
            "Authentication failed (HTTP {status}). {VOLCENGINE_AKSK_HINT}"
        ));
    }
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        if let Ok(body) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some((code, msg)) = volcengine_response_error(&body) {
                if volcengine_is_auth_error_code(&code) {
                    return VolcCall::Auth(format!(
                        "Authentication failed (HTTP {status}, {code}): {msg}. {VOLCENGINE_AKSK_HINT}"
                    ));
                }
                return VolcCall::Soft(format!("API error (HTTP {status}, {code}): {msg}"));
            }
        }
        return VolcCall::Soft(format!("API error (HTTP {status}): {raw}"));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return VolcCall::Soft(format!("failed to parse response: {e}")),
    };

    if let Some((code, msg)) = volcengine_response_error(&body) {
        if volcengine_is_auth_error_code(&code) {
            return VolcCall::Auth(format!(
                "Authentication failed ({code}): {msg}. {VOLCENGINE_AKSK_HINT}"
            ));
        }
        return VolcCall::Soft(format!("API error ({code}): {msg}"));
    }

    VolcCall::Body(body)
}

///
fn parse_afp_tiers(result: &serde_json::Value) -> Vec<QuotaTier> {
    let mut tiers = Vec::new();
    for (key, name) in [
        ("AFPFiveHour", TIER_FIVE_HOUR),
        ("AFPWeekly", TIER_WEEKLY_LIMIT),
        ("AFPMonthly", TIER_MONTHLY),
    ] {
        let Some(win) = result.get(key) else { continue };
        let quota = win.get("Quota").and_then(parse_f64).unwrap_or(0.0);
        if quota <= 0.0 {
            continue;
        }
        let used = win.get("Used").and_then(parse_f64).unwrap_or(0.0);
        let utilization = used / quota * 100.0;
        let resets_at = win.get("ResetTime").and_then(extract_reset_time);
        tiers.push(QuotaTier {
            name: name.to_string(),
            utilization,
            resets_at,
            used_value_usd: None,
            max_value_usd: None,
        });
    }
    tiers
}

fn volcengine_coding_window(label: &str) -> Option<&'static str> {
    match label.to_lowercase().as_str() {
        "session" | "5h" | "fivehour" | "five_hour" | "rolling_5h" => Some(TIER_FIVE_HOUR),
        "weekly" | "week" | "7d" => Some(TIER_WEEKLY_LIMIT),
        "monthly" | "month" => Some(TIER_MONTHLY),
        _ => None,
    }
}

///
fn parse_coding_plan_tiers(result: &serde_json::Value) -> Vec<QuotaTier> {
    let mut tiers = Vec::new();
    let arr = result
        .get("QuotaUsage")
        .and_then(|v| v.as_array())
        .or_else(|| result.get("Usages").and_then(|v| v.as_array()))
        .or_else(|| result.get("Details").and_then(|v| v.as_array()));
    let Some(arr) = arr else { return tiers };

    for item in arr {
        let label = item
            .get("Level")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("Type").and_then(|v| v.as_str()))
            .or_else(|| item.get("Period").and_then(|v| v.as_str()))
            .or_else(|| item.get("Label").and_then(|v| v.as_str()))
            .or_else(|| item.get("Window").and_then(|v| v.as_str()))
            .unwrap_or("");
        let Some(name) = volcengine_coding_window(label) else {
            continue;
        };
        let utilization = item
            .get("Percent")
            .and_then(parse_f64)
            .or_else(|| item.get("UsedPercent").and_then(parse_f64))
            .or_else(|| item.get("UsagePercent").and_then(parse_f64))
            .unwrap_or(0.0);
        let resets_at = item
            .get("ResetTime")
            .or_else(|| item.get("ResetTimestamp"))
            .and_then(extract_reset_time);
        tiers.push(QuotaTier {
            name: name.to_string(),
            utilization,
            resets_at,
            used_value_usd: None,
            max_value_usd: None,
        });
    }
    tiers
}

fn volcengine_success(tiers: Vec<QuotaTier>, plan: Option<String>) -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Valid,
        credential_message: plan,
        success: true,
        tiers,
        extra_usage: None,
        error: None,
        queried_at: Some(now_millis()),
    }
}

fn volcengine_auth_error(detail: String) -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::Expired,
        credential_message: Some("Invalid API key".to_string()),
        success: false,
        tiers: vec![],
        extra_usage: None,
        error: Some(detail),
        queried_at: Some(now_millis()),
    }
}

async fn query_volcengine(
    base_url: &str,
    access_key_id: &str,
    secret_access_key: &str,
) -> SubscriptionQuota {
    let region = volcengine_region(base_url);
    let mut soft_errors: Vec<String> = Vec::new();
    let mut empty_responses: Vec<String> = Vec::new();
    let summarize = |action: &str, body: &serde_json::Value| -> String {
        let raw: String = body.to_string().chars().take(700).collect();
        format!("{action}={raw}")
    };

    match volcengine_openapi_call(&region, access_key_id, secret_access_key, "GetAFPUsage").await {
        VolcCall::Auth(detail) => return volcengine_auth_error(detail),
        VolcCall::Soft(detail) => soft_errors.push(format!("GetAFPUsage: {detail}")),
        VolcCall::Body(body) => {
            let result = body.get("Result").unwrap_or(&body);
            let tiers = parse_afp_tiers(result);
            if !tiers.is_empty() {
                let plan = result
                    .get("PlanType")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|s| format!("Agent Plan {s}"));
                return volcengine_success(tiers, plan);
            }
            empty_responses.push(summarize("GetAFPUsage", &body));
        }
    }

    match volcengine_openapi_call(
        &region,
        access_key_id,
        secret_access_key,
        "GetCodingPlanUsage",
    )
    .await
    {
        VolcCall::Auth(detail) => return volcengine_auth_error(detail),
        VolcCall::Soft(detail) => soft_errors.push(format!("GetCodingPlanUsage: {detail}")),
        VolcCall::Body(body) => {
            let result = body.get("Result").unwrap_or(&body);
            let tiers = parse_coding_plan_tiers(result);
            if !tiers.is_empty() {
                return volcengine_success(tiers, Some("Coding Plan".to_string()));
            }
            empty_responses.push(summarize("GetCodingPlanUsage", &body));
        }
    }

    if !soft_errors.is_empty() {
        make_error(soft_errors.join("; "))
    } else if !empty_responses.is_empty() {
        make_error(format!(
            "No active subscription found (signature OK). Raw: {}",
            empty_responses.join(" || ")
        ))
    } else {
        make_error(
            "No active Agent Plan or Coding Plan subscription found for this credential"
                .to_string(),
        )
    }
}


fn coding_plan_not_found(error: &str) -> SubscriptionQuota {
    SubscriptionQuota {
        tool: "coding_plan".to_string(),
        credential_status: CredentialStatus::NotFound,
        credential_message: None,
        success: false,
        tiers: vec![],
        extra_usage: None,
        error: Some(error.to_string()),
        queried_at: None,
    }
}

pub async fn get_coding_plan_quota(
    base_url: &str,
    api_key: &str,
    access_key_id: Option<&str>,
    secret_access_key: Option<&str>,
) -> Result<SubscriptionQuota, String> {
    let provider = match detect_provider(base_url) {
        Some(p) => p,
        None => return Ok(coding_plan_not_found("Unknown coding plan provider")),
    };

    if let CodingPlanProvider::Volcengine = provider {
        let ak = access_key_id.unwrap_or("").trim();
        let sk = secret_access_key.unwrap_or("").trim();
        if ak.is_empty() || sk.is_empty() {
            return Ok(coding_plan_not_found(
                "Volcengine usage query needs the account AccessKey ID + Secret (not the inference API key)",
            ));
        }
        return Ok(query_volcengine(base_url, ak, sk).await);
    }

    if api_key.trim().is_empty() {
        return Ok(coding_plan_not_found("API key is empty"));
    }

    let quota = match provider {
        CodingPlanProvider::Kimi => query_kimi(api_key).await,
        CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => {
            query_zhipu(base_url, api_key).await
        }
        CodingPlanProvider::MiniMaxCn => query_minimax(api_key, true).await,
        CodingPlanProvider::MiniMaxEn => query_minimax(api_key, false).await,
        CodingPlanProvider::ZenMux => query_zenmux(base_url, api_key).await,
        CodingPlanProvider::Volcengine => {
            unreachable!("volcengine handled via AK/SK branch above")
        }
    };

    Ok(quota)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_afp_tiers, parse_coding_plan_tiers, parse_minimax_tiers, parse_zhipu_token_tiers,
        volcengine_canonical_query, volcengine_is_auth_error_code, volcengine_region,
        volcengine_response_error, volcengine_sign, zhipu_quota_base, TIER_FIVE_HOUR, TIER_MONTHLY,
        TIER_WEEKLY_LIMIT,
    };
    use serde_json::json;

    #[test]
    fn zhipu_new_plan_two_tiers_sorted_by_reset_time() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 53.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 44.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TIME_LIMIT",   "percentage":  7.0 },
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 44.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 53.0);
    }

    #[test]
    fn zhipu_old_plan_single_tier_falls_back_to_five_hour() {
        let data = json!({
            "limits": [
                {
                    "type": "TOKENS_LIMIT",
                    "percentage": 2.0,
                    "nextResetTime": 1_774_967_594_803_i64
                },
                { "type": "TIME_LIMIT", "percentage": 0.0 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 2.0);
    }

    #[test]
    fn zhipu_no_token_limits_returns_empty() {
        let data = json!({ "limits": [{ "type": "TIME_LIMIT", "percentage": 5.0 }] });
        assert!(parse_zhipu_token_tiers(&data).is_empty());
    }

    #[test]
    fn zhipu_missing_reset_time_is_five_hour_when_weekly_has_reset() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 25.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 0.0 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 0.0);
        assert!(tiers[0].resets_at.is_none());
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 25.0);
        assert!(tiers[1].resets_at.is_some());
    }

    #[test]
    fn zhipu_type_is_case_insensitive() {
        let data = json!({
            "limits": [
                { "type": "tokens_limit", "percentage": 12.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "Tokens_Limit", "percentage": 34.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 12.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 34.0);
    }

    #[test]
    fn zhipu_invalid_percentage_falls_back_to_zero() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": "invalid", "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": null,      "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 0.0);
        assert_eq!(tiers[1].utilization, 0.0);
    }

    #[test]
    fn zhipu_extreme_percentage_values_pass_through() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": -5.0,  "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 150.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, -5.0);
        assert_eq!(tiers[1].utilization, 150.0);
    }

    #[test]
    fn zhipu_unit_field_overrides_reset_order_when_weekly_resets_sooner() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "unit": 6, "number": 7, "percentage": 42.0, "nextResetTime": 1_000_003_600_000_i64 },
                { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 1.0,  "nextResetTime": 1_000_018_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 1.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 42.0);
    }

    #[test]
    fn zhipu_weekly_unit_six_number_one_variant() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 30.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 10.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 30.0);
    }

    #[test]
    fn zhipu_partial_unit_fields_fill_remaining_slot() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "unit": 6, "number": 7, "percentage": 42.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 1.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 1.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 42.0);
    }

    #[test]
    fn zhipu_unknown_unit_values_fall_back_to_reset_order() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "unit": 9, "percentage": 44.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "unit": 9, "percentage": 53.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 44.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 53.0);
    }

    #[test]
    fn zhipu_duplicate_unit_classification_fills_other_slot() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 20.0, "nextResetTime": 2_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 10.0);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 20.0);
    }

    #[test]
    fn zhipu_more_than_two_token_limits_keeps_first_two() {
        let data = json!({
            "limits": [
                { "type": "TOKENS_LIMIT", "percentage": 1.0, "nextResetTime": 1_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 2.0, "nextResetTime": 2_000_000_000_000_i64 },
                { "type": "TOKENS_LIMIT", "percentage": 3.0, "nextResetTime": 3_000_000_000_000_i64 }
            ]
        });
        let tiers = parse_zhipu_token_tiers(&data);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
    }

    // ── MiniMax ──

    #[test]
    fn minimax_general_two_tiers_from_remaining_percent() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 98.0,
                    "current_weekly_remaining_percent": 95.0,
                    "current_interval_status": 1,
                    "current_weekly_status": 1,
                    "end_time": 1_780_329_600_000_i64,
                    "weekly_end_time": 1_780_848_000_000_i64
                },
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100.0,
                    "current_weekly_remaining_percent": 100.0
                }
            ],
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 2.0);
        assert!(tiers[0].resets_at.is_some());
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert_eq!(tiers[1].utilization, 5.0);
        assert!(tiers[1].resets_at.is_some());
    }

    #[test]
    fn minimax_skips_video_and_finds_general_in_any_position() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 50.0,
                    "current_weekly_remaining_percent": 50.0
                },
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 80.0,
                    "current_weekly_remaining_percent": 70.0,
                    "current_interval_status": 1,
                    "current_weekly_status": 1
                }
            ]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 20.0);
        assert_eq!(tiers[1].utilization, 30.0);
    }

    #[test]
    fn minimax_missing_general_returns_empty() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100.0,
                    "current_weekly_remaining_percent": 100.0
                }
            ]
        });
        assert!(parse_minimax_tiers(&body).is_empty());

        let body_empty: serde_json::Value = json!({ "model_remains": [] });
        assert!(parse_minimax_tiers(&body_empty).is_empty());

        let body_no_field = json!({});
        assert!(parse_minimax_tiers(&body_no_field).is_empty());
    }

    #[test]
    fn minimax_missing_percent_fields_skips_tier() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 60.0,
                "current_weekly_status": 1
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 40.0);
    }

    #[test]
    fn minimax_negative_percent_passes_through() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": -5.0,
                "current_weekly_remaining_percent": 150.0,
                "current_interval_status": 1,
                "current_weekly_status": 1
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].utilization, 105.0); // 100 - (-5)
        assert_eq!(tiers[1].utilization, -50.0); // 100 - 150
    }

    #[test]
    fn minimax_weekly_status_3_skips_weekly_tier() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "general",
                    "start_time": 1_780_347_600_000_i64,
                    "end_time": 1_780_365_600_000_i64,
                    "remains_time": 4_161_372_i64,
                    "current_interval_remaining_percent": 99,
                    "current_interval_status": 1,
                    "current_weekly_total_count": 0,
                    "current_weekly_usage_count": 0,
                    "weekly_start_time": 1_780_243_200_000_i64,
                    "weekly_end_time": 1_780_848_000_000_i64,
                    "weekly_remains_time": 486_561_372_i64,
                    "current_weekly_status": 3,
                    "current_weekly_remaining_percent": 100
                },
                {
                    "model_name": "video",
                    "current_interval_remaining_percent": 100,
                    "current_weekly_status": 3,
                    "current_weekly_remaining_percent": 100
                }
            ],
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 1.0);
        assert!(tiers[0].resets_at.is_some());
    }

    #[test]
    fn minimax_weekly_status_2_also_skips_weekly_tier() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 80.0,
                "current_weekly_remaining_percent": 50.0,
                "current_weekly_status": 2
            }]
        });
        let tiers = parse_minimax_tiers(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert_eq!(tiers[0].utilization, 20.0);
    }

    #[test]
    fn zhipu_quota_base_routes_bigmodel_url_to_cn_endpoint() {
        assert_eq!(
            zhipu_quota_base("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn"
        );
    }

    #[test]
    fn zhipu_quota_base_routes_z_ai_url_to_en_endpoint() {
        assert_eq!(
            zhipu_quota_base("https://api.z.ai/api/paas/v4"),
            "https://api.z.ai"
        );
    }

    #[test]
    fn zhipu_quota_base_defaults_to_en_for_unknown_url() {
        assert_eq!(
            zhipu_quota_base("https://example.com/zhipu"),
            "https://api.z.ai"
        );
    }

    #[test]
    fn zhipu_quota_base_routes_uppercase_cn_url_to_cn_endpoint() {
        assert_eq!(
            zhipu_quota_base("HTTPS://OPEN.BIGMODEL.CN/api/paas/v4"),
            "https://open.bigmodel.cn"
        );
        assert_eq!(
            zhipu_quota_base("https://Open.BigModel.cn/api/paas/v4"),
            "https://open.bigmodel.cn"
        );
    }


    #[test]
    fn volcengine_afp_three_windows_from_official_example() {
        let result = json!({
            "PlanType": "Large",
            "AFPFiveHour": { "Quota": 50.0,   "Used": 12.5,  "SubscribeTime": 1778788800000_i64, "ResetTime": 1778806800000_i64 },
            "AFPDaily":    { "Quota": 100.0,  "Used": 22.5,  "SubscribeTime": 1778716800000_i64, "ResetTime": 1778803200000_i64 },
            "AFPWeekly":   { "Quota": 500.0,  "Used": 150.0, "SubscribeTime": 1778457600000_i64, "ResetTime": 1779062400000_i64 },
            "AFPMonthly":  { "Quota": 2000.0, "Used": 850.5, "SubscribeTime": 1777939200000_i64, "ResetTime": 1780531200000_i64 }
        });
        let tiers = parse_afp_tiers(&result);
        assert_eq!(tiers.len(), 3, "daily  5h//");
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert!((tiers[0].utilization - 25.0).abs() < 1e-9);
        assert!(tiers[0].resets_at.is_some());
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert!((tiers[1].utilization - 30.0).abs() < 1e-9);
        assert_eq!(tiers[2].name, TIER_MONTHLY);
        assert!((tiers[2].utilization - 42.525).abs() < 1e-9);
        assert!(tiers[2].resets_at.is_some());
    }

    #[test]
    fn volcengine_afp_zero_quota_windows_treated_as_unbound() {
        let result = json!({
            "PlanType": "",
            "AFPFiveHour": { "Quota": 0.0, "Used": 0.0 },
            "AFPWeekly":   { "Quota": 0.0, "Used": 0.0 },
            "AFPMonthly":  { "Quota": 0.0, "Used": 0.0 }
        });
        assert!(parse_afp_tiers(&result).is_empty());
    }

    #[test]
    fn volcengine_afp_partial_windows_only_subscribed_ones() {
        let result = json!({
            "AFPFiveHour": { "Quota": 40.0, "Used": 10.0, "ResetTime": 1778806800000_i64 },
            "AFPWeekly":   { "Quota": 0.0,  "Used": 0.0 }
        });
        let tiers = parse_afp_tiers(&result);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert!((tiers[0].utilization - 25.0).abs() < 1e-9);
    }

    #[test]
    fn volcengine_coding_plan_real_response_levels() {
        let result = json!({
            "Status": "Running",
            "UpdateTimestamp": 1782053286_i64,
            "QuotaUsage": [
                { "Level": "session", "Percent": 0.0,      "ResetTimestamp": -1_i64 },
                { "Level": "weekly",  "Percent": 1.672568, "ResetTimestamp": 1782057600_i64 },
                { "Level": "monthly", "Percent": 0.836284, "ResetTimestamp": 1784303999_i64 }
            ]
        });
        let tiers = parse_coding_plan_tiers(&result);
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0].name, TIER_FIVE_HOUR);
        assert!((tiers[0].utilization - 0.0).abs() < 1e-9);
        assert!(
            tiers[0].resets_at.is_none(),
            "session ResetTimestamp=-1 "
        );
        assert_eq!(tiers[1].name, TIER_WEEKLY_LIMIT);
        assert!((tiers[1].utilization - 1.672568).abs() < 1e-6);
        assert!(tiers[1].resets_at.is_some());
        assert_eq!(tiers[2].name, TIER_MONTHLY);
        assert!((tiers[2].utilization - 0.836284).abs() < 1e-6);
    }

    #[test]
    fn volcengine_coding_plan_unknown_window_skipped_and_missing_array_empty() {
        let result = json!({
            "QuotaUsage": [
                { "Level": "daily", "Percent": 9.0 },
                { "Level": "weekly", "Percent": 20.0 }
            ]
        });
        let tiers = parse_coding_plan_tiers(&result);
        assert_eq!(tiers.len(), 1, " daily ");
        assert_eq!(tiers[0].name, TIER_WEEKLY_LIMIT);

        assert!(parse_coding_plan_tiers(&json!({})).is_empty());
    }

    #[test]
    fn volcengine_region_derivation() {
        assert_eq!(
            volcengine_region("https://ark.cn-beijing.volces.com/api/coding"),
            "cn-beijing"
        );
        assert_eq!(
            volcengine_region("https://ark.cn-shanghai.volces.com/api/coding/v3"),
            "cn-shanghai"
        );
        assert_eq!(
            volcengine_region("https://example.com/api/coding"),
            "cn-beijing"
        );
    }

    #[test]
    fn volcengine_canonical_query_is_sorted_and_encoded() {
        assert_eq!(
            volcengine_canonical_query("GetAFPUsage", "cn-beijing"),
            "Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01"
        );
    }

    #[test]
    fn volcengine_sign_structure_and_determinism() {
        let now = chrono::DateTime::parse_from_rfc3339("2024-06-21T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let region = "cn-beijing";
        let query = volcengine_canonical_query("GetAFPUsage", region);
        let (auth, x_date, x_content) =
            volcengine_sign("AKLTtest", "secretkey", region, &query, b"", now);

        assert_eq!(
            x_content,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(x_date, "20240621T000000Z");
        assert!(
            auth.starts_with("HMAC-SHA256 Credential=AKLTtest/20240621/cn-beijing/ark/request,"),
            "unexpected credential/scope: {auth}"
        );
        assert!(
            auth.contains("SignedHeaders=host;x-date;x-content-sha256;content-type,"),
            "unexpected signed headers: {auth}"
        );
        let sig = auth.rsplit("Signature=").next().unwrap();
        assert_eq!(sig.len(), 64);
        assert!(sig.bytes().all(|b| b.is_ascii_hexdigit()));

        let (auth2, _, _) = volcengine_sign("AKLTtest", "secretkey", region, &query, b"", now);
        assert_eq!(auth, auth2);
    }

    #[test]
    fn volcengine_auth_error_code_detection_and_extraction() {
        assert!(volcengine_is_auth_error_code("AccessDenied"));
        assert!(volcengine_is_auth_error_code("SignatureDoesNotMatch"));
        assert!(volcengine_is_auth_error_code("InvalidAuthorization"));
        assert!(volcengine_is_auth_error_code("Unauthorized"));
        assert!(!volcengine_is_auth_error_code("InvalidParameter.Action"));
        assert!(!volcengine_is_auth_error_code("InternalError"));

        let body = json!({
            "ResponseMetadata": { "RequestId": "x", "Error": { "Code": "AccessDenied", "Message": "no permission" } }
        });
        let (code, msg) = volcengine_response_error(&body).expect(" Error");
        assert_eq!(code, "AccessDenied");
        assert_eq!(msg, "no permission");

        let ok_body = json!({ "ResponseMetadata": { "RequestId": "x" }, "Result": {} });
        assert!(volcengine_response_error(&ok_body).is_none());
    }
}
