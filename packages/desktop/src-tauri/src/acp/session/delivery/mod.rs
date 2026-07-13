//! Delivery layer — carve `SessionGraph` into wire payloads without truth mutation.

pub mod history_load;
pub mod live_transcript_fold;
pub mod open_from_fold;

pub use history_load::{
    history_error_to_provider_error, load_fold_graph_from_history,
    load_fold_graph_from_history_workspace, load_history_events, load_history_events_for_replay,
};
pub use open_from_fold::{graph_from_history_events, session_open_found_from_fold};
