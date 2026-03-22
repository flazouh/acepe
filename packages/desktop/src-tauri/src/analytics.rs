//! Analytics and error tracking for desktop app.
//!
//! - **Sentry**: errors, panics, and tracing (init in run(), track_error).
//! - **Mixpanel**: product events (init_mixpanel in setup(), track_event).
//!
//! Skips tracking in dev builds unless FORCE_ANALYTICS=1.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

static DISTINCT_ID: OnceLock<String> = OnceLock::new();

// Mixpanel: token and HTTP client for product events
static MIXPANEL_TOKEN: OnceLock<String> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Canonical analytics event names. Use these instead of string literals.
#[derive(Debug, Clone, Copy)]
pub enum AnalyticsEvent {
    AppExited,
    AppStarted,
    CheckpointReverted,
    ConfigOptionChanged,
    MessageSent,
    ModelChanged,
    ModeChanged,
    ProjectAdded,
    ProjectRemoved,
    SessionCancelled,
    SessionClosed,
    SessionCreated,
    SessionForked,
    SessionResumed,
    SkillCreated,
    TerminalOpened,
    WorktreeCreated,
}

impl AnalyticsEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AppExited => "app_exited",
            Self::AppStarted => "app_started",
            Self::CheckpointReverted => "checkpoint_reverted",
            Self::ConfigOptionChanged => "config_option_changed",
            Self::MessageSent => "message_sent",
            Self::ModelChanged => "model_changed",
            Self::ModeChanged => "mode_changed",
            Self::ProjectAdded => "project_added",
            Self::ProjectRemoved => "project_removed",
            Self::SessionCancelled => "session_cancelled",
            Self::SessionClosed => "session_closed",
            Self::SessionCreated => "session_created",
            Self::SessionForked => "session_forked",
            Self::SessionResumed => "session_resumed",
            Self::SkillCreated => "skill_created",
            Self::TerminalOpened => "terminal_opened",
            Self::WorktreeCreated => "worktree_created",
        }
    }
}

impl AsRef<str> for AnalyticsEvent {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

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

/// Initialize Mixpanel for product events. Call from setup() after distinct_id is available.
pub fn init_mixpanel(token: String) {
    if !token.is_empty() {
        let _ = MIXPANEL_TOKEN.set(token);
        let _ = HTTP_CLIENT.set(reqwest::Client::new());
    }
}

pub fn resolve_mixpanel_token(
    runtime_token: Option<String>,
    bundled_token: Option<&str>,
) -> String {
    if let Some(token) = runtime_token.filter(|value| !value.is_empty()) {
        return token;
    }

    bundled_token.unwrap_or_default().to_string()
}

fn mixpanel_base_properties(app: &tauri::AppHandle) -> HashMap<String, Value> {
    let mut props = HashMap::new();
    props.insert("source".to_string(), json!("desktop"));
    props.insert(
        "app_version".to_string(),
        json!(app.package_info().version.to_string()),
    );
    #[cfg(target_os = "macos")]
    props.insert("platform".to_string(), json!("darwin"));
    #[cfg(target_os = "windows")]
    props.insert("platform".to_string(), json!("win32"));
    #[cfg(target_os = "linux")]
    props.insert("platform".to_string(), json!("linux"));
    #[cfg(target_arch = "x86_64")]
    props.insert("arch".to_string(), json!("x64"));
    #[cfg(target_arch = "aarch64")]
    props.insert("arch".to_string(), json!("arm64"));
    props
}

fn mixpanel_merge_properties(props: &mut HashMap<String, Value>, properties: Option<Value>) {
    if let Some(Value::Object(obj)) = properties {
        for (k, v) in obj {
            props.insert(k, v);
        }
    }
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

/// Track a product analytics event. Sent to Mixpanel only (Sentry is for errors).
/// No-op in dev unless FORCE_ANALYTICS=1.
pub fn track_event(app: tauri::AppHandle, event: impl AsRef<str>, properties: Option<Value>) {
    if !should_send() {
        return;
    }

    let token = match MIXPANEL_TOKEN.get() {
        Some(t) if !t.is_empty() => t.clone(),
        _ => return,
    };
    let distinct_id = match DISTINCT_ID.get() {
        Some(id) if !id.is_empty() => id.clone(),
        _ => return,
    };

    let event_name = event.as_ref().to_string();
    let mut props = mixpanel_base_properties(&app);
    props.insert("token".to_string(), json!(token));
    props.insert("distinct_id".to_string(), json!(distinct_id));
    mixpanel_merge_properties(&mut props, properties);

    let payload = json!([{ "event": event_name, "properties": props }]);

    tauri::async_runtime::spawn(async move {
        let client = match HTTP_CLIENT.get() {
            Some(c) => c,
            None => return,
        };
        let data = BASE64.encode(payload.to_string().as_bytes());
        let res = client
            .get("https://api.mixpanel.com/track")
            .query(&[("data", &data)])
            .send()
            .await;
        if let Err(e) = res {
            tracing::debug!(error = %e, "Mixpanel track failed (non-fatal)");
        }
    });
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
    use super::{resolve_mixpanel_token, sanitized_error_message, MAX_ERROR_MESSAGE_LEN};

    #[test]
    fn sanitized_error_message_redacts_home_path_segment() {
        let message = "failed: /Users/alex/Documents/acepe/file.txt";
        let sanitized = sanitized_error_message(message);

        assert_eq!(sanitized, "failed: /Users/***/Documents/acepe/file.txt");
    }

    #[test]
    fn sanitized_error_message_truncates_to_limit() {
        let message = "a".repeat(MAX_ERROR_MESSAGE_LEN + 10);
        let sanitized = sanitized_error_message(&message);

        assert_eq!(sanitized.len(), MAX_ERROR_MESSAGE_LEN);
    }

    #[test]
    fn resolve_mixpanel_token_prefers_runtime_value() {
        let token =
            resolve_mixpanel_token(Some("runtime-token".to_string()), Some("bundled-token"));

        assert_eq!(token, "runtime-token");
    }

    #[test]
    fn resolve_mixpanel_token_falls_back_to_bundled_value() {
        let token = resolve_mixpanel_token(None, Some("bundled-token"));

        assert_eq!(token, "bundled-token");
    }
}
