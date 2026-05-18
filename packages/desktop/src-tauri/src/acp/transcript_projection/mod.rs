pub(crate) mod canonical_event;
pub mod delta;
pub mod runtime;
pub mod snapshot;

pub(crate) use canonical_event::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
pub use delta::{TranscriptDelta, TranscriptDeltaOperation};
pub use runtime::TranscriptProjectionRegistry;
pub use snapshot::{TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot};
