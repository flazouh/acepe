pub mod active_agent;
pub mod agent_context;
pub mod agent_installer;
pub(crate) mod agent_runtime;
pub mod attachment_token_expander;
pub mod capability_resolution;
pub mod client;
pub(crate) mod client_errors;
pub mod client_factory;
pub(crate) mod client_loop;
pub(crate) mod client_message_ids;
pub(crate) mod client_rpc;
pub(crate) mod client_session;
pub mod client_trait;
pub(crate) mod client_transport;
pub(crate) mod client_updates;
pub mod commands;
pub mod domain_events;
pub mod error;
pub mod event_bridge_server;
pub mod event_hub;
pub mod github;
pub mod inbound_request_router;
pub mod journal_write_lock;
pub mod lifecycle;
pub mod local_command;
pub mod mcp_catalog;
pub mod model_display;
pub mod non_streaming_batcher;
pub mod opencode;
pub mod parsers;
pub mod partial_json;
pub(crate) mod pending_prompt_registry;
pub mod permission_tracker;
pub mod pre_reservation_event_buffer;
pub mod preconnection_slash;
pub mod projections;
pub mod provider;
pub mod provider_extensions;
pub mod providers;
pub(crate) mod reconciler;
pub mod registry;
pub(crate) mod resume_failure_classifier;
pub mod runtime_resolver;
pub mod session_descriptor;
pub mod session_journal;
pub(crate) mod session_materialization;
pub mod session_open_snapshot;
pub mod session_policy;
pub mod session_registry;
pub mod session_restore;
pub mod session_state_engine;
pub mod session_thread_snapshot;
pub mod session_update;
pub mod session_update_parser;
pub(crate) mod session_wire_compaction;
pub mod streaming_accumulator;
pub mod streaming_log;
pub mod task_reconciler;
pub mod tool_call_presentation;
pub mod transcript_projection;
pub mod transcript_viewport;
pub mod transport;
pub mod types;
pub mod ui_event_dispatcher;

/// Process-global serialization lock for tests that mutate or read the global
/// `HOME` environment (and the CLI/cache paths derived from it). `std::env::set_var`
/// is process-wide, so a test mutating `HOME` races every concurrent test that
/// resolves a home-relative path. All such tests must hold THIS one lock — three
/// per-module locks previously failed to serialize against each other. Use
/// [`lock_home_env_for_test`] which is poison-tolerant.
#[cfg(test)]
pub(crate) static HOME_ENV_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Acquire the shared HOME-env test lock, recovering from poisoning so a failing
/// HOME-touching test does not cascade-fail the rest.
#[cfg(test)]
pub(crate) fn lock_home_env_for_test() -> std::sync::MutexGuard<'static, ()> {
    HOME_ENV_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
