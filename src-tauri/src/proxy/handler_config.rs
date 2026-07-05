//!

use crate::app_config::AppType;
use crate::proxy::usage::parser::TokenUsage;
use serde_json::Value;

pub type StreamUsageParser = fn(&[Value]) -> Option<TokenUsage>;
pub type ResponseUsageParser = fn(&Value) -> Option<TokenUsage>;

pub type StreamModelExtractor = fn(&[Value], &str) -> String;

///
pub type StreamUsageEventFilter = fn(&str) -> bool;

#[derive(Clone, Copy)]
pub struct UsageParserConfig {
    pub stream_parser: StreamUsageParser,
    pub response_parser: ResponseUsageParser,
    pub model_extractor: StreamModelExtractor,
    pub stream_event_filter: Option<StreamUsageEventFilter>,
    pub app_type_str: &'static str,
}

// ============================================================================
// ============================================================================

pub fn claude_stream_usage_event_filter(data: &str) -> bool {
    data.contains("\"message_start\"") || data.contains("\"message_delta\"")
}

fn openai_stream_usage_event_filter(data: &str) -> bool {
    data.contains("\"usage\"")
}

pub fn codex_stream_usage_event_filter(data: &str) -> bool {
    data.contains("\"response.completed\"") || data.contains("\"usage\"")
}

fn gemini_stream_usage_event_filter(data: &str) -> bool {
    data.contains("\"usageMetadata\"")
}

// ============================================================================
// ============================================================================

///
fn claude_model_extractor(events: &[Value], fallback_model: &str) -> String {
    if let Some(usage) = TokenUsage::from_claude_stream_events(events) {
        if let Some(model) = usage.model.filter(|m| !m.is_empty()) {
            return model;
        }
    }
    fallback_model.to_string()
}

fn openai_model_extractor(events: &[Value], fallback_model: &str) -> String {
    if let Some(usage) = TokenUsage::from_openai_stream_events(events) {
        if let Some(model) = usage.model.filter(|m| !m.is_empty()) {
            return model;
        }
    }
    events
        .iter()
        .find_map(|e| e.get("model")?.as_str().filter(|m| !m.is_empty()))
        .unwrap_or(fallback_model)
        .to_string()
}

fn codex_auto_model_extractor(events: &[Value], fallback_model: &str) -> String {
    if let Some(usage) = TokenUsage::from_codex_stream_events_auto(events) {
        if let Some(model) = usage.model.filter(|m| !m.is_empty()) {
            return model;
        }
    }
    events
        .iter()
        .find_map(|e| {
            if e.get("type")?.as_str()? == "response.completed" {
                e.get("response")?
                    .get("model")?
                    .as_str()
                    .filter(|m| !m.is_empty())
            } else {
                None
            }
        })
        .or_else(|| {
            events
                .iter()
                .find_map(|e| e.get("model")?.as_str().filter(|m| !m.is_empty()))
        })
        .unwrap_or(fallback_model)
        .to_string()
}

fn gemini_model_extractor(events: &[Value], fallback_model: &str) -> String {
    if let Some(usage) = TokenUsage::from_gemini_stream_chunks(events) {
        if let Some(model) = usage.model.filter(|m| !m.is_empty()) {
            return model;
        }
    }
    fallback_model.to_string()
}

// ============================================================================
// ============================================================================

pub const CLAUDE_PARSER_CONFIG: UsageParserConfig = UsageParserConfig {
    stream_parser: TokenUsage::from_claude_stream_events,
    response_parser: TokenUsage::from_claude_response,
    model_extractor: claude_model_extractor,
    stream_event_filter: Some(claude_stream_usage_event_filter),
    app_type_str: "claude",
};

pub const OPENAI_PARSER_CONFIG: UsageParserConfig = UsageParserConfig {
    stream_parser: TokenUsage::from_openai_stream_events,
    response_parser: TokenUsage::from_openai_response,
    model_extractor: openai_model_extractor,
    stream_event_filter: Some(openai_stream_usage_event_filter),
    app_type_str: "codex",
};

pub const CODEX_PARSER_CONFIG: UsageParserConfig = UsageParserConfig {
    stream_parser: TokenUsage::from_codex_stream_events_auto,
    response_parser: TokenUsage::from_codex_response_auto,
    model_extractor: codex_auto_model_extractor,
    stream_event_filter: Some(codex_stream_usage_event_filter),
    app_type_str: "codex",
};

pub const GEMINI_PARSER_CONFIG: UsageParserConfig = UsageParserConfig {
    stream_parser: TokenUsage::from_gemini_stream_chunks,
    response_parser: TokenUsage::from_gemini_response,
    model_extractor: gemini_model_extractor,
    stream_event_filter: Some(gemini_stream_usage_event_filter),
    app_type_str: "gemini",
};

// ============================================================================
// ============================================================================

///
#[allow(dead_code)]
#[derive(Clone)]
pub struct HandlerConfig {
    pub app_type: AppType,
    pub tag: &'static str,
    pub app_type_str: &'static str,
    pub parser_config: &'static UsageParserConfig,
}

#[allow(dead_code)]
pub const CLAUDE_HANDLER_CONFIG: HandlerConfig = HandlerConfig {
    app_type: AppType::Claude,
    tag: "Claude",
    app_type_str: "claude",
    parser_config: &CLAUDE_PARSER_CONFIG,
};

#[allow(dead_code)]
pub const CODEX_CHAT_HANDLER_CONFIG: HandlerConfig = HandlerConfig {
    app_type: AppType::Codex,
    tag: "Codex",
    app_type_str: "codex",
    parser_config: &OPENAI_PARSER_CONFIG,
};

#[allow(dead_code)]
pub const CODEX_RESPONSES_HANDLER_CONFIG: HandlerConfig = HandlerConfig {
    app_type: AppType::Codex,
    tag: "Codex",
    app_type_str: "codex",
    parser_config: &CODEX_PARSER_CONFIG,
};

#[allow(dead_code)]
pub const GEMINI_HANDLER_CONFIG: HandlerConfig = HandlerConfig {
    app_type: AppType::Gemini,
    tag: "Gemini",
    app_type_str: "gemini",
    parser_config: &GEMINI_PARSER_CONFIG,
};
