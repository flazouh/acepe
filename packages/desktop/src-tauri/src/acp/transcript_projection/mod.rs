pub(crate) mod canonical_event;
pub mod delta;
pub mod runtime;
pub mod snapshot;

pub(crate) use canonical_event::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
pub use delta::{TranscriptDelta, TranscriptDeltaOperation};
pub use runtime::TranscriptProjectionRegistry;
pub use snapshot::{TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot};

pub(crate) fn live_tool_entry_id_for_event_seq(event_seq: i64) -> String {
    format!("tool-event-{event_seq}")
}
