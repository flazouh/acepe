//! Reasoning effort levels.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Effort level for Claude's reasoning depth
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    /// Minimal reasoning effort
    Low,
    /// Standard reasoning effort
    Medium,
    /// Higher reasoning effort
    High,
    /// Maximum reasoning effort
    Max,
}

impl std::fmt::Display for Effort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Effort::Low => write!(f, "low"),
            Effort::Medium => write!(f, "medium"),
            Effort::High => write!(f, "high"),
            Effort::Max => write!(f, "max"),
        }
    }
}
