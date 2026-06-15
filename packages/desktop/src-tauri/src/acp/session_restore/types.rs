use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnresolvedToolRowAudit {
    pub entry_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoredToolLinkAudit {
    pub session_id: String,
    pub agent_id: String,
    pub entry_count: usize,
    pub transcript_tool_count: usize,
    pub operation_count: usize,
    pub unresolved_count: usize,
    pub unresolved_rows: Vec<UnresolvedToolRowAudit>,
}
