//! Database repositories, split by domain.
//!
//! Each repository struct lives in its own sub-module; this module re-exports
//! every public item so external callers continue to use
//! `crate::db::repository::X` paths unchanged.

mod database_reset;
mod project;
mod session_config_selection;
mod session_history_enrichment;
mod session_journal;
mod session_metadata;
mod session_review;
mod session_transcript_row_ledger;
mod settings;
mod skills;

pub use database_reset::*;
pub use project::*;
pub use session_config_selection::*;
pub use session_history_enrichment::*;
pub use session_journal::*;
pub use session_metadata::*;
pub use session_review::*;
pub use session_transcript_row_ledger::*;
pub use settings::*;
pub use skills::*;
