//! Type definitions for the Claude Code SDK
//!
//! This module contains all the core types used throughout the SDK,
//! including messages, configuration options, and content blocks.
//!
//! Types are organized into sub-modules by domain, and re-exported here so
//! external callers continue to use `crate::cc_sdk::types::X` paths.

#![allow(missing_docs)]

mod effort;
mod hooks;
mod mcp;
mod messages;
mod options;
mod permission;
mod rate_limit;
mod sandbox;
mod sdk_config;
mod sdk_control;

#[cfg(test)]
mod tests;

pub use effort::Effort;
pub use hooks::{
    AgentDefinition, AsyncHookJSONOutput, BaseHookInput, HookCallback, HookContext, HookInput,
    HookJSONOutput, HookMatcher, HookSpecificOutput, NotificationHookInput,
    NotificationHookSpecificOutput, PermissionRequestHookInput,
    PermissionRequestHookSpecificOutput, PostToolUseFailureHookInput,
    PostToolUseFailureHookSpecificOutput, PostToolUseHookInput, PostToolUseHookSpecificOutput,
    PreCompactHookInput, PreToolUseHookInput, PreToolUseHookSpecificOutput,
    SessionStartHookSpecificOutput, SettingSource, StopHookInput, SubagentStartHookInput,
    SubagentStartHookSpecificOutput, SubagentStopHookInput, SyncHookJSONOutput, SystemPrompt,
    UserPromptSubmitHookInput, UserPromptSubmitHookSpecificOutput,
};
pub use mcp::{
    McpConnectionStatus, McpServerConfig, McpServerInfo, McpServerStatus, McpToolAnnotations,
    McpToolInfo, ThinkingConfig,
};
pub use messages::{
    AssistantContent, AssistantMessage, ContentBlock, ContentValue, Message, ResultMessage,
    SystemMessage, TaskNotificationMessage, TaskProgressMessage, TaskStartedMessage, TaskStatus,
    TaskUsage, TextContent, ThinkingContent, ToolResultContent, ToolUseContent, UserContent,
    UserMessage,
};
pub use options::{ClaudeCodeOptions, ClaudeCodeOptionsBuilder};
pub use permission::{
    CanUseTool, PermissionBehavior, PermissionMode, PermissionResult, PermissionResultAllow,
    PermissionResultDeny, PermissionRuleValue, PermissionUpdate, PermissionUpdateDestination,
    PermissionUpdateType, ToolPermissionContext,
};
pub use rate_limit::{RateLimitInfo, RateLimitStatus, RateLimitType};
pub use sandbox::{SandboxIgnoreViolations, SandboxNetworkConfig, SandboxSettings};
pub use sdk_config::{
    AssistantMessageError, ControlProtocolFormat, SdkBeta, SdkPluginConfig, ToolsConfig,
    ToolsPreset,
};
pub use sdk_control::{
    ControlRequest, ControlResponse, SDKControlInitializeRequest, SDKControlInterruptRequest,
    SDKControlMcpMessageRequest, SDKControlPermissionRequest, SDKControlRequest,
    SDKControlRewindFilesRequest, SDKControlSetModelRequest, SDKControlSetPermissionModeRequest,
    SDKHookCallbackRequest,
};
