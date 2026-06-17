//! `SessionOpenResult` — unified session-open contract.
//!
//! Describes the full canonical session state at a proven journal cutoff, along
//! with an attach-ready open token that guarantees gap-free delta delivery from
//! that cutoff once the client claims it (Unit 3).
//!
//! ## Ordering guarantee
//!
//! Session-open helpers arm the `event_hub` reservation for `open_token`
//! **before** returning the assembled snapshot content. Any delta published to
//! the hub for `canonical_session_id` after arming is captured in the
//! reservation buffer and remains available for ordered flush at connect time
//! (Unit 3). A concurrent event that hits the journal within the tiny window
//! between `max_event_seq` read and reservation arming will appear in the
//! buffer and may also be reflected in the projection — deduplication by
//! `last_event_seq` at claim time (Unit 3) ensures it is not delivered twice.

mod operation_sanitize;
mod snapshot;
mod transcript_merge;
mod types;

#[cfg(test)]
mod tests;

pub use snapshot::{
    session_open_result_for_new_session, session_open_result_from_completed_local_journal,
    session_open_result_from_provider_owned_snapshot, session_open_result_from_thread_snapshot,
};
pub use types::{
    NewSessionOpenResultInput, SessionOpenError, SessionOpenErrorReason, SessionOpenFound,
    SessionOpenMissing, SessionOpenResult,
};

pub(crate) use operation_sanitize::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
};
#[allow(unused_imports)]
pub(crate) use snapshot::{
    default_session_title, derive_title_from_transcript_snapshot, resolve_canonical_session_title,
};
