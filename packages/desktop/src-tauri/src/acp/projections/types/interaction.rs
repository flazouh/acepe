use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::acp::session_update::{
    InteractionReplyHandler, PermissionData, QuestionData, ToolReference,
};
use crate::computer_use::permissions::ComputerPermissionKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum InteractionKind {
    Permission,
    Question,
    PlanApproval,
    ComputerPermission,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum InteractionState {
    Pending,
    Approved,
    Rejected,
    Answered,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum PlanApprovalSource {
    CreatePlan,
    ExitPlanMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ComputerPermissionData {
    pub id: String,
    pub session_id: String,
    pub permission_kind: ComputerPermissionKind,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool: Option<ToolReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum InteractionPayload {
    Permission(PermissionData),
    Question(QuestionData),
    PlanApproval { source: PlanApprovalSource },
    ComputerPermission(ComputerPermissionData),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum InteractionResponse {
    Permission {
        accepted: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        option_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reply: Option<String>,
    },
    Question {
        answers: Value,
    },
    PlanApproval {
        approved: bool,
    },
    ComputerPermission {
        accepted: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InteractionSnapshot {
    pub id: String,
    pub session_id: String,
    pub kind: InteractionKind,
    pub state: InteractionState,
    pub json_rpc_request_id: Option<u64>,
    pub reply_handler: Option<InteractionReplyHandler>,
    pub tool_reference: Option<ToolReference>,
    pub responded_at_event_seq: Option<i64>,
    pub response: Option<InteractionResponse>,
    pub payload: InteractionPayload,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub canonical_operation_id: Option<String>,
}
