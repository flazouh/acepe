pub(crate) mod canonical_event;
pub mod delta;
pub mod display_id;
pub mod relink;
pub mod runtime;
pub mod snapshot;

#[cfg(test)]
#[path = "tests/mod.rs"]
mod characterization_tests;

pub(crate) use canonical_event::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
pub use delta::{TranscriptDelta, TranscriptDeltaOperation};
pub use display_id::{
    assistant_boundary_entry_count_from_transcript_entries, derive_entry_id,
    derive_entry_id_for_snapshot_role, derive_entry_id_from_history_facts,
    derive_entry_id_from_live_facts, derive_tool_entry_id, tool_call_id_from_authority_entry_id,
    turn_key_for_assistant_boundary, DisplayElementRole, DisplayIdInput,
};
pub use runtime::TranscriptProjectionRegistry;
pub use snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptScope, TranscriptSegment, TranscriptSnapshot,
};

pub(crate) use relink::relink_operations_to_transcript;

/// Live tool row identity — must match [`derive_tool_entry_id`] for the same turn + tool call.
#[must_use]
pub(crate) fn live_tool_entry_id_for_tool_call(
    assistant_boundary_entry_count: usize,
    tool_call_id: &str,
) -> String {
    derive_tool_entry_id(
        &turn_key_for_assistant_boundary(assistant_boundary_entry_count),
        tool_call_id,
    )
}
