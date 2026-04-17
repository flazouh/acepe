use serde::{Deserialize, Serialize};
use specta::Type;

use super::{QuestionItem, TodoItem};
use crate::acp::agent_context::current_agent;
use crate::acp::parsers::AgentType;
use crate::acp::session_update::normalize::derive_normalized_questions_and_todos;
use crate::acp::tool_classification::{classify_serialized_tool_call, ToolClassificationHints};

/// Tool kind for routing to appropriate UI components.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Execute,
    Search,
    Glob,
    Fetch,
    WebSearch,
    Think,
    Todo,
    Question,
    Task,
    TaskOutput,
    Skill,
    Move,
    Delete,
    EnterPlanMode,
    ExitPlanMode,
    CreatePlan,
    ToolSearch,
    Browser,
    Other,
}

impl ToolKind {
    /// Returns the string representation of the tool kind.
    pub fn as_str(&self) -> &'static str {
        match self {
            ToolKind::Read => "read",
            ToolKind::Edit => "edit",
            ToolKind::Execute => "execute",
            ToolKind::Search => "search",
            ToolKind::Glob => "glob",
            ToolKind::Fetch => "fetch",
            ToolKind::WebSearch => "web_search",
            ToolKind::Think => "think",
            ToolKind::Todo => "todo",
            ToolKind::Question => "question",
            ToolKind::Task => "task",
            ToolKind::TaskOutput => "task_output",
            ToolKind::Skill => "skill",
            ToolKind::Move => "move",
            ToolKind::Delete => "delete",
            ToolKind::EnterPlanMode => "enter_plan_mode",
            ToolKind::ExitPlanMode => "exit_plan_mode",
            ToolKind::CreatePlan => "create_plan",
            ToolKind::ToolSearch => "tool_search",
            ToolKind::Browser => "browser",
            ToolKind::Other => "other",
        }
    }
}

impl std::fmt::Display for ToolKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Tool call location.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallLocation {
    pub path: String,
}

/// Tool call status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

/// Skill metadata for skill tool calls.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

/// A single file edit entry within an Edit tool call.
///
/// A single `Edit` tool call may touch multiple files (e.g., OpenCode's `patch` tool
/// or Codex's multi-entry `changes` map). Each entry represents one file's change.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditEntry {
    /// Path of the file being edited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// Original path when the edit entry represents a rename/move inside a multi-file edit patch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_from: Option<String>,
    /// Text being replaced (None = new file or full-file write).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_string: Option<String>,
    /// Replacement text (standard edit).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_string: Option<String>,
    /// Full file content (create/overwrite variant).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// Tool arguments discriminated by tool kind.
/// Each variant contains exactly the fields needed for that tool type.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ToolArguments {
    Read {
        #[serde(skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
    },
    /// Edit tool arguments.
    ///
    /// `edits` is always a non-empty Vec. Single-file edits have exactly one entry;
    /// multi-file edits (OpenCode `patch`, Codex multi-entry `changes` map) have N entries.
    Edit {
        edits: Vec<EditEntry>,
    },
    Execute {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
    },
    Search {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
    },
    Glob {
        #[serde(skip_serializing_if = "Option::is_none")]
        pattern: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Fetch {
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    WebSearch {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
    },
    Think {
        /// For generic think tools (description = main content)
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        /// For subagent/task tools (distinct from description)
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        subagent_type: Option<String>,
        /// For skill tools
        #[serde(skip_serializing_if = "Option::is_none")]
        skill: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        skill_args: Option<String>,
        /// For todo/question tools - preserved as raw
        #[serde(skip_serializing_if = "Option::is_none")]
        raw: Option<serde_json::Value>,
    },
    TaskOutput {
        #[serde(skip_serializing_if = "Option::is_none")]
        task_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
    Move {
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
    Delete {
        #[serde(skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_paths: Option<Vec<String>>,
    },
    PlanMode {
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    ToolSearch {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_results: Option<u64>,
    },
    Browser {
        raw: serde_json::Value,
    },
    Other {
        raw: serde_json::Value,
    },
}

impl ToolArguments {
    /// Construct typed arguments from a raw JSON value and a known tool kind.
    pub fn from_raw(kind: ToolKind, raw: serde_json::Value) -> Self {
        use crate::acp::parsers::arguments::parse_tool_kind_arguments;
        parse_tool_kind_arguments(kind, &raw)
    }

    /// Return canonical tool kind represented by this typed argument payload.
    pub fn tool_kind(&self) -> ToolKind {
        match self {
            ToolArguments::Read { .. } => ToolKind::Read,
            ToolArguments::Edit { .. } => ToolKind::Edit,
            ToolArguments::Execute { .. } => ToolKind::Execute,
            ToolArguments::Search { .. } => ToolKind::Search,
            ToolArguments::Glob { .. } => ToolKind::Glob,
            ToolArguments::Fetch { .. } => ToolKind::Fetch,
            ToolArguments::WebSearch { .. } => ToolKind::WebSearch,
            ToolArguments::Think { .. } => ToolKind::Think,
            ToolArguments::TaskOutput { .. } => ToolKind::TaskOutput,
            ToolArguments::Move { .. } => ToolKind::Move,
            ToolArguments::Delete { .. } => ToolKind::Delete,
            ToolArguments::PlanMode { .. } => ToolKind::Other,
            ToolArguments::ToolSearch { .. } => ToolKind::ToolSearch,
            ToolArguments::Browser { .. } => ToolKind::Browser,
            ToolArguments::Other { .. } => ToolKind::Other,
        }
    }
}

/// Tool call data.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallData {
    pub id: String,
    pub name: String,
    pub arguments: ToolArguments,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<serde_json::Value>,
    pub status: ToolCallStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<ToolKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<ToolCallLocation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_meta: Option<SkillMeta>,
    /// Normalized questions extracted from question tool calls.
    /// This provides a unified format for questions across all agents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_questions: Option<Vec<QuestionItem>>,
    /// Normalized todos extracted from TodoWrite tool calls.
    /// This provides a unified format for todos across all agents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_todos: Option<Vec<TodoItem>>,
    /// Parent task ID for nested tool calls.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    /// Child tool calls belonging to this task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_children: Option<Vec<ToolCallData>>,
    /// Answered question data (questions + user's answers).
    /// Present when this is a question tool call that has been answered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question_answer: Option<crate::session_jsonl::types::QuestionAnswer>,
    /// Whether this tool call is awaiting plan approval from the user.
    /// Set on `cursor/create_plan` tool calls; the user must approve or reject before the agent continues.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub awaiting_plan_approval: bool,
    /// JSON-RPC request ID to use when responding to plan approval.
    /// Present when `awaiting_plan_approval` is true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_approval_request_id: Option<u64>,
}

fn unwrap_serialized_other_arguments(arguments: &serde_json::Value) -> serde_json::Value {
    let Some(object) = arguments.as_object() else {
        return arguments.clone();
    };

    let wrapper_kind = object.get("kind").and_then(|value| value.as_str());
    let wrapped_raw = object.get("raw");

    if wrapper_kind == Some("other") {
        return wrapped_raw.cloned().unwrap_or_else(|| arguments.clone());
    }

    arguments.clone()
}

// Custom deserialization to handle arguments based on tool kind
impl<'de> serde::Deserialize<'de> for ToolCallData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Deserialize to intermediate struct with raw arguments
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Raw {
            id: String,
            name: String,
            arguments: serde_json::Value,
            raw_input: Option<serde_json::Value>,
            status: ToolCallStatus,
            kind: Option<ToolKind>,
            result: Option<serde_json::Value>,
            title: Option<String>,
            locations: Option<Vec<ToolCallLocation>>,
            skill_meta: Option<SkillMeta>,
            normalized_questions: Option<Vec<QuestionItem>>,
            normalized_todos: Option<Vec<TodoItem>>,
            parent_tool_use_id: Option<String>,
            task_children: Option<Vec<ToolCallData>>,
            question_answer: Option<crate::session_jsonl::types::QuestionAnswer>,
            #[serde(default)]
            awaiting_plan_approval: bool,
            plan_approval_request_id: Option<u64>,
        }

        let raw = Raw::deserialize(deserializer)?;
        let normalized_arguments = unwrap_serialized_other_arguments(&raw.arguments);
        let agent = deserialize_agent_context::<D::Error>()?;
        let classification_hints = ToolClassificationHints {
            name: Some(&raw.name),
            title: raw.title.as_deref(),
            kind: raw.kind,
            kind_hint: raw.kind.map(|kind| kind.as_str()),
            locations: raw.locations.as_deref(),
        };
        let classified_from_arguments = classify_serialized_tool_call(
            agent,
            &raw.id,
            &normalized_arguments,
            classification_hints,
        );
        let classified_from_raw = raw
            .raw_input
            .as_ref()
            .map(|raw_input| {
                classify_serialized_tool_call(agent, &raw.id, raw_input, classification_hints)
            })
            .filter(|classified| classified.kind != ToolKind::Other);
        let use_raw_input = classified_from_raw.is_some();
        let classified = classified_from_raw.unwrap_or(classified_from_arguments);
        let kind = classified.kind;
        let name = classified.name;
        let arguments = classified.arguments;
        let normalized_source = if use_raw_input {
            raw.raw_input.clone().unwrap_or(normalized_arguments)
        } else {
            normalized_arguments
        };

        let (derived_questions, derived_todos) =
            derive_normalized_questions_and_todos(&name, &normalized_source, agent);
        let normalized_questions = raw.normalized_questions.or(derived_questions);
        let normalized_todos = raw.normalized_todos.or(derived_todos);

        Ok(ToolCallData {
            id: raw.id,
            name,
            arguments,
            raw_input: raw.raw_input,
            status: raw.status,
            kind: Some(kind),
            result: raw.result,
            title: raw.title,
            locations: raw.locations,
            skill_meta: raw.skill_meta,
            normalized_questions,
            normalized_todos,
            parent_tool_use_id: raw.parent_tool_use_id,
            task_children: raw.task_children,
            question_answer: raw.question_answer,
            awaiting_plan_approval: raw.awaiting_plan_approval,
            plan_approval_request_id: raw.plan_approval_request_id,
        })
    }
}

fn deserialize_agent_context<E>() -> Result<AgentType, E>
where
    E: serde::de::Error,
{
    current_agent().ok_or_else(|| {
        serde::de::Error::custom("Missing agent context for ToolCallData deserialization")
    })
}

/// Tool call update data.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdateData {
    pub tool_call_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ToolCallStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<crate::acp::types::ContentBlock>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<ToolCallLocation>>,
    /// Streaming input delta - partial JSON string for progressive tool input display.
    /// Extracted from _meta.claudeCode.streamingInputDelta.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming_input_delta: Option<String>,

    /// Progressive normalized todos from streaming input.
    /// Populated by the streaming accumulator for TodoWrite-like tools.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_todos: Option<Vec<TodoItem>>,

    /// Progressive normalized questions from streaming input.
    /// Populated by the streaming accumulator for AskUserQuestion-like tools.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_questions: Option<Vec<QuestionItem>>,

    /// Pre-parsed streaming arguments for progressive tool input display.
    /// Produced by the streaming accumulator when partial JSON parse succeeds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming_arguments: Option<ToolArguments>,

    /// Streaming plan data from Edit/Write tools writing to plan files.
    /// Used to emit Plan events for live plan streaming.
    #[serde(skip)]
    pub streaming_plan: Option<super::PlanData>,

    /// Typed tool arguments from rawInput in tool_call_update.
    /// Upstream v0.18+ sends rawInput in the update, not the initial tool_call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<ToolArguments>,

    /// Human-readable reason when status is `Failed`.
    /// Distinguishes user-denied permissions ("Permission denied by user")
    /// from actual runtime failures without changing the status enum.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}
