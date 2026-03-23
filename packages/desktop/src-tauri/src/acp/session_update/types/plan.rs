use serde::{Deserialize, Serialize};
use specta::Type;

/// Plan step status.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

/// A single step in a plan.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    #[serde(alias = "content")] // agent sends "content"; canonical name is "description"
    pub description: String,
    pub status: PlanStepStatus,
}

/// Plan signal source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanSource {
    Deterministic,
    Heuristic,
}

/// Confidence level for a plan signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PlanConfidence {
    High,
    Medium,
}

fn default_true() -> bool {
    true
}

/// Plan data with steps and optional current step index.
/// Also supports streaming plan content from Edit tool writes.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanData {
    pub steps: Vec<PlanStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_step: Option<u32>,
    /// Whether this payload currently represents an active plan.
    #[serde(default = "default_true")]
    pub has_plan: bool,
    /// Whether the plan content is still streaming (true) or complete (false).
    #[serde(default)]
    pub streaming: bool,
    /// The raw markdown content of the plan file (partial during streaming).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Normalized markdown content consumed by the frontend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_markdown: Option<String>,
    /// The file path where the plan is being written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// The plan title extracted from the first # heading.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Source quality of the signal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PlanSource>,
    /// Confidence of the signal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<PlanConfidence>,
    /// Agent identifier that produced this plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Last update timestamp in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

impl PlanData {
    /// Private constructor for plan data built from a flat entries array.
    /// Keeps 12-field initialization in one place. New fields produce compile error.
    /// No Default derive — Rust's bool::default() is false, but has_plan must be true.
    pub(crate) fn from_steps(steps: Vec<PlanStep>) -> Self {
        PlanData {
            steps,
            has_plan: true,
            current_step: None,
            streaming: false,
            content: None,
            content_markdown: None,
            file_path: None,
            title: None,
            source: None,
            confidence: None,
            agent_id: None,
            updated_at: None,
        }
    }
}
