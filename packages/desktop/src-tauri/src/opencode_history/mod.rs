//! OpenCode history module.
//!
//! Provides parsing, indexing, and command interfaces for OpenCode session history.

pub mod commands;
pub mod convert;
pub mod parser;
pub mod types;

#[cfg(test)]
mod test_integration;

pub use convert::{
    convert_opencode_messages_to_provider_owned_snapshot, convert_opencode_messages_to_session,
};
// Re-export commonly used types
pub use types::{
    OpenCodeMessage, OpenCodeMessagePart, OpenCodeProject, OpenCodeSession, OpenCodeTime,
};
