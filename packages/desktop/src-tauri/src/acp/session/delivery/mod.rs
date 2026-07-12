//! Delivery layer — carve `SessionGraph` into wire payloads without truth mutation.

pub mod history_load;
pub mod open_from_fold;

pub use history_load::{
    history_error_to_provider_error, load_history_events, load_history_events_for_replay,
    load_provider_owned_snapshot_from_history,
};
pub use open_from_fold::{graph_from_history_events, session_open_found_from_fold};
pub use crate::acp::session::fold_export::provider_owned_snapshot_from_folded_graph;
