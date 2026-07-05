//!

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SESSION_REQUEST_ID_PREFIX: &str = "session:";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub model: Option<String>,
    ///
    #[serde(skip)]
    pub message_id: Option<String>,
}

impl TokenUsage {
    pub fn dedup_request_id(&self) -> String {
        self.message_id
            .as_ref()
            .map(|mid| format!("{SESSION_REQUEST_ID_PREFIX}{mid}"))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    }

    ///
    pub fn has_billable_tokens(&self) -> bool {
        self.input_tokens > 0
            || self.output_tokens > 0
            || self.cache_read_tokens > 0
            || self.cache_creation_tokens > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ApiType {
    Claude,
    OpenRouter,
    Codex,
    Gemini,
}

impl TokenUsage {
    pub fn from_claude_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        let model = body
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let message_id = body
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some(Self {
            input_tokens: usage.get("input_tokens")?.as_u64()? as u32,
            output_tokens: usage.get("output_tokens")?.as_u64()? as u32,
            cache_read_tokens: usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            model,
            message_id,
        })
    }

    #[allow(dead_code)]
    pub fn from_claude_stream_events(events: &[Value]) -> Option<Self> {
        let mut usage = Self::default();
        let mut model: Option<String> = None;
        let mut message_id: Option<String> = None;
        let mut input_from_delta = false;

        for event in events {
            if let Some(event_type) = event.get("type").and_then(|v| v.as_str()) {
                match event_type {
                    "message_start" => {
                        if let Some(message) = event.get("message") {
                            if model.is_none() {
                                if let Some(m) = message.get("model").and_then(|v| v.as_str()) {
                                    model = Some(m.to_string());
                                }
                            }
                            if message_id.is_none() {
                                if let Some(id) = message.get("id").and_then(|v| v.as_str()) {
                                    message_id = Some(id.to_string());
                                }
                            }
                        }
                        if let Some(msg_usage) = event.get("message").and_then(|m| m.get("usage")) {
                            if let Some(input) =
                                msg_usage.get("input_tokens").and_then(|v| v.as_u64())
                            {
                                usage.input_tokens = input as u32;
                            }
                            usage.cache_read_tokens = msg_usage
                                .get("cache_read_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0)
                                as u32;
                            usage.cache_creation_tokens = msg_usage
                                .get("cache_creation_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0)
                                as u32;
                        }
                    }
                    "message_delta" => {
                        if let Some(delta_usage) = event.get("usage") {
                            if let Some(output) =
                                delta_usage.get("output_tokens").and_then(|v| v.as_u64())
                            {
                                usage.output_tokens = output as u32;
                            }

                            let delta_input = delta_usage
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as u32);
                            let delta_cache_read = delta_usage
                                .get("cache_read_input_tokens")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as u32);
                            let delta_cache_creation = delta_usage
                                .get("cache_creation_input_tokens")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as u32);

                            if let Some(input) = delta_input {
                                let should_use_delta_input = input > 0
                                    && (usage.input_tokens == 0
                                        || input < usage.input_tokens
                                        || (input_from_delta && input <= usage.input_tokens));

                                if should_use_delta_input {
                                    usage.input_tokens = input;
                                    input_from_delta = true;
                                    if let Some(cache_read) = delta_cache_read {
                                        usage.cache_read_tokens = cache_read;
                                    }
                                    if let Some(cache_creation) = delta_cache_creation {
                                        usage.cache_creation_tokens = cache_creation;
                                    }
                                }
                            }
                            if usage.cache_read_tokens == 0 {
                                if let Some(cache_read) = delta_cache_read {
                                    usage.cache_read_tokens = cache_read;
                                }
                            }
                            if usage.cache_creation_tokens == 0 {
                                if let Some(cache_creation) = delta_cache_creation {
                                    usage.cache_creation_tokens = cache_creation;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        if usage.has_billable_tokens() {
            usage.model = model;
            usage.message_id = message_id;
            Some(usage)
        } else {
            None
        }
    }

    #[allow(dead_code)]
    pub fn from_openrouter_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        Some(Self {
            input_tokens: usage.get("prompt_tokens")?.as_u64()? as u32,
            output_tokens: usage.get("completion_tokens")?.as_u64()? as u32,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            model: None,
            message_id: None,
        })
    }

    pub fn from_codex_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage");
        if usage.is_none() {
            log::debug!(
                "[Codex]  usage body keys: {:?}",
                body.as_object().map(|o| o.keys().collect::<Vec<_>>())
            );
            return None;
        }
        let usage = usage?;

        let input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64());
        let output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64());

        if input_tokens.is_none() || output_tokens.is_none() {
            log::debug!("[Codex] usage Missing input_tokens  output_tokensusage: {usage:?}");
            return None;
        }

        let model = body
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let cached_tokens = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                usage
                    .get("input_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0) as u32;

        Some(Self {
            input_tokens: input_tokens? as u32,
            output_tokens: output_tokens? as u32,
            cache_read_tokens: cached_tokens,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            model,
            message_id: None,
        })
    }

    ///
    #[allow(dead_code)]
    pub fn from_codex_response_adjusted(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;
        let input_tokens = usage.get("input_tokens")?.as_u64()? as u32;
        let output_tokens = usage.get("output_tokens")?.as_u64()? as u32;

        let cached_tokens = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                usage
                    .get("input_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0) as u32;

        let adjusted_input = input_tokens.saturating_sub(cached_tokens);

        let model = body
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some(Self {
            input_tokens: adjusted_input,
            output_tokens,
            cache_read_tokens: cached_tokens,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            model,
            message_id: None,
        })
    }

    #[allow(dead_code)]
    pub fn from_codex_stream_events(events: &[Value]) -> Option<Self> {
        log::debug!("[Codex] Parse {} ", events.len());
        for event in events {
            if let Some(event_type) = event.get("type").and_then(|v| v.as_str()) {
                log::debug!("[Codex] : {event_type}");
                if event_type == "response.completed" {
                    if let Some(response) = event.get("response") {
                        log::debug!("[Codex]  response.completed Parse usage");
                        return Self::from_codex_response_adjusted(response);
                    }
                }
            }
        }
        log::debug!("[Codex]  response.completed ");
        None
    }

    ///
    ///
    pub fn from_codex_response_auto(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;

        if usage.get("prompt_tokens").is_some() {
            log::debug!("[Codex]  OpenAI  (prompt_tokens)");
            Self::from_openai_response(body)
        } else if usage.get("input_tokens").is_some() {
            log::debug!("[Codex]  Codex  (input_tokens)");
            Self::from_codex_response(body)
        } else {
            log::debug!("[Codex] usage: {usage:?}");
            None
        }
    }

    pub fn from_codex_stream_events_auto(events: &[Value]) -> Option<Self> {
        log::debug!("[Codex] Parse {} ", events.len());

        for event in events {
            if let Some(event_type) = event.get("type").and_then(|v| v.as_str()) {
                if event_type == "response.completed" {
                    if let Some(response) = event.get("response") {
                        log::debug!("[Codex]  response.completed ");
                        return Self::from_codex_response_auto(response);
                    }
                }
            }
        }

        log::debug!("[Codex]  OpenAI ");
        Self::from_openai_stream_events(events)
    }

    pub fn from_openai_response(body: &Value) -> Option<Self> {
        let usage = body.get("usage")?;

        let prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_u64())?;
        let completion_tokens = usage.get("completion_tokens").and_then(|v| v.as_u64())?;

        let cached_tokens = usage
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let model = body
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Some(Self {
            input_tokens: prompt_tokens as u32,
            output_tokens: completion_tokens as u32,
            cache_read_tokens: cached_tokens,
            cache_creation_tokens: 0,
            model,
            message_id: None,
        })
    }

    pub fn from_openai_stream_events(events: &[Value]) -> Option<Self> {
        log::debug!("[Codex] Parse OpenAI  {} ", events.len());
        for event in events.iter().rev() {
            if let Some(usage) = event.get("usage") {
                if !usage.is_null() {
                    log::debug!("[Codex]  usage: {usage:?}");
                    return Self::from_openai_response(event);
                }
            }
        }
        log::debug!("[Codex]  usage ");
        None
    }

    pub fn from_gemini_response(body: &Value) -> Option<Self> {
        let usage = body.get("usageMetadata")?;
        let model = body
            .get("modelVersion")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let prompt_tokens = usage.get("promptTokenCount")?.as_u64()? as u32;
        let total_tokens = usage.get("totalTokenCount")?.as_u64()? as u32;

        let output_tokens = total_tokens.saturating_sub(prompt_tokens);

        Some(Self {
            input_tokens: prompt_tokens,
            output_tokens,
            cache_read_tokens: usage
                .get("cachedContentTokenCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: 0,
            model,
            message_id: None,
        })
    }

    #[allow(dead_code)]
    pub fn from_gemini_stream_chunks(chunks: &[Value]) -> Option<Self> {
        let mut total_input = 0u32;
        let mut total_tokens = 0u32;
        let mut total_cache_read = 0u32;
        let mut model: Option<String> = None;

        for chunk in chunks {
            if let Some(usage) = chunk.get("usageMetadata") {
                total_input = usage
                    .get("promptTokenCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;

                total_tokens = usage
                    .get("totalTokenCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;

                total_cache_read = usage
                    .get("cachedContentTokenCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
            }

            if model.is_none() {
                if let Some(model_version) = chunk.get("modelVersion").and_then(|v| v.as_str()) {
                    model = Some(model_version.to_string());
                }
            }
        }

        let total_output = total_tokens.saturating_sub(total_input);

        if total_input > 0 || total_output > 0 {
            Some(Self {
                input_tokens: total_input,
                output_tokens: total_output,
                cache_read_tokens: total_cache_read,
                cache_creation_tokens: 0,
                model,
                message_id: None,
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_claude_response_parsing() {
        let response = json!({
            "model": "claude-sonnet-4-20250514",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 20,
                "cache_creation_input_tokens": 10
            }
        });

        let usage = TokenUsage::from_claude_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 10);
        assert_eq!(usage.model, Some("claude-sonnet-4-20250514".to_string()));
    }

    #[test]
    fn test_has_billable_tokens_gates_empty_usage() {
        assert!(!TokenUsage::default().has_billable_tokens());
        let only_cache = TokenUsage {
            cache_read_tokens: 100,
            ..Default::default()
        };
        assert!(only_cache.has_billable_tokens());
        let normal = TokenUsage {
            input_tokens: 10,
            output_tokens: 5,
            ..Default::default()
        };
        assert!(normal.has_billable_tokens());
    }

    #[test]
    fn test_claude_stream_cache_only_request_is_recorded() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "id": "msg_cacheonly",
                    "model": "claude-opus-4-8",
                    "usage": {
                        "input_tokens": 0,
                        "cache_read_input_tokens": 50000,
                        "cache_creation_input_tokens": 0
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": { "output_tokens": 0 }
            }),
        ];
        let usage = TokenUsage::from_claude_stream_events(&events)
            .expect("cache-only  input/output gate ");
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_read_tokens, 50000);
        assert_eq!(usage.message_id, Some("msg_cacheonly".to_string()));
    }

    #[test]
    fn test_codex_response_auto_returns_some_for_synthetic_all_zero() {
        let synthetic = json!({
            "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 }
        });
        let usage = TokenUsage::from_codex_response_auto(&synthetic)
            .expect(" 0 usage  from_codex_response_auto  Some");
        assert!(
            !usage.has_billable_tokens(),
            " 0 usage  has_billable_tokens  handlers "
        );
    }

    #[test]
    fn test_claude_response_parsing_no_model() {
        let response = json!({
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 20,
                "cache_creation_input_tokens": 10
            }
        });

        let usage = TokenUsage::from_claude_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 10);
        assert_eq!(usage.model, None);
    }

    #[test]
    fn test_claude_stream_parsing() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "claude-sonnet-4-20250514",
                    "usage": {
                        "input_tokens": 100,
                        "cache_read_input_tokens": 20,
                        "cache_creation_input_tokens": 10
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "output_tokens": 50
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 10);
        assert_eq!(usage.model, Some("claude-sonnet-4-20250514".to_string()));
    }

    #[test]
    fn test_claude_stream_parsing_no_model() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "usage": {
                        "input_tokens": 100,
                        "cache_read_input_tokens": 20,
                        "cache_creation_input_tokens": 10
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "output_tokens": 50
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 10);
        assert_eq!(usage.model, None);
    }

    #[test]
    fn test_openrouter_response_parsing() {
        let response = json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50
            }
        });

        let usage = TokenUsage::from_openrouter_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_creation_tokens, 0);
    }

    #[test]
    fn test_gemini_response_parsing() {
        let response = json!({
            "modelVersion": "gemini-3-pro-high",
            "usageMetadata": {
                "promptTokenCount": 8383,
                "candidatesTokenCount": 50,
                "thoughtsTokenCount": 114,
                "totalTokenCount": 8547,
                "cachedContentTokenCount": 20
            }
        });

        let usage = TokenUsage::from_gemini_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 8383);
        // output_tokens = totalTokenCount - promptTokenCount = 8547 - 8383 = 164
        assert_eq!(usage.output_tokens, 164);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 0);
        assert_eq!(usage.model, Some("gemini-3-pro-high".to_string()));
    }

    #[test]
    fn test_gemini_response_parsing_no_model() {
        let response = json!({
            "usageMetadata": {
                "promptTokenCount": 100,
                "totalTokenCount": 150,
                "cachedContentTokenCount": 20
            }
        });

        let usage = TokenUsage::from_gemini_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 100);
        // output_tokens = totalTokenCount - promptTokenCount = 150 - 100 = 50
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 20);
        assert_eq!(usage.cache_creation_tokens, 0);
        assert_eq!(usage.model, None);
    }

    #[test]
    fn test_gemini_response_with_thoughts() {
        let response = json!({
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": "",
                                "thoughtSignature": "EvcECvQE..."
                            }
                        ],
                        "role": "model"
                    },
                    "finishReason": "STOP"
                }
            ],
            "modelVersion": "gemini-3-pro-high",
            "responseId": "yupTafqLDu-PjMcPhrOx4QQ",
            "usageMetadata": {
                "candidatesTokenCount": 50,
                "promptTokenCount": 8383,
                "thoughtsTokenCount": 114,
                "totalTokenCount": 8547
            }
        });

        let usage = TokenUsage::from_gemini_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 8383);
        // output_tokens = totalTokenCount - promptTokenCount
        assert_eq!(usage.output_tokens, 164);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_creation_tokens, 0);
        assert_eq!(usage.model, Some("gemini-3-pro-high".to_string()));
    }

    #[test]
    fn test_codex_response_parsing_cached_tokens_in_details() {
        let response = json!({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "input_tokens_details": {
                    "cached_tokens": 300
                }
            }
        });

        let usage = TokenUsage::from_codex_response(&response).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 300);
    }

    #[test]
    fn test_codex_response_adjusted() {
        let response = json!({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "input_tokens_details": {
                    "cached_tokens": 300
                }
            }
        });

        let usage = TokenUsage::from_codex_response_adjusted(&response).unwrap();
        assert_eq!(usage.input_tokens, 700);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 300);
    }

    #[test]
    fn test_codex_response_adjusted_no_cache() {
        let response = json!({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500
            }
        });

        let usage = TokenUsage::from_codex_response_adjusted(&response).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 0);
    }

    #[test]
    fn test_codex_response_adjusted_cache_read_input_tokens() {
        let response = json!({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_read_input_tokens": 200
            }
        });

        let usage = TokenUsage::from_codex_response_adjusted(&response).unwrap();
        assert_eq!(usage.input_tokens, 800);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 200);
    }

    #[test]
    fn test_codex_response_adjusted_saturating_sub() {
        let response = json!({
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "input_tokens_details": {
                    "cached_tokens": 200
                }
            }
        });

        let usage = TokenUsage::from_codex_response_adjusted(&response).unwrap();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.cache_read_tokens, 200);
    }

    #[test]
    fn test_openrouter_stream_parsing() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "claude-sonnet-4-20250514",
                    "usage": {
                        "input_tokens": 0,
                        "output_tokens": 0
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": "end_turn"
                },
                "usage": {
                    "input_tokens": 150,
                    "output_tokens": 75
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 150);
        assert_eq!(usage.output_tokens, 75);
        assert_eq!(usage.model, Some("claude-sonnet-4-20250514".to_string()));
    }

    #[test]
    fn test_claude_stream_prefers_smaller_delta_input_and_cache_pair() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "qwen-max",
                    "usage": {
                        "input_tokens": 200_000,
                        "cache_read_input_tokens": 180_000,
                        "cache_creation_input_tokens": 2_000
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "input_tokens": 80_000,
                    "output_tokens": 1_000,
                    "cache_read_input_tokens": 120_000,
                    "cache_creation_input_tokens": 500
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 80_000);
        assert_eq!(usage.output_tokens, 1_000);
        assert_eq!(usage.cache_read_tokens, 120_000);
        assert_eq!(usage.cache_creation_tokens, 500);
        assert_eq!(usage.model, Some("qwen-max".to_string()));
    }

    #[test]
    fn test_claude_stream_updates_cache_pair_from_later_delta_input() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "qwen-max",
                    "usage": {
                        "input_tokens": 200_000,
                        "cache_read_input_tokens": 180_000,
                        "cache_creation_input_tokens": 2_000
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "input_tokens": 80_000,
                    "output_tokens": 100,
                    "cache_read_input_tokens": 110_000,
                    "cache_creation_input_tokens": 300
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "input_tokens": 80_000,
                    "output_tokens": 1_000,
                    "cache_read_input_tokens": 120_000,
                    "cache_creation_input_tokens": 500
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 80_000);
        assert_eq!(usage.output_tokens, 1_000);
        assert_eq!(usage.cache_read_tokens, 120_000);
        assert_eq!(usage.cache_creation_tokens, 500);
        assert_eq!(usage.model, Some("qwen-max".to_string()));
    }

    #[test]
    fn test_claude_stream_keeps_start_when_delta_input_is_larger() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "usage": {
                        "input_tokens": 100,
                        "cache_read_input_tokens": 20
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "input_tokens": 150,
                    "output_tokens": 75,
                    "cache_read_input_tokens": 30
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 75);
        assert_eq!(usage.cache_read_tokens, 20);
    }

    #[test]
    fn test_native_claude_stream_parsing() {
        let events = vec![
            json!({
                "type": "message_start",
                "message": {
                    "model": "claude-sonnet-4-20250514",
                    "usage": {
                        "input_tokens": 200,
                        "cache_read_input_tokens": 50
                    }
                }
            }),
            json!({
                "type": "message_delta",
                "usage": {
                    "output_tokens": 100
                }
            }),
        ];

        let usage = TokenUsage::from_claude_stream_events(&events).unwrap();
        assert_eq!(usage.input_tokens, 200);
        assert_eq!(usage.output_tokens, 100);
        assert_eq!(usage.cache_read_tokens, 50);
        assert_eq!(usage.model, Some("claude-sonnet-4-20250514".to_string()));
    }

    // ============================================================================
    // ============================================================================

    #[test]
    fn test_codex_response_auto_openai_format() {
        let response = json!({
            "model": "gpt-4o",
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 500,
                "prompt_tokens_details": {
                    "cached_tokens": 200
                }
            }
        });

        let usage = TokenUsage::from_codex_response_auto(&response).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 200);
        assert_eq!(usage.model, Some("gpt-4o".to_string()));
    }

    #[test]
    fn test_codex_response_auto_codex_format() {
        let response = json!({
            "model": "o3",
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "input_tokens_details": {
                    "cached_tokens": 300
                }
            }
        });

        let usage = TokenUsage::from_codex_response_auto(&response).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 300);
        assert_eq!(usage.model, Some("o3".to_string()));
    }

    #[test]
    fn test_codex_stream_events_auto_codex_format() {
        let events = vec![
            json!({
                "type": "response.created",
                "response": {
                    "id": "resp_123"
                }
            }),
            json!({
                "type": "response.completed",
                "response": {
                    "model": "o3",
                    "usage": {
                        "input_tokens": 1000,
                        "output_tokens": 500,
                        "input_tokens_details": {
                            "cached_tokens": 200
                        }
                    }
                }
            }),
        ];

        let usage = TokenUsage::from_codex_stream_events_auto(&events).unwrap();
        assert_eq!(usage.input_tokens, 1000);
        assert_eq!(usage.output_tokens, 500);
        assert_eq!(usage.cache_read_tokens, 200);
        assert_eq!(usage.model, Some("o3".to_string()));
    }

    #[test]
    fn test_codex_stream_events_auto_openai_format() {
        let events = vec![
            json!({
                "id": "chatcmpl-123",
                "model": "gpt-4o",
                "choices": [{"delta": {"content": "Hello"}}]
            }),
            json!({
                "id": "chatcmpl-123",
                "model": "gpt-4o",
                "choices": [{"delta": {}}],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50
                }
            }),
        ];

        let usage = TokenUsage::from_codex_stream_events_auto(&events).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.model, Some("gpt-4o".to_string()));
    }
}
