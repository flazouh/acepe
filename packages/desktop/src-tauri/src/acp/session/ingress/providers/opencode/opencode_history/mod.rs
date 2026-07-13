//! OpenCode history module.
//!
//! Provides parsing, indexing, and command interfaces for OpenCode session history.

pub mod commands;
pub mod convert;
pub mod parser;
pub mod types;

#[cfg(test)]
mod test_integration;

pub use convert::opencode_messages_to_provider_events;
// Re-export commonly used types
pub use types::{
    OpenCodeMessage, OpenCodeMessagePart, OpenCodeProject, OpenCodeSession, OpenCodeTime,
};
