//! Analytics and error tracking for desktop app.
//!
//! - **Sentry**: errors, panics, and tracing (init in run(), track_error).
//!
//! Skips tracking in dev builds unless FORCE_ANALYTICS=1.

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

static DISTINCT_ID: OnceLock<String> = OnceLock::new();

const MAX_ERROR_MESSAGE_LEN: usize = 500;

/// Initialize Sentry. Must be called BEFORE Tauri/Tokio starts.
/// Returns a guard that must be kept alive for the duration of the app.
/// The distinct_id can be empty here — call `set_distinct_id()` later
/// once the app data directory is available.
pub fn init(dsn: String, distinct_id: String) -> Option<sentry::ClientInitGuard> {
    if !distinct_id.is_empty() {
        let _ = DISTINCT_ID.set(distinct_id.clone());
    }

    if dsn.is_empty() {
        return None;
    }

    let should_send = should_send();

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "production"
                }
                .into(),
            ),
            sample_rate: if should_send { 1.0 } else { 0.0 },
            traces_sample_rate: if should_send { 0.1 } else { 0.0 },
            attach_stacktrace: true,
            send_default_pii: false,
            before_send: Some(std::sync::Arc::new(|mut event| {
                // PII scrubbing: strip usernames from file paths in stack frames
                for exc in &mut event.exception.values {
                    if let Some(ref mut stacktrace) = exc.stacktrace {
                        for frame in &mut stacktrace.frames {
                            if let Some(ref mut filename) = frame.filename {
                                *filename = sanitize_path(filename);
                            }
                            if let Some(ref mut abs_path) = frame.abs_path {
                                *abs_path = sanitize_path(abs_path);
                            }
                        }
                    }
                }
                // Sentry's tracing integration moves the log message into a synthetic exception when
                // both a message and an error exist, leaving event.message empty. That produces
                // "(No error message)" in the issue title. Populate message from the first
                // exception value so issues get a clear title.
                if event.message.as_ref().is_none_or(|m| m.is_empty()) {
                    if let Some(first) = event.exception.values.first() {
                        if let Some(ref value) = first.value {
                            event.message = Some(sanitized_error_message(value));
                        }
                    }
                }
                Some(event)
            })),
            ..Default::default()
        },
    ));

    // Set user and platform context for all events
    sentry::configure_scope(|scope| {
        if !distinct_id.is_empty() {
            scope.set_user(Some(sentry::User {
                id: Some(distinct_id),
                ..Default::default()
            }));
        }

        // Platform context
        #[cfg(target_os = "macos")]
        scope.set_tag("platform", "darwin");
        #[cfg(target_os = "windows")]
        scope.set_tag("platform", "win32");
        #[cfg(target_os = "linux")]
        scope.set_tag("platform", "linux");

        #[cfg(target_arch = "x86_64")]
        scope.set_tag("arch", "x64");
        #[cfg(target_arch = "aarch64")]
        scope.set_tag("arch", "arm64");

        scope.set_tag("source", "desktop");
    });

    Some(guard)
}

/// Set the distinct ID after app data dir is available (called from setup).
/// Also updates the Sentry user context.
pub fn set_distinct_id(id: String) {
    let _ = DISTINCT_ID.set(id.clone());
    sentry::configure_scope(|scope| {
        scope.set_user(Some(sentry::User {
            id: Some(id),
            ..Default::default()
        }));
    });
}

/// Returns the initialized distinct ID when available.
pub fn get_distinct_id() -> Option<String> {
    DISTINCT_ID.get().cloned()
}

/// Check if analytics should be active (skips in dev unless forced).
fn should_send() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("FORCE_ANALYTICS")
            .map(|v| v == "1")
            .unwrap_or(false)
    }
    #[cfg(not(debug_assertions))]
    {
        true
    }
}

fn sanitize_path(path: &str) -> String {
    Regex::new(r"/Users/[^/]+/")
        .expect("user path redaction regex must compile")
        .replace_all(path, "/Users/***/")
        .to_string()
}

fn sanitized_error_message(message: &str) -> String {
    let redacted = sanitize_path(message);
    redacted.chars().take(MAX_ERROR_MESSAGE_LEN).collect()
}

/// Set Sentry scope tags for agent context.
///
/// Call this at the top of Tauri command handlers so that any `tracing::error!()`
/// (which the Sentry tracing layer forwards as Sentry issues) carries agent metadata.
/// Uses `configure_scope` (global) so all events within the current thread/task inherit the tags.
pub fn set_sentry_agent_context(agent_id: &str, session_id: Option<&str>) {
    sentry::configure_scope(|scope| {
        scope.set_tag("agent_id", agent_id);
        if let Some(sid) = session_id {
            scope.set_tag("session_id", sid);
        }
    });
}

/// Clear the agent context tags from Sentry scope (call when leaving a session context).
#[allow(dead_code)]
pub fn clear_sentry_agent_context() {
    sentry::configure_scope(|scope| {
        scope.remove_tag("agent_id");
        scope.remove_tag("session_id");
    });
}

/// Track a Rust-side error with Sentry.
pub fn track_error(
    _app: tauri::AppHandle,
    error_name: impl Into<String>,
    message: impl AsRef<str>,
    properties: Option<Value>,
) {
    if !should_send() {
        return;
    }

    let sanitized = sanitized_error_message(message.as_ref());
    let error_name = error_name.into();

    sentry::with_scope(
        |scope| {
            scope.set_tag("error_name", &error_name);
            scope.set_tag("runtime", "rust");
            scope.set_tag("kind", "backend");
            if let Some(Value::Object(obj)) = &properties {
                for (k, v) in obj {
                    scope.set_extra(k, v.clone());
                }
            }
        },
        || {
            sentry::capture_message(&sanitized, sentry::Level::Error);
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{sanitized_error_message, MAX_ERROR_MESSAGE_LEN};

    #[test]
    fn sanitized_error_message_redacts_home_path_segment() {
        let message = "failed: /Users/example/Documents/acepe/file.txt";
        let sanitized = sanitized_error_message(message);

        assert_eq!(sanitized, "failed: /Users/***/Documents/acepe/file.txt");
    }

    #[test]
    fn sanitized_error_message_truncates_to_limit() {
        let message = "a".repeat(MAX_ERROR_MESSAGE_LEN + 10);
        let sanitized = sanitized_error_message(&message);

        assert_eq!(sanitized.len(), MAX_ERROR_MESSAGE_LEN);
    }
}
