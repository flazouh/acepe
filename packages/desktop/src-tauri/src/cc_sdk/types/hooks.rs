//! Hook types: inputs, outputs, callback traits, matchers, setting source, agent definitions, system prompt.

#![allow(missing_docs)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Hook context
#[derive(Debug, Clone)]
pub struct HookContext {
    /// Abort signal (future support)
    pub signal: Option<Arc<dyn std::any::Any + Send + Sync>>,
}

// ============================================================================
// Hook Input Types (Strongly-typed hook inputs for type safety)
// ============================================================================

/// Base hook input fields present across many hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
}

/// Input data for PreToolUse hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreToolUseHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Name of the tool being used
    pub tool_name: String,
    /// Input parameters for the tool
    pub tool_input: serde_json::Value,
    /// Tool use ID
    pub tool_use_id: String,
    /// Agent ID (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Agent type (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

/// Input data for PostToolUse hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostToolUseHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Name of the tool that was used
    pub tool_name: String,
    /// Input parameters that were passed to the tool
    pub tool_input: serde_json::Value,
    /// Response from the tool execution
    pub tool_response: serde_json::Value,
    /// Tool use ID
    pub tool_use_id: String,
    /// Agent ID (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Agent type (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

/// Input data for UserPromptSubmit hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPromptSubmitHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// The prompt submitted by the user
    pub prompt: String,
}

/// Input data for Stop hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Whether stop hook is active
    pub stop_hook_active: bool,
}

/// Input data for SubagentStop hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentStopHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Whether stop hook is active
    pub stop_hook_active: bool,
    /// Agent ID
    pub agent_id: String,
    /// Path to the agent's transcript
    pub agent_transcript_path: String,
    /// Agent type
    pub agent_type: String,
}

/// Input data for PreCompact hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreCompactHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Trigger type: "manual" or "auto"
    pub trigger: String,
    /// Custom instructions for compaction (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
}

/// Input data for PostToolUseFailure hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostToolUseFailureHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Name of the tool that failed
    pub tool_name: String,
    /// Input parameters that were passed to the tool
    pub tool_input: serde_json::Value,
    /// Tool use ID
    pub tool_use_id: String,
    /// Error message from the tool
    pub error: String,
    /// Whether this failure was due to an interrupt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_interrupt: Option<bool>,
    /// Agent ID (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Agent type (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

/// Input data for Notification hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Notification message
    pub message: String,
    /// Notification title (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Notification type
    pub notification_type: String,
}

/// Input data for SubagentStart hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentStartHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Agent ID
    pub agent_id: String,
    /// Agent type
    pub agent_type: String,
}

/// Input data for PermissionRequest hook events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestHookInput {
    /// Session ID for this conversation
    pub session_id: String,
    /// Path to the transcript file
    pub transcript_path: String,
    /// Current working directory
    pub cwd: String,
    /// Permission mode (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// Name of the tool requesting permission
    pub tool_name: String,
    /// Input parameters for the tool
    pub tool_input: serde_json::Value,
    /// Permission suggestions (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_suggestions: Option<Vec<serde_json::Value>>,
    /// Agent ID (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Agent type (for subagent contexts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

/// Union type for all hook inputs (discriminated by hook_event_name)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "hook_event_name")]
pub enum HookInput {
    /// PreToolUse hook input
    #[serde(rename = "PreToolUse")]
    PreToolUse(PreToolUseHookInput),
    /// PostToolUse hook input
    #[serde(rename = "PostToolUse")]
    PostToolUse(PostToolUseHookInput),
    /// PostToolUseFailure hook input
    #[serde(rename = "PostToolUseFailure")]
    PostToolUseFailure(PostToolUseFailureHookInput),
    /// UserPromptSubmit hook input
    #[serde(rename = "UserPromptSubmit")]
    UserPromptSubmit(UserPromptSubmitHookInput),
    /// Stop hook input
    #[serde(rename = "Stop")]
    Stop(StopHookInput),
    /// SubagentStop hook input
    #[serde(rename = "SubagentStop")]
    SubagentStop(SubagentStopHookInput),
    /// PreCompact hook input
    #[serde(rename = "PreCompact")]
    PreCompact(PreCompactHookInput),
    /// Notification hook input
    #[serde(rename = "Notification")]
    Notification(NotificationHookInput),
    /// SubagentStart hook input
    #[serde(rename = "SubagentStart")]
    SubagentStart(SubagentStartHookInput),
    /// PermissionRequest hook input
    #[serde(rename = "PermissionRequest")]
    PermissionRequest(PermissionRequestHookInput),
}

// ============================================================================
// Hook Output Types (Strongly-typed hook outputs for type safety)
// ============================================================================

/// Async hook output for deferred execution
///
/// When a hook returns this output, the hook execution is deferred and
/// Claude continues without waiting for the hook to complete.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncHookJSONOutput {
    /// Must be true to indicate async execution
    #[serde(rename = "async")]
    pub async_: bool,
    /// Optional timeout in milliseconds for async operation
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "asyncTimeout")]
    pub async_timeout: Option<u32>,
}

/// Synchronous hook output with control and decision fields
///
/// This defines the structure for hook callbacks to control execution and provide
/// feedback to Claude.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncHookJSONOutput {
    // Common control fields
    /// Whether Claude should proceed after hook execution (default: true)
    #[serde(rename = "continue", skip_serializing_if = "Option::is_none")]
    pub continue_: Option<bool>,
    /// Hide stdout from transcript mode (default: false)
    #[serde(rename = "suppressOutput", skip_serializing_if = "Option::is_none")]
    pub suppress_output: Option<bool>,
    /// Message shown when continue is false
    #[serde(rename = "stopReason", skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,

    // Decision fields
    /// Set to "block" to indicate blocking behavior
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>, // "block" or "approve" (deprecated)
    /// Warning message displayed to the user
    #[serde(rename = "systemMessage", skip_serializing_if = "Option::is_none")]
    pub system_message: Option<String>,
    /// Feedback message for Claude about the decision
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,

    // Hook-specific outputs
    /// Event-specific controls (e.g., permissionDecision for PreToolUse)
    #[serde(rename = "hookSpecificOutput", skip_serializing_if = "Option::is_none")]
    pub hook_specific_output: Option<HookSpecificOutput>,
}

/// Union type for hook outputs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum HookJSONOutput {
    /// Async hook output (deferred execution)
    Async(AsyncHookJSONOutput),
    /// Sync hook output (immediate execution)
    Sync(SyncHookJSONOutput),
}

/// Hook-specific output for PreToolUse events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreToolUseHookSpecificOutput {
    /// Permission decision: "allow", "deny", or "ask"
    #[serde(rename = "permissionDecision", skip_serializing_if = "Option::is_none")]
    pub permission_decision: Option<String>,
    /// Reason for the permission decision
    #[serde(
        rename = "permissionDecisionReason",
        skip_serializing_if = "Option::is_none"
    )]
    pub permission_decision_reason: Option<String>,
    /// Updated input parameters for the tool
    #[serde(rename = "updatedInput", skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<serde_json::Value>,
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for PostToolUse events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostToolUseHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
    /// Updated MCP tool output
    #[serde(
        rename = "updatedMCPToolOutput",
        skip_serializing_if = "Option::is_none"
    )]
    pub updated_mcp_tool_output: Option<serde_json::Value>,
}

/// Hook-specific output for UserPromptSubmit events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPromptSubmitHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for SessionStart events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStartHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for PostToolUseFailure events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostToolUseFailureHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for Notification events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for SubagentStart events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentStartHookSpecificOutput {
    /// Additional context to provide to Claude
    #[serde(rename = "additionalContext", skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
}

/// Hook-specific output for PermissionRequest events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestHookSpecificOutput {
    /// Permission decision
    pub decision: serde_json::Value,
}

/// Union type for hook-specific outputs (discriminated by hookEventName)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "hookEventName")]
pub enum HookSpecificOutput {
    /// PreToolUse-specific output
    #[serde(rename = "PreToolUse")]
    PreToolUse(PreToolUseHookSpecificOutput),
    /// PostToolUse-specific output
    #[serde(rename = "PostToolUse")]
    PostToolUse(PostToolUseHookSpecificOutput),
    /// PostToolUseFailure-specific output
    #[serde(rename = "PostToolUseFailure")]
    PostToolUseFailure(PostToolUseFailureHookSpecificOutput),
    /// UserPromptSubmit-specific output
    #[serde(rename = "UserPromptSubmit")]
    UserPromptSubmit(UserPromptSubmitHookSpecificOutput),
    /// SessionStart-specific output
    #[serde(rename = "SessionStart")]
    SessionStart(SessionStartHookSpecificOutput),
    /// Notification-specific output
    #[serde(rename = "Notification")]
    Notification(NotificationHookSpecificOutput),
    /// SubagentStart-specific output
    #[serde(rename = "SubagentStart")]
    SubagentStart(SubagentStartHookSpecificOutput),
    /// PermissionRequest-specific output
    #[serde(rename = "PermissionRequest")]
    PermissionRequest(PermissionRequestHookSpecificOutput),
}

// ============================================================================
// Hook Callback Trait (Updated for strong typing)
// ============================================================================

/// Hook callback trait with strongly-typed inputs and outputs
///
/// This trait is used to implement custom hook callbacks that can intercept
/// and modify Claude's behavior at various points in the conversation.
#[async_trait]
pub trait HookCallback: Send + Sync {
    /// Execute the hook with strongly-typed input and output
    ///
    /// # Arguments
    ///
    /// * `input` - Strongly-typed hook input (discriminated union)
    /// * `tool_use_id` - Optional tool use identifier
    /// * `context` - Hook context with abort signal support
    ///
    /// # Returns
    ///
    /// A `HookJSONOutput` that controls Claude's behavior
    async fn execute(
        &self,
        input: &HookInput,
        tool_use_id: Option<&str>,
        context: &HookContext,
    ) -> Result<HookJSONOutput, super::super::errors::SdkError>;
}

/// Legacy hook callback trait for backward compatibility
///
/// This trait is deprecated and will be removed in v0.4.0.
/// Please migrate to the new `HookCallback` trait with strong typing.
#[deprecated(
    since = "0.3.0",
    note = "Use the new HookCallback trait with HookInput/HookJSONOutput instead"
)]
#[allow(dead_code)]
#[async_trait]
pub trait HookCallbackLegacy: Send + Sync {
    /// Execute the hook with JSON values (legacy)
    async fn execute_legacy(
        &self,
        input: &serde_json::Value,
        tool_use_id: Option<&str>,
        context: &HookContext,
    ) -> serde_json::Value;
}

/// Hook matcher configuration
#[derive(Clone)]
pub struct HookMatcher {
    /// Matcher criteria
    pub matcher: Option<serde_json::Value>,
    /// Callbacks to invoke
    pub hooks: Vec<Arc<dyn HookCallback>>,
}

/// Setting source for configuration loading
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingSource {
    /// User-level settings
    User,
    /// Project-level settings
    Project,
    /// Local settings
    Local,
}

/// Agent definition for programmatic agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    /// Agent description
    pub description: String,
    /// Agent prompt
    pub prompt: String,
    /// Allowed tools for this agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    /// Model to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Skills available to this agent
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    /// Memory configuration
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    /// MCP server configurations for this agent
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "mcpServers"
    )]
    pub mcp_servers: Option<Vec<serde_json::Value>>,
}

/// System prompt configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SystemPrompt {
    /// Simple string prompt
    String(String),
    /// Preset-based prompt with optional append
    Preset {
        #[serde(rename = "type")]
        preset_type: String, // "preset"
        preset: String, // e.g., "claude_code"
        #[serde(skip_serializing_if = "Option::is_none")]
        append: Option<String>,
    },
}
