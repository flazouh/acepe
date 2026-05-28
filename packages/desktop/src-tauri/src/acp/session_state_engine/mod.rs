pub mod bridge;
pub mod envelope;
pub mod frontier;
pub mod graph;
pub mod protocol;
pub mod reducer;
pub mod revision;
pub mod runtime_registry;
pub mod selectors;
pub mod snapshot_builder;

pub use bridge::{
    build_delta_envelope, build_snapshot_envelope,
    build_visible_transcript_window_envelope_from_graph, DeltaEnvelopeParts,
    DeltaSessionProjectionFields,
};
pub use envelope::{
    session_state_envelope_byte_budget_status, SessionStateEnvelope,
    SessionStateEnvelopeByteBudgetStatus, SessionStatePayloadKind,
};
pub use frontier::{FrontierFallbackReason, SessionFrontierDecision};
pub use graph::{ActiveStreamingTail, ActiveStreamingTailContentKind, SessionStateGraph};
pub use protocol::{
    CapabilityPreviewState, SessionStateDelta, SessionStatePayload,
    SessionStateSnapshotMaterialization, VisibleTranscriptWindowDiagnostic,
    VisibleTranscriptWindowPayload,
};
pub use reducer::{SessionStateGraphMutation, SessionStateReducer};
pub use revision::SessionGraphRevision;
pub use runtime_registry::{
    LiveSessionStateEnvelopeRequest, SessionGraphRuntimeRegistry, SessionGraphRuntimeSnapshot,
};
pub use selectors::{
    select_session_graph_activity, SessionGraphActionability, SessionGraphActivity,
    SessionGraphActivityKind, SessionGraphCapabilities, SessionGraphLifecycle,
    SessionRecommendedAction, SessionRecoveryPhase,
};
pub use snapshot_builder::build_graph_from_open_found;
