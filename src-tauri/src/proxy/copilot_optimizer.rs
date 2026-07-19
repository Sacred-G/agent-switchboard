//!
//!
//!

use std::collections::HashSet;

use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CopilotClassification {
    pub initiator: &'static str,
    pub is_warmup: bool,
    pub is_compact: bool,
    pub is_subagent: bool,
}

///
///
///
///
pub fn classify_request(
    body: &Value,
    has_anthropic_beta: bool,
    compact_detection: bool,
    subagent_detection: bool,
) -> CopilotClassification {
    let is_compact = compact_detection && is_compact_request(body);
    let is_subagent = subagent_detection && detect_subagent(body);

    let messages = match body.get("messages").and_then(|m| m.as_array()) {
        Some(msgs) if !msgs.is_empty() => msgs,
        _ => {
            return CopilotClassification {
                initiator: "user",
                is_warmup: is_warmup_request(body, has_anthropic_beta, false),
                is_compact: false,
                is_subagent,
            }
        }
    };

    let last_msg = &messages[messages.len() - 1];
    let role = last_msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

    if role != "user" {
        return CopilotClassification {
            initiator: if is_subagent { "agent" } else { "user" },
            is_warmup: false,
            is_compact,
            is_subagent,
        };
    }

    let is_user_initiated = match last_msg.get("content") {
        Some(Value::Array(blocks)) => !blocks
            .iter()
            .any(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_result")),
        Some(Value::String(_)) => true,
        _ => false,
    };

    let initiator = if is_subagent || !is_user_initiated || is_compact {
        "agent"
    } else {
        "user"
    };

    CopilotClassification {
        initiator,
        is_warmup: initiator == "user" && is_warmup_request(body, has_anthropic_beta, is_compact),
        is_compact,
        is_subagent,
    }
}

///
fn is_warmup_request(body: &Value, has_anthropic_beta: bool, is_compact: bool) -> bool {
    if !has_anthropic_beta || is_compact {
        return false;
    }
    body.get("tools")
        .and_then(|tools| tools.as_array())
        .is_none_or(|tools| tools.is_empty())
}

///
///
fn is_compact_request(body: &Value) -> bool {
    let system_text = extract_system_text(body);
    if system_text
        .starts_with("You are a helpful AI assistant tasked with summarizing conversations")
    {
        return true;
    }

    let messages = match body.get("messages").and_then(|m| m.as_array()) {
        Some(msgs) => msgs,
        None => return false,
    };

    if let Some(last_msg) = messages.last() {
        if last_msg.get("role").and_then(|r| r.as_str()) != Some("user") {
            return false;
        }

        let text = extract_text_from_message(last_msg);

        if text.contains("CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.") {
            return true;
        }

        if text.contains("Pending Tasks:") && text.contains("Current Work:") {
            return true;
        }
    }

    false
}

///
///
///
///
pub fn merge_tool_results(mut body: Value) -> Value {
    let messages = match body.get_mut("messages").and_then(|m| m.as_array_mut()) {
        Some(msgs) if !msgs.is_empty() => msgs,
        _ => return body,
    };

    for msg in messages.iter_mut() {
        if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }
        let content = match msg.get("content").and_then(|c| c.as_array()) {
            Some(blocks) => blocks,
            None => continue,
        };

        let mut tool_results: Vec<Value> = Vec::new();
        let mut text_blocks: Vec<Value> = Vec::new();
        let mut valid = true;

        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("tool_result") => tool_results.push(block.clone()),
                Some("text") => text_blocks.push(block.clone()),
                _ => {
                    valid = false;
                    break;
                }
            }
        }

        if !valid || tool_results.is_empty() || text_blocks.is_empty() {
            continue;
        }

        let merged = merge_blocks_into_tool_results(tool_results, text_blocks);
        msg["content"] = Value::Array(merged);
    }

    let messages = match body.get("messages").and_then(|m| m.as_array()) {
        Some(messages) => messages.clone(),
        None => return body,
    };
    if messages.len() <= 1 {
        return body;
    }

    let mut merged_msgs: Vec<Value> = Vec::with_capacity(messages.len());
    let mut i = 0;

    while i < messages.len() {
        if is_tool_result_only_message(&messages[i]) {
            let mut combined_content: Vec<Value> = Vec::new();
            while i < messages.len() && is_tool_result_only_message(&messages[i]) {
                if let Some(content) = messages[i].get("content").and_then(|c| c.as_array()) {
                    combined_content.extend(content.iter().cloned());
                }
                i += 1;
            }
            if !combined_content.is_empty() {
                merged_msgs.push(serde_json::json!({
                    "role": "user",
                    "content": combined_content
                }));
            }
        } else {
            merged_msgs.push(messages[i].clone());
            i += 1;
        }
    }

    body["messages"] = Value::Array(merged_msgs);
    body
}

///
pub fn deterministic_request_id(body: &Value, session_id: &str) -> String {
    let last_user_content = find_last_user_content(body);

    match last_user_content {
        Some(content) => {
            let mut hasher = Sha256::new();
            hasher.update(session_id.as_bytes());
            hasher.update(content.as_bytes());
            let result = hasher.finalize();

            let mut bytes = [0u8; 16];
            bytes.copy_from_slice(&result[..16]);
            bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
            bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

            Uuid::from_bytes(bytes).to_string()
        }
        None => Uuid::new_v4().to_string(),
    }
}

///
pub fn deterministic_interaction_id(session_id: &str) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }

    let mut hasher = Sha256::new();
    hasher.update(b"interaction:");
    hasher.update(session_id.as_bytes());
    let result = hasher.finalize();

    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&result[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

    Some(Uuid::from_bytes(bytes).to_string())
}

///
/// ```json
/// {"__SUBAGENT_MARKER__": {"session_id": "...", "agent_id": "...", "agent_type": "..."}}
/// ```
///
fn detect_subagent(body: &Value) -> bool {
    if extract_system_text(body).contains("__SUBAGENT_MARKER__") {
        return true;
    }

    if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
        for msg in messages {
            if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
                continue;
            }
            let text = extract_text_from_message(msg);
            if text.contains("__SUBAGENT_MARKER__") {
                return true;
            }
        }
    }

    if let Some(user_id) = body.pointer("/metadata/user_id").and_then(|v| v.as_str()) {
        if user_id.contains("_agent_") {
            return true;
        }
    }

    false
}

///
///
pub fn sanitize_orphan_tool_results(mut body: Value) -> Value {
    let messages = match body.get_mut("messages").and_then(|m| m.as_array_mut()) {
        Some(msgs) if msgs.len() >= 2 => msgs,
        _ => return body,
    };

    for i in 1..messages.len() {
        if messages[i].get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }

        let prev_tool_use_ids: HashSet<String> =
            if messages[i - 1].get("role").and_then(|r| r.as_str()) == Some("assistant") {
                messages[i - 1]
                    .get("content")
                    .and_then(|c| c.as_array())
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                            .filter_map(|b| b.get("id").and_then(|i| i.as_str()).map(String::from))
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                HashSet::new()
            };

        let content = match messages[i]
            .get_mut("content")
            .and_then(|c| c.as_array_mut())
        {
            Some(blocks) => blocks,
            None => continue,
        };

        for block in content.iter_mut() {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            let tool_use_id = block
                .get("tool_use_id")
                .and_then(|id| id.as_str())
                .unwrap_or("");
            if tool_use_id.is_empty() || !prev_tool_use_ids.contains(tool_use_id) {
                let content_text = match block.get("content") {
                    Some(Value::String(text)) => text.clone(),
                    Some(Value::Array(blocks)) => blocks
                        .iter()
                        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    _ => String::new(),
                };
                *block = serde_json::json!({
                    "type": "text",
                    "text": format!("[Tool result for {}]: {}", tool_use_id, content_text)
                });
            }
        }
    }

    body
}

///
///
pub fn strip_thinking_blocks(mut body: Value) -> Value {
    let Some(messages) = body.get_mut("messages").and_then(|m| m.as_array_mut()) else {
        return body;
    };

    for msg in messages.iter_mut() {
        if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") {
            continue;
        }
        let Some(content) = msg.get_mut("content").and_then(|c| c.as_array_mut()) else {
            continue;
        };
        content.retain(|block| {
            !matches!(
                block.get("type").and_then(|t| t.as_str()),
                Some("thinking") | Some("redacted_thinking")
            )
        });
    }

    body
}

fn extract_system_text(body: &Value) -> String {
    match body.get("system") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

///
fn find_last_user_content(body: &Value) -> Option<String> {
    let messages = body.get("messages").and_then(|m| m.as_array())?;

    for msg in messages.iter().rev() {
        if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }
        let content = msg.get("content")?;

        if let Some(s) = content.as_str() {
            return Some(s.to_string());
        }

        if let Some(blocks) = content.as_array() {
            let filtered: Vec<Value> = blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) != Some("tool_result"))
                .map(|b| {
                    let mut b = b.clone();
                    if let Some(obj) = b.as_object_mut() {
                        obj.remove("cache_control");
                    }
                    b
                })
                .collect();

            if !filtered.is_empty() {
                return Some(serde_json::to_string(&filtered).unwrap_or_default());
            }
        }
    }

    None
}

///
fn merge_blocks_into_tool_results(
    mut tool_results: Vec<Value>,
    text_blocks: Vec<Value>,
) -> Vec<Value> {
    if tool_results.len() == text_blocks.len() {
        for (tr, tb) in tool_results.iter_mut().zip(text_blocks.iter()) {
            append_text_to_tool_result(tr, tb);
        }
    } else {
        if let Some(last_tr) = tool_results.last_mut() {
            for tb in &text_blocks {
                append_text_to_tool_result(last_tr, tb);
            }
        }
    }
    tool_results
}

fn append_text_to_tool_result(tool_result: &mut Value, text_block: &Value) {
    let text = text_block
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    if text.trim().is_empty() {
        return;
    }

    match tool_result.get_mut("content") {
        Some(Value::String(existing)) => {
            existing.push('\n');
            existing.push_str(text);
        }
        Some(Value::Array(arr)) => {
            arr.push(serde_json::json!({"type": "text", "text": text}));
        }
        _ => {
            tool_result["content"] = Value::String(text.to_string());
        }
    }
}

fn extract_text_from_message(msg: &Value) -> String {
    match msg.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| {
                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                    block.get("text").and_then(|t| t.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

fn is_tool_result_only_message(msg: &Value) -> bool {
    if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
        return false;
    }
    match msg.get("content").and_then(|c| c.as_array()) {
        Some(blocks) if !blocks.is_empty() => blocks
            .iter()
            .all(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_result")),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_classify_user_text_message() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": "Hello, please help me write some code"}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
        assert!(!result.is_compact);
    }

    #[test]
    fn test_classify_user_text_array_message() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "Please explain this code"}
                ]}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
    }

    #[test]
    fn test_classify_tool_result_only() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "tools": [{"name": "Read", "description": "Read a file", "input_schema": {}}],
            "messages": [
                {"role": "user", "content": "Read the file"},
                {"role": "assistant", "content": [
                    {"type": "text", "text": "I'll read that file."},
                    {"type": "tool_use", "id": "toolu_123", "name": "Read", "input": {"path": "/tmp/test.rs"}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_123", "content": "file contents here"}
                ]}
            ]
        });
        let result = classify_request(&body, true, true, false);
        assert_eq!(result.initiator, "agent");
        assert!(!result.is_warmup);
    }

    #[test]
    fn test_classify_tool_result_with_text_block() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_123", "content": "file contents"},
                    {"type": "text", "text": "Now please refactor this code"}
                ]}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "agent");
    }

    #[test]
    fn test_classify_empty_messages() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": []
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
    }

    #[test]
    fn test_classify_no_messages() {
        let body = json!({"model": "claude-sonnet-4-20250514"});
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
    }

    #[test]
    fn test_classify_compact_request_system_prompt() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "system": "You are a helpful AI assistant tasked with summarizing conversations. Please create a summary.",
            "messages": [
                {"role": "user", "content": "Here is the conversation history to summarize..."}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "agent");
        assert!(result.is_compact);
    }

    #[test]
    fn test_classify_compact_request_critical_marker() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Summarize the conversation."}
                ]}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "agent");
        assert!(result.is_compact);
    }

    #[test]
    fn test_classify_compact_disabled_by_config() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "system": "You are a helpful AI assistant tasked with summarizing conversations.",
            "messages": [
                {"role": "user", "content": "Summarize"}
            ]
        });
        let result = classify_request(&body, false, false, false); // compact_detection=false
        assert_eq!(result.initiator, "user");
        assert!(!result.is_compact);
    }

    #[test]
    fn test_no_false_positive_on_user_summarize_request() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": "Please summarize the conversation so far into a concise summary."}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
        assert!(!result.is_compact);
    }

    #[test]
    fn test_warmup_with_anthropic_beta_no_tools() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": "Hello"}
            ]
        });
        let result = classify_request(&body, true, true, false);
        assert!(result.is_warmup);
    }

    #[test]
    fn test_not_warmup_without_anthropic_beta() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": "Hello"}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert!(!result.is_warmup);
    }

    #[test]
    fn test_not_warmup_with_tools() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "tools": [{"name": "Read", "description": "Read a file", "input_schema": {}}],
            "messages": [
                {"role": "user", "content": "Hello"}
            ]
        });
        let result = classify_request(&body, true, true, false);
        assert!(!result.is_warmup);
    }

    #[test]
    fn test_not_warmup_when_agent() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_123", "content": "ok"}
                ]}
            ]
        });
        let result = classify_request(&body, true, true, false);
        assert_eq!(result.initiator, "agent");
        assert!(!result.is_warmup);
    }

    #[test]
    fn test_merge_intra_message_tool_result_text() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "file contents"},
                    {"type": "text", "text": "skill output here"}
                ]}
            ]
        });
        let result = merge_tool_results(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "tool_result");
        let tr_content = content[0]["content"].as_str().unwrap();
        assert!(tr_content.contains("file contents"));
        assert!(tr_content.contains("skill output here"));
    }

    #[test]
    fn test_merge_intra_message_equal_count() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "result1"},
                    {"type": "text", "text": "text1"},
                    {"type": "tool_result", "tool_use_id": "t2", "content": "result2"},
                    {"type": "text", "text": "text2"}
                ]}
            ]
        });
        let result = merge_tool_results(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert!(content[0]["content"].as_str().unwrap().contains("text1"));
        assert!(content[1]["content"].as_str().unwrap().contains("text2"));
    }

    #[test]
    fn test_merge_intra_message_empty_text_ignored() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "result"},
                    {"type": "text", "text": ""}
                ]}
            ]
        });
        let result = merge_tool_results(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["content"], "result");
    }

    #[test]
    fn test_merge_intra_skips_other_block_types() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "result"},
                    {"type": "image", "source": {"data": "..."}},
                    {"type": "text", "text": "caption"}
                ]}
            ]
        });
        let result = merge_tool_results(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 3);
    }

    #[test]
    fn test_merge_cross_message_consecutive() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Read files"},
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {}},
                    {"type": "tool_use", "id": "t2", "name": "Read", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "file1"}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t2", "content": "file2"}
                ]}
            ]
        });
        let result = merge_tool_results(body);
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        let merged_content = messages[2]["content"].as_array().unwrap();
        assert_eq!(merged_content.len(), 2);
    }

    #[test]
    fn test_merge_does_not_affect_normal_messages() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi!"},
                {"role": "user", "content": "How are you?"}
            ]
        });
        let result = merge_tool_results(body.clone());
        assert_eq!(result["messages"], body["messages"]);
    }

    #[test]
    fn test_deterministic_id_stable() {
        let body = json!({
            "model": "claude-sonnet-4-20250514",
            "messages": [{"role": "user", "content": "Hello"}]
        });
        let id1 = deterministic_request_id(&body, "session1");
        let id2 = deterministic_request_id(&body, "session1");
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_deterministic_id_varies_by_content() {
        let body1 = json!({
            "messages": [{"role": "user", "content": "Hello"}]
        });
        let body2 = json!({
            "messages": [{"role": "user", "content": "Goodbye"}]
        });
        let id1 = deterministic_request_id(&body1, "session1");
        let id2 = deterministic_request_id(&body2, "session1");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_deterministic_id_varies_by_session() {
        let body = json!({
            "messages": [{"role": "user", "content": "Hello"}]
        });
        let id1 = deterministic_request_id(&body, "session1");
        let id2 = deterministic_request_id(&body, "session2");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_deterministic_id_ignores_tool_result() {
        let body1 = json!({
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "version_A"}
                ]},
                {"role": "user", "content": "do something"}
            ]
        });
        let body2 = json!({
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "version_B"}
                ]},
                {"role": "user", "content": "do something"}
            ]
        });
        let id1 = deterministic_request_id(&body1, "s");
        let id2 = deterministic_request_id(&body2, "s");
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_deterministic_id_fallback_when_no_user_content() {
        let body = json!({
            "messages": [
                {"role": "assistant", "content": "Hi"}
            ]
        });
        let id1 = deterministic_request_id(&body, "s");
        let id2 = deterministic_request_id(&body, "s");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_deterministic_id_is_valid_uuid() {
        let body = json!({
            "messages": [{"role": "user", "content": "test"}]
        });
        let id = deterministic_request_id(&body, "session");
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn test_interaction_id_stable_for_same_session() {
        let id1 = deterministic_interaction_id("session_abc");
        let id2 = deterministic_interaction_id("session_abc");
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_interaction_id_differs_across_sessions() {
        let id1 = deterministic_interaction_id("session_abc");
        let id2 = deterministic_interaction_id("session_def");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_interaction_id_differs_from_request_id() {
        let body = json!({
            "messages": [{"role": "user", "content": "Hello"}]
        });
        let interaction = deterministic_interaction_id("session_abc").unwrap();
        let request = deterministic_request_id(&body, "session_abc");
        assert_ne!(interaction, request);
    }

    #[test]
    fn test_interaction_id_empty_session_is_none() {
        assert!(deterministic_interaction_id("").is_none());
    }

    #[test]
    fn test_interaction_id_is_valid_uuid() {
        let id = deterministic_interaction_id("test_session").unwrap();
        assert!(Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn test_compact_detection_system_prompt() {
        let body = json!({
            "system": "You are a helpful AI assistant tasked with summarizing conversations. Please provide a concise summary.",
            "messages": [
                {"role": "user", "content": "Here is the conversation to summarize..."}
            ]
        });
        assert!(is_compact_request(&body));
    }

    #[test]
    fn test_compact_detection_critical_keyword() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Summarize this conversation."}
            ]
        });
        assert!(is_compact_request(&body));
    }

    #[test]
    fn test_compact_detection_structural_markers() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Summary of conversation:\n\nPending Tasks:\n- Fix bug\n\nCurrent Work:\n- Implementing feature"}
            ]
        });
        assert!(is_compact_request(&body));
    }

    #[test]
    fn test_compact_no_false_positive_on_generic_summary() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Your task is to create a detailed summary of the conversation so far."}
            ]
        });
        assert!(!is_compact_request(&body));
    }

    #[test]
    fn test_compact_detection_negative() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "What is the weather today?"}
            ]
        });
        assert!(!is_compact_request(&body));
    }

    #[test]
    fn test_compact_detection_system_array() {
        let body = json!({
            "system": [
                {"type": "text", "text": "You are a helpful AI assistant tasked with summarizing conversations."}
            ],
            "messages": [
                {"role": "user", "content": "Summarize"}
            ]
        });
        assert!(is_compact_request(&body));
    }

    #[test]
    fn test_detect_subagent_with_marker_in_user_message() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "<system-reminder>\n{\"__SUBAGENT_MARKER__\":{\"session_id\":\"abc123\",\"agent_id\":\"explore-1\",\"agent_type\":\"Explore\"}}\n</system-reminder>\nPlease search the codebase for auth handlers"}
                ]}
            ]
        });
        assert!(detect_subagent(&body));
    }

    #[test]
    fn test_detect_subagent_with_marker_in_system() {
        let body = json!({
            "system": "You are an agent. {\"__SUBAGENT_MARKER__\":{\"session_id\":\"abc\",\"agent_id\":\"plan-1\",\"agent_type\":\"Plan\"}}",
            "messages": [
                {"role": "user", "content": "Design the implementation plan"}
            ]
        });
        assert!(detect_subagent(&body));
    }

    #[test]
    fn test_detect_subagent_no_marker() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Hello, please help me write code"}
            ]
        });
        assert!(!detect_subagent(&body));
    }

    #[test]
    fn test_detect_subagent_via_metadata_user_id() {
        let body = json!({
            "metadata": {
                "user_id": "session_abc123_agent_explore-1"
            },
            "messages": [
                {"role": "user", "content": "Search for files"}
            ]
        });
        assert!(detect_subagent(&body));
    }

    #[test]
    fn test_detect_subagent_normal_user_id_not_matched() {
        let body = json!({
            "metadata": {
                "user_id": "session_abc123"
            },
            "messages": [
                {"role": "user", "content": "Hello"}
            ]
        });
        assert!(!detect_subagent(&body));
    }

    #[test]
    fn test_classify_subagent_sets_agent_initiator() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "<system-reminder>\n{\"__SUBAGENT_MARKER__\":{\"session_id\":\"abc\",\"agent_id\":\"explore-1\",\"agent_type\":\"Explore\"}}\n</system-reminder>\nSearch for files"}
                ]}
            ]
        });
        let result = classify_request(&body, false, true, true);
        assert_eq!(result.initiator, "agent");
        assert!(result.is_subagent);
    }

    #[test]
    fn test_classify_subagent_disabled_flag() {
        let body = json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "<system-reminder>\n{\"__SUBAGENT_MARKER__\":{\"session_id\":\"abc\",\"agent_id\":\"explore-1\",\"agent_type\":\"Explore\"}}\n</system-reminder>\nSearch for files"}
                ]}
            ]
        });
        let result = classify_request(&body, false, true, false);
        assert_eq!(result.initiator, "user");
        assert!(!result.is_subagent);
    }

    #[test]
    fn test_sanitize_orphan_tool_results_converts_orphans() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "Help me"},
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "tool_1", "name": "read_file", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "tool_1", "content": "file contents"},
                    {"type": "tool_result", "tool_use_id": "tool_orphan", "content": "orphan data"}
                ]}
            ]
        });
        let result = sanitize_orphan_tool_results(body);
        let msgs = result["messages"].as_array().unwrap();
        let last_content = msgs[2]["content"].as_array().unwrap();
        assert_eq!(last_content[0]["type"], "tool_result");
        assert_eq!(last_content[1]["type"], "text");
        assert!(last_content[1]["text"]
            .as_str()
            .unwrap()
            .contains("tool_orphan"));
    }

    #[test]
    fn test_sanitize_orphan_tool_results_no_orphans() {
        let body = json!({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "tool_1", "name": "read_file", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "tool_1", "content": "ok"}
                ]}
            ]
        });
        let result = sanitize_orphan_tool_results(body.clone());
        assert_eq!(result["messages"][1]["content"][0]["type"], "tool_result");
    }

    #[test]
    fn test_sanitize_orphan_non_adjacent_assistant_tool_use_is_orphan() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "step 1"},
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "old_tool", "name": "search", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "old_tool", "content": "found it"}
                ]},
                {"role": "assistant", "content": [
                    {"type": "text", "text": "OK, now let me think..."}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "old_tool", "content": "stale ref"}
                ]}
            ]
        });
        let result = sanitize_orphan_tool_results(body);
        let msgs = result["messages"].as_array().unwrap();
        assert_eq!(msgs[2]["content"][0]["type"], "tool_result");
        assert_eq!(msgs[4]["content"][0]["type"], "text");
    }

    #[test]
    fn test_sanitize_orphan_prev_not_assistant() {
        let body = json!({
            "messages": [
                {"role": "user", "content": "first"},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "data"}
                ]}
            ]
        });
        let result = sanitize_orphan_tool_results(body);
        assert_eq!(result["messages"][1]["content"][0]["type"], "text");
    }

    ///
    #[test]
    fn test_orphan_tool_result_classified_as_agent_before_sanitize() {
        let body = json!({
            "messages": [
                {"role": "assistant", "content": "I'll help you with that."},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "orphan_tool_1", "content": "file contents here"},
                    {"type": "tool_result", "tool_use_id": "orphan_tool_2", "content": "another result"}
                ]}
            ]
        });
        let classification = classify_request(&body, false, false, false);
        assert_eq!(classification.initiator, "agent");

        let sanitized = sanitize_orphan_tool_results(body);
        let classification_after = classify_request(&sanitized, false, false, false);
        assert_eq!(
            classification_after.initiator, "user",
            "sanitize  orphan tool_result  text user — \
              sanitize "
        );
    }

    #[test]
    fn test_orphan_tool_result_with_text_classified_as_agent() {
        let body = json!({
            "messages": [
                {"role": "assistant", "content": "Processing..."},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "orphan_1", "content": "result data"},
                    {"type": "text", "text": "Here's the output from the tool"}
                ]}
            ]
        });
        let classification = classify_request(&body, false, false, false);
        assert_eq!(classification.initiator, "agent");

        let sanitized = sanitize_orphan_tool_results(body);
        let classification_after = classify_request(&sanitized, false, false, false);
        assert_eq!(classification_after.initiator, "user");
    }

    #[test]
    fn test_sanitize_orphan_empty_tool_use_id_is_orphan() {
        let body = json!({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "tool_1", "name": "read", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "", "content": "empty id"},
                    {"type": "tool_result", "content": "missing id field"}
                ]}
            ]
        });
        let result = sanitize_orphan_tool_results(body);
        let content = result["messages"][1]["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "text");
    }

    #[test]
    fn test_strip_thinking_removes_assistant_thinking_blocks() {
        let body = serde_json::json!({
            "messages": [
                {"role": "user", "content": [{"type": "text", "text": "hi"}]},
                {"role": "assistant", "content": [
                    {"type": "thinking", "thinking": "let me ponder", "signature": "sig"},
                    {"type": "redacted_thinking", "data": "opaque"},
                    {"type": "text", "text": "hello"},
                    {"type": "tool_use", "id": "t1", "name": "read", "input": {}}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let content = result["messages"][1]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "tool_use");
    }

    #[test]
    fn test_strip_thinking_leaves_user_messages_untouched() {
        let body = serde_json::json!({
            "messages": [
                {"role": "user", "content": [
                    {"type": "thinking", "thinking": "x"},
                    {"type": "text", "text": "hi"}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
    }

    #[test]
    fn test_strip_thinking_handles_missing_messages() {
        let body = serde_json::json!({ "model": "claude-3-5-sonnet" });
        let result = strip_thinking_blocks(body.clone());
        assert_eq!(result, body);
    }

    #[test]
    fn test_strip_thinking_leaves_empty_content_array() {
        let body = serde_json::json!({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "thinking", "thinking": "solo"}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 0);
    }

    #[test]
    fn test_strip_thinking_preserves_signature_on_non_thinking_blocks() {
        let body = serde_json::json!({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "x", "input": {}, "signature": "s"}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let block = &result["messages"][0]["content"][0];
        assert_eq!(block["signature"], "s");
    }

    #[test]
    fn test_strip_thinking_multiple_assistant_turns() {
        let body = serde_json::json!({
            "messages": [
                {"role": "user", "content": [{"type": "text", "text": "q1"}]},
                {"role": "assistant", "content": [
                    {"type": "thinking", "thinking": "a"},
                    {"type": "text", "text": "r1"}
                ]},
                {"role": "user", "content": [{"type": "text", "text": "q2"}]},
                {"role": "assistant", "content": [
                    {"type": "redacted_thinking", "data": "x"},
                    {"type": "text", "text": "r2"}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let a1 = result["messages"][1]["content"].as_array().unwrap();
        let a2 = result["messages"][3]["content"].as_array().unwrap();
        assert_eq!(a1.len(), 1);
        assert_eq!(a1[0]["text"], "r1");
        assert_eq!(a2.len(), 1);
        assert_eq!(a2[0]["text"], "r2");
    }

    #[test]
    fn test_strip_thinking_ignores_string_content() {
        let body = serde_json::json!({
            "messages": [
                {"role": "assistant", "content": "plain text response"}
            ]
        });
        let result = strip_thinking_blocks(body.clone());
        assert_eq!(result, body);
    }

    #[test]
    fn test_strip_thinking_preserves_block_order() {
        let body = serde_json::json!({
            "messages": [
                {"role": "assistant", "content": [
                    {"type": "thinking", "thinking": "pre"},
                    {"type": "text", "text": "A"},
                    {"type": "tool_use", "id": "t1", "name": "x", "input": {}},
                    {"type": "redacted_thinking", "data": "mid"},
                    {"type": "text", "text": "B"}
                ]}
            ]
        });
        let result = strip_thinking_blocks(body);
        let content = result["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["text"], "A");
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[2]["text"], "B");
    }
}
