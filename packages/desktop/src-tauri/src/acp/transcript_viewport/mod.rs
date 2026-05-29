pub mod layout;
pub mod projection;
pub mod row;
pub mod viewport;

pub use layout::{HeightConfirmationOutcome, LayoutIndex, RowLayout};
pub use projection::project_transcript_viewport_rows;
pub use row::{
    TranscriptViewportInteractionLink, TranscriptViewportOperationLink, TranscriptViewportRow,
    TranscriptViewportRowContent, TranscriptViewportRowKind,
};
pub use viewport::{
    ScrollIntent, TranscriptViewport, ViewportBufferSlice, ViewportMode, ViewportTransition,
    ViewportWindow, DEFAULT_BUFFER_OVERSCAN_ROWS,
};
