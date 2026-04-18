//! # Claude Code SDK — lower-level runtime authority
//!
//! `cc_sdk` is the single authoritative lower-level Claude runtime for this
//! codebase.  It owns the direct Rust ↔ Claude CLI communication layer.
//!
//! The production path is:
//!
//! ```text
//! ClaudeCcSdkClient (acp/client/cc_sdk_client.rs)
//!     -> ClaudeSDKClient  (this module)
//!     -> Claude CLI subprocess
//! ```
//!
//! All other paths (sidecar, WebSocket, optimised client variants) have been
//! removed.  Do not reintroduce a second lower-level runtime here.

/// CLI download and management utilities
pub mod cli_download;
mod client;
mod errors;
mod internal_query;
mod message_parser;
// sdk_mcp is private: used internally by internal_query only
mod sdk_mcp;
mod token_tracker;
pub mod transport;
mod types;

// Re-export the production-facing surface
pub use client::ClaudeSDKClient;
pub use errors::{Result, SdkError};
pub use types::{
    AgentDefinition,
    AssistantContent,
    AssistantMessage,
    AssistantMessageError,
    AsyncHookJSONOutput,
    // Hook Input types
    BaseHookInput,
    CanUseTool,
    ClaudeCodeOptions,
    ClaudeCodeOptionsBuilder,
    ContentBlock,
    ContentValue,
    ControlProtocolFormat,
    ControlRequest,
    ControlResponse,
    Effort,
    // Hook types
    HookCallback,
    HookContext,
    HookInput,
    // Hook Output types
    HookJSONOutput,
    HookMatcher,
    HookSpecificOutput,
    McpConnectionStatus,
    McpServerConfig,
    McpServerInfo,
    McpServerStatus,
    McpToolAnnotations,
    McpToolInfo,
    Message,
    NotificationHookInput,
    NotificationHookSpecificOutput,
    // Permission types
    PermissionBehavior,
    PermissionMode,
    PermissionRequestHookInput,
    PermissionRequestHookSpecificOutput,
    PermissionResult,
    PermissionResultAllow,
    PermissionResultDeny,
    PermissionRuleValue,
    PermissionUpdate,
    PermissionUpdateDestination,
    PermissionUpdateType,
    PostToolUseFailureHookInput,
    PostToolUseFailureHookSpecificOutput,
    PostToolUseHookInput,
    PostToolUseHookSpecificOutput,
    PreCompactHookInput,
    PreToolUseHookInput,
    PreToolUseHookSpecificOutput,
    RateLimitInfo,
    RateLimitStatus,
    RateLimitType,
    ResultMessage,
    // SDK Control Protocol types
    SDKControlInitializeRequest,
    SDKControlInterruptRequest,
    SDKControlMcpMessageRequest,
    SDKControlPermissionRequest,
    SDKControlRequest,
    SDKControlRewindFilesRequest,
    SDKControlSetPermissionModeRequest,
    SDKHookCallbackRequest,
    SandboxIgnoreViolations,
    SandboxNetworkConfig,
    SandboxSettings,
    SdkBeta,
    SdkPluginConfig,
    SessionStartHookSpecificOutput,
    SettingSource,
    StopHookInput,
    SubagentStartHookInput,
    SubagentStartHookSpecificOutput,
    SubagentStopHookInput,
    SyncHookJSONOutput,
    SystemMessage,
    SystemPrompt,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
    TaskStatus,
    TaskUsage,
    TextContent,
    ThinkingConfig,
    ThinkingContent,
    ToolPermissionContext,
    ToolResultContent,
    ToolUseContent,
    ToolsConfig,
    ToolsPreset,
    UserContent,
    UserMessage,
    UserPromptSubmitHookInput,
    UserPromptSubmitHookSpecificOutput,
};
