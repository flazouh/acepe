//! `SessionOpenResult` — unified session-open contract.
//!
//! Describes the full canonical session state at a proven journal cutoff, along
//! with an attach-ready open token that guarantees gap-free delta delivery from
//! that cutoff once the client claims it (Unit 3).
//!
//! ## Ordering guarantee
//!
//! Session-open helpers arm the `event_hub` reservation for `open_token`
//! **before** reading or returning open content. Any delta published to the hub
//! for `canonical_session_id` after arming is captured in the reservation
//! buffer and remains available for ordered flush at connect time (Unit 3).
//! Once the exact open cutoff is known, the helper raises the reservation
//! frontier to that `last_event_seq`; replay then delivers only buffered deltas
//! strictly after the open result and drops duplicates already included in it.

mod operation_sanitize;
mod snapshot;
mod transcript_merge;
mod types;

#[cfg(test)]
mod tests;

pub use snapshot::{
    compact_oversized_session_open_result, session_open_result_for_new_session,
    session_open_result_from_completed_local_journal, session_open_result_from_current_row_ledger,
    session_open_result_from_current_row_ledger_with_status,
    session_open_result_from_provider_owned_snapshot, session_open_result_from_thread_snapshot,
    CurrentRowLedgerOpenLookup, CurrentRowLedgerOpenMiss,
};
pub use types::{
    NewSessionOpenResultInput, SessionOpenError, SessionOpenErrorReason, SessionOpenFound,
    SessionOpenMissing, SessionOpenPath, SessionOpenResult, SessionOpenResultTiming,
    SessionOpenTranscriptRowPage,
};

pub(crate) use operation_sanitize::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
};
#[allow(unused_imports)]
pub(crate) use snapshot::{
    default_session_title, derive_title_from_transcript_snapshot, resolve_canonical_session_title,
    session_projection_snapshot_from_open_found,
};
