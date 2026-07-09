use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionCompactionStatus {
    Preparing,
    Completed,
    UsageReset,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionCompactionTrigger {
    Auto,
    Manual,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompactionEvent {
    pub event_id: String,
    pub session_id: String,
    pub status: SessionCompactionStatus,
    pub trigger: SessionCompactionTrigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_compaction_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_compaction_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dropped_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub precomputed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserved_message_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cumulative_dropped_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub provider_metadata: serde_json::Value,
}
