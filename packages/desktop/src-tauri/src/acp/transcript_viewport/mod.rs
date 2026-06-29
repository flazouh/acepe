pub mod projection;
pub mod row;

pub use projection::project_transcript_viewport_rows;
pub use row::{
    TranscriptViewportInteractionLink, TranscriptViewportOperationLink, TranscriptViewportRow,
    TranscriptViewportRowContent, TranscriptViewportRowKind,
};
