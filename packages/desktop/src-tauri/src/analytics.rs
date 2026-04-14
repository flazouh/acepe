/// Rust-side Sentry integration.
///
/// Initialised once at startup via `init()`.  If `SENTRY_DSN` is not set the
/// function is a no-op so development builds are unaffected.
///
/// Captured events:
/// - All Rust panics (via the `sentry-panic` integration).
/// - Explicit errors forwarded with `capture_error()`.
use std::sync::OnceLock;

use sentry::types::Dsn;

static _SENTRY_GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();

/// Initialise Sentry from the `SENTRY_DSN` environment variable.
/// Safe to call multiple times — only the first call has any effect.
/// When `opted_out` is true, Sentry is not initialised.
pub fn init(app_version: Option<&str>, opted_out: bool) {
    if opted_out {
        tracing::debug!("Analytics opted out — Rust Sentry disabled");
        return;
    }

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
        .or_else(|| sentry::release_name!());

    let options = sentry::ClientOptions {
        dsn: Some(dsn),
        release,
        environment: Some(if cfg!(debug_assertions) {
            "development".into()
        } else {
            "production".into()
        }),
        send_default_pii: false,
        traces_sample_rate: 0.1,
        ..Default::default()
    };

    let guard = sentry::init(options);
    if _SENTRY_GUARD.set(guard).is_err() {
        tracing::debug!("Sentry already initialised — skipping");
    }
}

/// Report an arbitrary error to Sentry.  No-op if Sentry is not initialised.
pub fn capture_error(error: &anyhow::Error) {
    sentry::integrations::anyhow::capture_anyhow(error);
}
