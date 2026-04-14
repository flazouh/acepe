/// Rust-side Sentry integration.
///
/// Initialised once at startup via `init()`.  If `SENTRY_DSN` is not set the
/// function is a no-op so development builds are unaffected.
///
/// Captured events:
/// - All Rust panics (via the `sentry-panic` integration).
/// - Explicit errors forwarded with `capture_error()`.
///
/// PII policy: file paths that contain a username segment are scrubbed before
/// the event leaves the process.
use std::sync::OnceLock;

use regex::Regex;
use sentry::types::Dsn;

static _SENTRY_GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();

fn scrub_path(value: &str) -> String {
    // /Users/<name>/... → /Users/<redacted>/...
    let re_unix = regex_lite::Regex::new(r"/Users/[^/\n]+").unwrap();
    // C:\Users\<name>\... → C:\Users\<redacted>\...
    let re_win = regex_lite::Regex::new(r"[A-Za-z]:\\Users\\[^\\\n]+").unwrap();
    let s = re_unix.replace_all(value, "/Users/<redacted>");
    re_win.replace_all(&s, r"C:\Users\<redacted>").into_owned()
}

/// Initialise Sentry from the `SENTRY_DSN` environment variable.
/// Safe to call multiple times — only the first call has any effect.
pub fn init(app_version: Option<&str>) {
    let dsn_str = match std::env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty()) {
        Some(v) => v,
        None => {
            tracing::debug!("SENTRY_DSN not set — Rust Sentry disabled");
            return;
        }
    };

    let dsn: Dsn = match dsn_str.parse() {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!("Invalid SENTRY_DSN: {err}");
            return;
        }
    };

    let release = app_version
        .map(|v| format!("acepe@{v}").into())
        .unwrap_or_else(sentry::release_name!);

    let options = sentry::ClientOptions {
        dsn: Some(dsn),
        release: Some(release),
        environment: Some(if cfg!(debug_assertions) {
            "development".into()
        } else {
            "production".into()
        }),
        send_default_pii: false,
        before_send: Some(std::sync::Arc::new(|mut event| {
            // Scrub paths in the exception message and stacktrace filenames.
            for exc in event.exception.values.iter_mut() {
                if let Some(ref v) = exc.value.clone() {
                    exc.value = Some(scrub_path(v));
                }
                if let Some(ref mut st) = exc.stacktrace {
                    for frame in st.frames.iter_mut() {
                        if let Some(ref f) = frame.filename.clone() {
                            frame.filename = Some(scrub_path(f).into());
                        }
                    }
                }
            }
            Some(event)
        })),
        ..Default::default()
    };

    // Store the guard for the process lifetime so the in-flight queue is
    // flushed on shutdown.
    let guard = sentry::init(options);
    if _SENTRY_GUARD.set(guard).is_err() {
        tracing::debug!("Sentry already initialised — skipping");
    }
}

/// Report an arbitrary error to Sentry.  No-op if Sentry is not initialised.
pub fn capture_error(error: &anyhow::Error) {
    sentry::integrations::anyhow::capture_anyhow(error);
}
