//! Database repositories, split by domain.
//!
//! Each repository struct lives in its own sub-module; this module re-exports
//! every public item so external callers continue to use
//! `crate::db::repository::X` paths unchanged.

mod database_reset;
mod project;
mod session_journal;
mod session_metadata;
mod session_review;
mod settings;
mod skills;
mod sql_studio;

pub use database_reset::*;
pub use project::*;
pub use session_journal::*;
pub use session_metadata::*;
pub use session_review::*;
pub use settings::*;
pub use skills::*;
pub use sql_studio::*;
