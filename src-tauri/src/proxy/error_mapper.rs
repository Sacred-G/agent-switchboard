//!

use super::ProxyError;

///
pub fn map_proxy_error_to_status(error: &ProxyError) -> u16 {
    match error {
        ProxyError::AlreadyRunning => 409,
        ProxyError::NotRunning => 503,

        ProxyError::UpstreamError { status, .. } => *status,

        ProxyError::Timeout(_) | ProxyError::StreamIdleTimeout(_) => 504,

        ProxyError::Forwardfailed(_) => 502,

        ProxyError::NoAvailableProvider => 503,

        ProxyError::AllProvidersCircuitOpen => 503,

        ProxyError::NoProvidersConfigured => 503,

        ProxyError::MaxRetriesExceeded => 503,

        ProxyError::ProviderUnhealthy(_) => 503,

        ProxyError::ConfigError(_) | ProxyError::InvalidRequest(_) => 400,

        ProxyError::AuthError(_) => 401,

        ProxyError::DatabaseError(_) => 500,

        ProxyError::TransformError(_) => 422,

        _ => 500,
    }
}

pub fn get_error_message(error: &ProxyError) -> String {
    match error {
        ProxyError::UpstreamError { status, body } => {
            if let Some(body) = body {
                format!("Error ({status}): {body}")
            } else {
                format!("Error ({status})")
            }
        }
        ProxyError::Timeout(msg) => format!("Request timeout: {msg}"),
        ProxyError::Forwardfailed(msg) => format!("Forwarding failed: {msg}"),
        ProxyError::NoAvailableProvider => " Provider".to_string(),
        ProxyError::AllProvidersCircuitOpen => "Circuit Broken".to_string(),
        ProxyError::NoProvidersConfigured => "Configure".to_string(),
        ProxyError::MaxRetriesExceeded => " Provider failedRetry".to_string(),
        ProxyError::ProviderUnhealthy(msg) => format!("Provider : {msg}"),
        ProxyError::DatabaseError(msg) => format!("Error: {msg}"),
        ProxyError::TransformError(msg) => format!("Request/response conversion error: {msg}"),
        _ => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_upstream_error() {
        let error = ProxyError::UpstreamError {
            status: 401,
            body: Some("Unauthorized".to_string()),
        };
        assert_eq!(map_proxy_error_to_status(&error), 401);
    }

    #[test]
    fn test_map_timeout_error() {
        let error = ProxyError::Timeout("Request timeout".to_string());
        assert_eq!(map_proxy_error_to_status(&error), 504);
    }

    #[test]
    fn test_map_connection_error() {
        let error = ProxyError::Forwardfailed("Connection refused".to_string());
        assert_eq!(map_proxy_error_to_status(&error), 502);
    }

    #[test]
    fn test_map_no_provider_error() {
        let error = ProxyError::NoAvailableProvider;
        assert_eq!(map_proxy_error_to_status(&error), 503);
    }

    #[test]
    fn test_map_status_matches_proxy_error_response_semantics() {
        assert_eq!(
            map_proxy_error_to_status(&ProxyError::AuthError("bad token".to_string())),
            401
        );
        assert_eq!(
            map_proxy_error_to_status(&ProxyError::ConfigError("bad config".to_string())),
            400
        );
        assert_eq!(
            map_proxy_error_to_status(&ProxyError::InvalidRequest("bad request".to_string())),
            400
        );
        assert_eq!(
            map_proxy_error_to_status(&ProxyError::TransformError("bad transform".to_string())),
            422
        );
        assert_eq!(
            map_proxy_error_to_status(&ProxyError::StreamIdleTimeout(30)),
            504
        );
    }

    #[test]
    fn test_get_error_message() {
        let error = ProxyError::UpstreamError {
            status: 500,
            body: Some("Internal Server Error".to_string()),
        };
        let msg = get_error_message(&error);
        assert!(msg.contains("Error"));
        assert!(msg.contains("500"));
        assert!(msg.contains("Internal Server Error"));
    }
}
