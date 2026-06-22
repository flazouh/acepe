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
    /// Extra-high reasoning effort
    Xhigh,
    /// Maximum reasoning effort
    Max,
}

impl std::fmt::Display for Effort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Effort::Low => write!(f, "low"),
            Effort::Medium => write!(f, "medium"),
            Effort::High => write!(f, "high"),
            Effort::Xhigh => write!(f, "xhigh"),
            Effort::Max => write!(f, "max"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `Display` output must match the tokens the `claude` CLI accepts for
    /// `--effort <level>` exactly (verified against CLI v2.1.185: low, medium,
    /// high, xhigh, max). Drift here silently sends an invalid flag value.
    #[test]
    fn display_matches_cli_accepted_effort_tokens() {
        assert_eq!(Effort::Low.to_string(), "low");
        assert_eq!(Effort::Medium.to_string(), "medium");
        assert_eq!(Effort::High.to_string(), "high");
        assert_eq!(Effort::Xhigh.to_string(), "xhigh");
        assert_eq!(Effort::Max.to_string(), "max");
    }
}
