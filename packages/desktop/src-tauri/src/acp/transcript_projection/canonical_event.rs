use crate::acp::parsers::AgentType;
use crate::cc_sdk::AssistantMessageError;

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalTranscriptEvent {
    pub transcript_seq: u64,
    pub source: AgentType,
    pub provider_row_id: String,
    pub provider_msg_id: Option<String>,
    pub request_id: Option<String>,
    pub block_index: usize,
    pub display_id: String,
    pub timestamp: String,
    pub model: Option<String>,
    pub kind: CanonicalTranscriptEventKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CanonicalTranscriptEventKind {
    UserText {
        text: String,
    },
    UserPastedContent {
        text: String,
    },
    AssistantText {
        text: String,
        parent_tool_use_id: Option<String>,
    },
    AssistantThought {
        text: String,
        redacted_provider_data: Option<String>,
        parent_tool_use_id: Option<String>,
    },
    AssistantError {
        text: String,
        error: AssistantMessageError,
    },
    ToolUse {
        tool_call_id: String,
        name: String,
        input: serde_json::Value,
        parent_tool_use_id: Option<String>,
    },
}
