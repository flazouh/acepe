//! OpenCode history module.
//!
//! Provides parsing, indexing, and command interfaces for OpenCode session history.

pub mod commands;
pub mod parser;
pub mod types;

#[cfg(test)]
mod test_integration;

// Re-export commonly used types
pub use types::{
    OpenCodeMessage, OpenCodeMessagePart, OpenCodeProject, OpenCodeSession, OpenCodeTime,
};
