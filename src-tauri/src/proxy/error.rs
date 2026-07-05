use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProxyError {
    #[error("")]
    AlreadyRunning,

    #[error("")]
    NotRunning,

    #[error("failed: {0}")]
    Bindfailed(String),

    #[error("")]
    StopTimeout,

    #[error("failed: {0}")]
    Stopfailed(String),

    #[error("Request forwarding failed: {0}")]
    Forwardfailed(String),

    #[error("Provider")]
    NoAvailableProvider,

    #[error("Circuit Broken")]
    AllProvidersCircuitOpen,

    #[error("Configure")]
    NoProvidersConfigured,

    #[allow(dead_code)]
    #[error("Provider: {0}")]
    ProviderUnhealthy(String),

    #[error("Error ( {status}): {body:?}")]
    UpstreamError { status: u16, body: Option<String> },

    #[error("ExceededRetry")]
    MaxRetriesExceeded,

    #[error("Error: {0}")]
    DatabaseError(String),

    #[error("ConfigureError: {0}")]
    ConfigError(String),

    #[allow(dead_code)]
    #[error("Error: {0}")]
    TransformError(String),

    #[allow(dead_code)]
    #[error("Invalid: {0}")]
    InvalidRequest(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[allow(dead_code)]
    #[error("Timeout: {0}")]
    StreamIdleTimeout(u64),

    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[allow(dead_code)]
    #[error("Error: {0}")]
    Internal(String),
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            ProxyError::UpstreamError {
                status: upstream_status,
                body: upstream_body,
            } => {
                let http_status =
                    StatusCode::from_u16(*upstream_status).unwrap_or(StatusCode::BAD_GATEWAY);

                let error_body = if let Some(body_str) = upstream_body {
                    if let Ok(json_body) = serde_json::from_str::<serde_json::Value>(body_str) {
                        json_body
                    } else {
                        json!({
                            "error": {
                                "message": body_str,
                                "type": "upstream_error",
                            }
                        })
                    }
                } else {
                    json!({
                        "error": {
                            "message": format!("Upstream error (status {})", upstream_status),
                            "type": "upstream_error",
                        }
                    })
                };

                (http_status, error_body)
            }
            _ => {
                let (http_status, message) = match &self {
                    ProxyError::AlreadyRunning => (StatusCode::CONFLICT, self.to_string()),
                    ProxyError::NotRunning => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
                    ProxyError::Bindfailed(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
                    }
                    ProxyError::StopTimeout => {
                        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
                    }
                    ProxyError::Stopfailed(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
                    }
                    ProxyError::Forwardfailed(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
                    ProxyError::NoAvailableProvider => {
                        (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
                    }
                    ProxyError::AllProvidersCircuitOpen => {
                        (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
                    }
                    ProxyError::NoProvidersConfigured => {
                        (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
                    }
                    ProxyError::ProviderUnhealthy(_) => {
                        (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
                    }
                    ProxyError::MaxRetriesExceeded => {
                        (StatusCode::SERVICE_UNAVAILABLE, self.to_string())
                    }
                    ProxyError::DatabaseError(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
                    }
                    ProxyError::ConfigError(_) => (StatusCode::BAD_REQUEST, self.to_string()),
                    ProxyError::TransformError(_) => {
                        (StatusCode::UNPROCESSABLE_ENTITY, self.to_string())
                    }
                    ProxyError::InvalidRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
                    ProxyError::Timeout(_) => (StatusCode::GATEWAY_TIMEOUT, self.to_string()),
                    ProxyError::StreamIdleTimeout(_) => {
                        (StatusCode::GATEWAY_TIMEOUT, self.to_string())
                    }
                    ProxyError::AuthError(_) => (StatusCode::UNAUTHORIZED, self.to_string()),
                    ProxyError::Internal(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
                    }
                    ProxyError::UpstreamError { .. } => unreachable!(),
                };

                let error_body = json!({
                    "error": {
                        "message": message,
                        "type": "proxy_error",
                    }
                });

                (http_status, error_body)
            }
        };

        (status, Json(body)).into_response()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    Retryable,
    NonRetryable,
    #[allow(dead_code)]
    ClientAbort,
}

#[allow(dead_code)]
pub fn categorize_error(error: &reqwest::Error) -> ErrorCategory {
    if error.is_timeout() || error.is_connect() {
        return ErrorCategory::Retryable;
    }

    if let Some(status) = error.status() {
        if status.is_server_error() {
            ErrorCategory::Retryable
        } else if status.is_client_error() {
            ErrorCategory::NonRetryable
        } else {
            ErrorCategory::Retryable
        }
    } else {
        ErrorCategory::Retryable
    }
}
