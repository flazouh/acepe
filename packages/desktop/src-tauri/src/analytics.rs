/// Rust-side Sentry integration.
///
/// Initialized once at startup via `init()`. If `SENTRY_DSN` is not set the
/// client stays disabled, but the tracing layer is still installed so events can
/// begin flowing immediately if analytics is later enabled.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};

use sentry::integrations::tracing::EventFilter;
use sentry::types::Dsn;
use tracing::Subscriber;
use tracing_subscriber::{layer::Layer, registry::LookupSpan};

static SENTRY_GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();
static ANALYTICS_OPTED_OUT: AtomicBool = AtomicBool::new(false);
static APP_RELEASE: OnceLock<Option<String>> = OnceLock::new();

/// Initialise Sentry from the `SENTRY_DSN` environment variable.
/// Safe to call multiple times — only the first call has any effect.
pub fn init(app_version: Option<&str>, opted_out: bool) {
    ANALYTICS_OPTED_OUT.store(opted_out, Ordering::Relaxed);
    let _ = APP_RELEASE.set(app_version.map(|version| format!("acepe@{version}")));
    initialize_sentry_client();
}

pub fn set_analytics_opted_out(opted_out: bool) {
    ANALYTICS_OPTED_OUT.store(opted_out, Ordering::Relaxed);
    if opted_out {
        tracing::debug!("Analytics opted out — Rust Sentry disabled");
        return;
    }

    initialize_sentry_client();
}

pub fn is_analytics_enabled() -> bool {
    !ANALYTICS_OPTED_OUT.load(Ordering::Relaxed) && SENTRY_GUARD.get().is_some()
}

pub fn sentry_tracing_layer<S>() -> impl Layer<S>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    sentry::integrations::tracing::layer()
        .event_filter(|metadata: &tracing::Metadata<'_>| {
            if !is_analytics_enabled() {
                return EventFilter::Ignore;
            }

            match *metadata.level() {
                tracing::Level::ERROR => EventFilter::Exception,
                _ => EventFilter::Ignore,
            }
        })
        .span_filter(|_| false)
}

/// Report an arbitrary error to Sentry. No-op if Sentry is not initialised.
pub fn capture_error(error: &anyhow::Error) {
    if !is_analytics_enabled() {
        return;
    }

    sentry::integrations::anyhow::capture_anyhow(error);
}

fn initialize_sentry_client() {
    if ANALYTICS_OPTED_OUT.load(Ordering::Relaxed) {
        tracing::debug!("Analytics opted out — Rust Sentry disabled");
        return;
    }

    if SENTRY_GUARD.get().is_some() {
        return;
    }

    let dsn_str = match std::env::var("SENTRY_DSN").ok().filter(|value| !value.is_empty()) {
        Some(value) => value,
        None => {
            tracing::debug!("SENTRY_DSN not set — Rust Sentry disabled");
            return;
        }
    };

    let dsn: Dsn = match dsn_str.parse() {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!("Invalid SENTRY_DSN: {error}");
            return;
        }
    };

    let release = APP_RELEASE
        .get()
        .and_then(|value| value.clone())
        .map(Into::into)
        .or_else(|| sentry::release_name!());

    let should_send = Arc::new(|| !ANALYTICS_OPTED_OUT.load(Ordering::Relaxed));
    let before_send = {
        let should_send = Arc::clone(&should_send);
        Arc::new(move |event| if should_send() { Some(event) } else { None })
    };
    let before_breadcrumb = Arc::new(move |breadcrumb| {
        if should_send() {
            Some(breadcrumb)
        } else {
            None
        }
    });

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
        before_send: Some(before_send),
        before_breadcrumb: Some(before_breadcrumb),
        ..Default::default()
    };

    let guard = sentry::init(options);
    if SENTRY_GUARD.set(guard).is_err() {
        tracing::debug!("Sentry already initialized — skipping");
    }
}
