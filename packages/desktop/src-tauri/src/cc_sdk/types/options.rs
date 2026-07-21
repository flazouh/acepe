//! ClaudeCodeOptions and ClaudeCodeOptionsBuilder.

#![allow(missing_docs)]

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::effort::Effort;
use super::hooks::{AgentDefinition, HookMatcher, SettingSource, SystemPrompt};
use super::mcp::{McpServerConfig, ThinkingConfig};
use super::permission::{CanUseTool, PermissionMode};
use super::sandbox::SandboxSettings;
use super::sdk_config::{ControlProtocolFormat, SdkBeta, SdkPluginConfig, ToolsConfig};

/// Configuration options for Claude Code SDK
#[derive(Clone, Default)]
pub struct ClaudeCodeOptions {
    /// System prompt configuration (simplified in v0.1.12+)
    /// Can be either a string or a preset configuration
    /// Replaces the old system_prompt and append_system_prompt fields
    pub system_prompt_v2: Option<SystemPrompt>,
    /// [DEPRECATED] System prompt to prepend to all messages
    /// Use system_prompt_v2 instead
    #[deprecated(since = "0.1.12", note = "Use system_prompt_v2 instead")]
    pub system_prompt: Option<String>,
    /// [DEPRECATED] Additional system prompt to append
    /// Use system_prompt_v2 instead
    #[deprecated(since = "0.1.12", note = "Use system_prompt_v2 instead")]
    pub append_system_prompt: Option<String>,
    /// List of allowed tools (auto-approval permissions only)
    ///
    /// **IMPORTANT**: This only controls which tool invocations are auto-approved
    /// (bypass permission prompts). It does NOT disable or restrict which tools
    /// the AI can use. Use `disallowed_tools` to completely disable tools.
    ///
    /// Example: `allowed_tools: vec!["Bash(git:*)".to_string()]` allows auto-approval
    /// for git commands in Bash, but doesn't prevent AI from using other tools.
    pub allowed_tools: Vec<String>,
    /// List of disallowed tools (completely disabled)
    ///
    /// **IMPORTANT**: This completely disables the specified tools. The AI will
    /// not be able to use these tools at all. Use this to restrict which tools
    /// the AI has access to.
    ///
    /// Example: `disallowed_tools: vec!["Bash".to_string(), "WebSearch".to_string()]`
    /// prevents the AI from using Bash or WebSearch tools entirely.
    pub disallowed_tools: Vec<String>,
    /// Permission mode for tool execution
    pub permission_mode: PermissionMode,
    /// MCP server configurations
    pub mcp_servers: HashMap<String, McpServerConfig>,
    /// MCP tools to enable
    pub mcp_tools: Vec<String>,
    /// Maximum number of conversation turns
    pub max_turns: Option<i32>,
    /// Maximum thinking tokens
    pub max_thinking_tokens: Option<i32>,
    /// Maximum output tokens per response (1-32000, overrides CLAUDE_CODE_MAX_OUTPUT_TOKENS env var)
    pub max_output_tokens: Option<u32>,
    /// Model to use
    pub model: Option<String>,
    /// Working directory
    pub cwd: Option<PathBuf>,
    /// Continue from previous conversation
    pub continue_conversation: bool,
    /// Resume from a specific conversation ID
    pub resume: Option<String>,
    /// Custom permission prompt tool name
    pub permission_prompt_tool_name: Option<String>,
    /// Settings file path for Claude Code CLI
    pub settings: Option<String>,
    /// Additional directories to add as working directories
    pub add_dirs: Vec<PathBuf>,
    /// Extra arbitrary CLI flags
    pub extra_args: HashMap<String, Option<String>>,
    /// Environment variables to pass to the process
    pub env: HashMap<String, String>,
    /// Debug output stream (e.g., stderr)
    pub debug_stderr: Option<Arc<Mutex<dyn Write + Send + Sync>>>,
    /// Include partial assistant messages in streaming output
    pub include_partial_messages: bool,
    /// Tool permission callback
    pub can_use_tool: Option<Arc<dyn CanUseTool>>,
    /// Hook configurations
    pub hooks: Option<HashMap<String, Vec<HookMatcher>>>,
    /// Control protocol format (defaults to Legacy for compatibility)
    pub control_protocol_format: ControlProtocolFormat,

    // ========== Phase 2 Enhancements ==========
    /// Setting sources to load (user, project, local)
    /// When None, no filesystem settings are loaded (matches Python SDK v0.1.0 behavior)
    pub setting_sources: Option<Vec<SettingSource>>,
    /// Fork session when resuming instead of continuing
    /// When true, creates a new branch from the resumed session
    pub fork_session: bool,
    /// Programmatic agent definitions
    /// Define agents inline without filesystem dependencies
    pub agents: Option<HashMap<String, AgentDefinition>>,
    /// CLI channel buffer size for internal communication channels
    /// Controls the size of message, control, and stdin buffers (default: 100)
    /// Increase for high-throughput scenarios to prevent message lag
    pub cli_channel_buffer_size: Option<usize>,

    // ========== Phase 3 Enhancements (Python SDK v0.1.12+ sync) ==========
    /// Tools configuration for controlling available tools
    ///
    /// This controls the base set of tools available to Claude, distinct from
    /// `allowed_tools` which only controls auto-approval permissions.
    ///
    /// # Examples
    /// ```rust
    /// use acepe_lib::cc_sdk::{ClaudeCodeOptions, ToolsConfig};
    ///
    /// // Enable specific tools only
    /// let options = ClaudeCodeOptions::builder()
    ///     .tools(ToolsConfig::list(vec!["Read".into(), "Edit".into()]))
    ///     .build();
    ///
    /// // Disable all built-in tools
    /// let options = ClaudeCodeOptions::builder()
    ///     .tools(ToolsConfig::none())
    ///     .build();
    ///
    /// // Use claude_code preset
    /// let options = ClaudeCodeOptions::builder()
    ///     .tools(ToolsConfig::claude_code_preset())
    ///     .build();
    /// ```
    pub tools: Option<ToolsConfig>,
    /// SDK beta features to enable
    /// See https://docs.anthropic.com/en/api/beta-headers
    pub betas: Vec<SdkBeta>,
    /// Maximum spending limit in USD for the session
    /// When exceeded, the session will automatically terminate
    pub max_budget_usd: Option<f64>,
    /// Fallback model to use when primary model is unavailable
    pub fallback_model: Option<String>,
    /// Output format for structured outputs
    /// Example: `{"type": "json_schema", "schema": {"type": "object", "properties": {...}}}`
    pub output_format: Option<serde_json::Value>,
    /// Enable file checkpointing to track file changes during the session
    /// When enabled, files can be rewound to their state at any user message
    /// using `ClaudeSDKClient::rewind_files()`
    pub enable_file_checkpointing: bool,
    /// Sandbox configuration for bash command isolation
    /// Filesystem and network restrictions are derived from permission rules
    pub sandbox: Option<SandboxSettings>,
    /// Plugin configurations for custom plugins
    pub plugins: Vec<SdkPluginConfig>,
    /// Run the CLI subprocess as a specific OS user (Unix-only).
    ///
    /// This matches Python SDK behavior (`anyio.open_process(user=...)`).
    ///
    /// - Supported on Unix platforms only (non-Unix returns `SdkError::NotSupported`)
    /// - Typically requires elevated privileges to switch users
    /// - Accepts a username (e.g. `"nobody"`) or a numeric uid string (e.g. `"1000"`)
    pub user: Option<String>,
    /// Stderr callback (alternative to debug_stderr)
    /// Called with each line of stderr output from the CLI
    #[allow(clippy::type_complexity)]
    pub stderr_callback: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Deprecated compatibility flag.
    ///
    /// Acepe does not download Claude Code during runtime session creation.
    /// Provisioning is owned by the explicit managed agent install/repair flow.
    pub auto_download_cli: bool,

    // ========== v0.7.0 Enhancements (Python SDK parity) ==========
    /// Effort level for Claude's reasoning depth
    pub effort: Option<Effort>,
    /// Thinking configuration (replaces max_thinking_tokens)
    /// When set, takes priority over max_thinking_tokens
    pub thinking: Option<ThinkingConfig>,
    /// Session ID to use for conversations
    ///
    /// When set, this ID is used instead of the default "default" session identifier.
    /// This allows callers to control the session identity, which is important for
    /// resume/fork workflows and for aligning session IDs across different layers.
    ///
    /// If not set, falls back to "default" (preserving backward compatibility).
    pub session_id: Option<String>,
}

impl std::fmt::Debug for ClaudeCodeOptions {
    #[allow(deprecated)]
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClaudeCodeOptions")
            .field("system_prompt", &self.system_prompt)
            .field("append_system_prompt", &self.append_system_prompt)
            .field("allowed_tools", &self.allowed_tools)
            .field("disallowed_tools", &self.disallowed_tools)
            .field("permission_mode", &self.permission_mode)
            .field("mcp_servers", &self.mcp_servers)
            .field("mcp_tools", &self.mcp_tools)
            .field("max_turns", &self.max_turns)
            .field("max_thinking_tokens", &self.max_thinking_tokens)
            .field("max_output_tokens", &self.max_output_tokens)
            .field("model", &self.model)
            .field("cwd", &self.cwd)
            .field("continue_conversation", &self.continue_conversation)
            .field("resume", &self.resume)
            .field(
                "permission_prompt_tool_name",
                &self.permission_prompt_tool_name,
            )
            .field("settings", &self.settings)
            .field("add_dirs", &self.add_dirs)
            .field("extra_args", &self.extra_args)
            .field("env", &self.env)
            .field("debug_stderr", &self.debug_stderr.is_some())
            .field("include_partial_messages", &self.include_partial_messages)
            .field("can_use_tool", &self.can_use_tool.is_some())
            .field("hooks", &self.hooks.is_some())
            .field("control_protocol_format", &self.control_protocol_format)
            .field("effort", &self.effort)
            .field("thinking", &self.thinking)
            .field("session_id", &self.session_id)
            .finish()
    }
}

impl ClaudeCodeOptions {
    /// Create a new options builder
    pub fn builder() -> ClaudeCodeOptionsBuilder {
        ClaudeCodeOptionsBuilder::default()
    }
}

/// Builder for ClaudeCodeOptions
#[derive(Debug, Default)]
pub struct ClaudeCodeOptionsBuilder {
    options: ClaudeCodeOptions,
}

impl ClaudeCodeOptionsBuilder {
    /// Set system prompt
    #[allow(deprecated)]
    pub fn system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.options.system_prompt = Some(prompt.into());
        self
    }

    /// Set append system prompt
    #[allow(deprecated)]
    pub fn append_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.options.append_system_prompt = Some(prompt.into());
        self
    }

    /// Set allowed tools (auto-approval permissions only)
    ///
    /// **IMPORTANT**: This only controls which tool invocations bypass permission
    /// prompts. It does NOT disable or restrict which tools the AI can use.
    /// To completely disable tools, use `disallowed_tools()` instead.
    ///
    /// Example: `vec!["Bash(git:*)".to_string()]` auto-approves git commands.
    pub fn allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.options.allowed_tools = tools;
        self
    }

    /// Add a single allowed tool (auto-approval permission)
    ///
    /// See `allowed_tools()` for important usage notes.
    pub fn allow_tool(mut self, tool: impl Into<String>) -> Self {
        self.options.allowed_tools.push(tool.into());
        self
    }

    /// Set disallowed tools (completely disabled)
    ///
    /// **IMPORTANT**: This completely disables the specified tools. The AI will
    /// not be able to use these tools at all. This is the correct way to restrict
    /// which tools the AI has access to.
    ///
    /// Example: `vec!["Bash".to_string(), "WebSearch".to_string()]` prevents
    /// the AI from using Bash or WebSearch entirely.
    pub fn disallowed_tools(mut self, tools: Vec<String>) -> Self {
        self.options.disallowed_tools = tools;
        self
    }

    /// Add a single disallowed tool (completely disabled)
    ///
    /// See `disallowed_tools()` for important usage notes.
    pub fn disallow_tool(mut self, tool: impl Into<String>) -> Self {
        self.options.disallowed_tools.push(tool.into());
        self
    }

    /// Set permission mode
    pub fn permission_mode(mut self, mode: PermissionMode) -> Self {
        self.options.permission_mode = mode;
        self
    }

    /// Add MCP server
    pub fn add_mcp_server(mut self, name: impl Into<String>, config: McpServerConfig) -> Self {
        self.options.mcp_servers.insert(name.into(), config);
        self
    }

    /// Set all MCP servers from a map
    pub fn mcp_servers(mut self, servers: HashMap<String, McpServerConfig>) -> Self {
        self.options.mcp_servers = servers;
        self
    }

    /// Set MCP tools
    pub fn mcp_tools(mut self, tools: Vec<String>) -> Self {
        self.options.mcp_tools = tools;
        self
    }

    /// Set max turns
    pub fn max_turns(mut self, turns: i32) -> Self {
        self.options.max_turns = Some(turns);
        self
    }

    /// Set max thinking tokens
    pub fn max_thinking_tokens(mut self, tokens: i32) -> Self {
        self.options.max_thinking_tokens = Some(tokens);
        self
    }

    /// Set max output tokens (1-32000, overrides CLAUDE_CODE_MAX_OUTPUT_TOKENS env var)
    pub fn max_output_tokens(mut self, tokens: u32) -> Self {
        self.options.max_output_tokens = Some(tokens.clamp(1, 32000));
        self
    }

    /// Set model
    pub fn model(mut self, model: impl Into<String>) -> Self {
        self.options.model = Some(model.into());
        self
    }

    /// Set working directory
    pub fn cwd(mut self, path: impl Into<PathBuf>) -> Self {
        self.options.cwd = Some(path.into());
        self
    }

    /// Enable continue conversation
    pub fn continue_conversation(mut self, enable: bool) -> Self {
        self.options.continue_conversation = enable;
        self
    }

    /// Set resume conversation ID
    pub fn resume(mut self, id: impl Into<String>) -> Self {
        self.options.resume = Some(id.into());
        self
    }

    /// Set session ID for conversations
    ///
    /// When set, this ID is used instead of the default "default" session identifier.
    /// This allows callers to control the session identity used in messages sent to
    /// Claude Code CLI.
    pub fn session_id(mut self, id: impl Into<String>) -> Self {
        self.options.session_id = Some(id.into());
        self
    }

    /// Set permission prompt tool name
    pub fn permission_prompt_tool_name(mut self, name: impl Into<String>) -> Self {
        self.options.permission_prompt_tool_name = Some(name.into());
        self
    }

    /// Set settings file path
    pub fn settings(mut self, settings: impl Into<String>) -> Self {
        self.options.settings = Some(settings.into());
        self
    }

    /// Add directories as working directories
    pub fn add_dirs(mut self, dirs: Vec<PathBuf>) -> Self {
        self.options.add_dirs = dirs;
        self
    }

    /// Add a single directory as working directory
    pub fn add_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.options.add_dirs.push(dir.into());
        self
    }

    /// Add extra CLI arguments
    pub fn extra_args(mut self, args: HashMap<String, Option<String>>) -> Self {
        self.options.extra_args = args;
        self
    }

    /// Add a single extra CLI argument
    pub fn add_extra_arg(mut self, key: impl Into<String>, value: Option<String>) -> Self {
        self.options.extra_args.insert(key.into(), value);
        self
    }

    /// Set control protocol format
    pub fn control_protocol_format(mut self, format: ControlProtocolFormat) -> Self {
        self.options.control_protocol_format = format;
        self
    }

    /// Include partial assistant messages in streaming output
    pub fn include_partial_messages(mut self, include: bool) -> Self {
        self.options.include_partial_messages = include;
        self
    }

    /// Enable fork_session behavior
    pub fn fork_session(mut self, fork: bool) -> Self {
        self.options.fork_session = fork;
        self
    }

    /// Set setting sources
    pub fn setting_sources(mut self, sources: Vec<SettingSource>) -> Self {
        self.options.setting_sources = Some(sources);
        self
    }

    /// Define programmatic agents
    pub fn agents(mut self, agents: HashMap<String, AgentDefinition>) -> Self {
        self.options.agents = Some(agents);
        self
    }

    /// Set CLI channel buffer size
    ///
    /// Controls the size of internal communication channels (message, control, stdin buffers).
    /// Default is 100. Increase for high-throughput scenarios to prevent message lag.
    ///
    /// # Arguments
    ///
    /// * `size` - Buffer size (number of messages that can be queued)
    ///
    /// # Example
    ///
    /// ```rust
    /// # use acepe_lib::cc_sdk::ClaudeCodeOptions;
    /// let options = ClaudeCodeOptions::builder()
    ///     .cli_channel_buffer_size(500)
    ///     .build();
    /// ```
    pub fn cli_channel_buffer_size(mut self, size: usize) -> Self {
        self.options.cli_channel_buffer_size = Some(size);
        self
    }

    // ========== Phase 3 Builder Methods (Python SDK v0.1.12+ sync) ==========

    /// Set tools configuration
    ///
    /// Controls the base set of tools available to Claude. This is distinct from
    /// `allowed_tools` which only controls auto-approval permissions.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use acepe_lib::cc_sdk::{ClaudeCodeOptions, ToolsConfig};
    /// // Enable specific tools only
    /// let options = ClaudeCodeOptions::builder()
    ///     .tools(ToolsConfig::list(vec!["Read".into(), "Edit".into()]))
    ///     .build();
    /// ```
    pub fn tools(mut self, config: ToolsConfig) -> Self {
        self.options.tools = Some(config);
        self
    }

    /// Add SDK beta features
    ///
    /// Enable Anthropic API beta features like extended context window.
    pub fn betas(mut self, betas: Vec<SdkBeta>) -> Self {
        self.options.betas = betas;
        self
    }

    /// Add a single SDK beta feature
    pub fn add_beta(mut self, beta: SdkBeta) -> Self {
        self.options.betas.push(beta);
        self
    }

    /// Set maximum spending limit in USD
    ///
    /// When the budget is exceeded, the session will automatically terminate.
    pub fn max_budget_usd(mut self, budget: f64) -> Self {
        self.options.max_budget_usd = Some(budget);
        self
    }

    /// Set fallback model
    ///
    /// Used when the primary model is unavailable.
    pub fn fallback_model(mut self, model: impl Into<String>) -> Self {
        self.options.fallback_model = Some(model.into());
        self
    }

    /// Set output format for structured outputs
    ///
    /// Enables JSON schema validation for Claude's responses.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use acepe_lib::cc_sdk::ClaudeCodeOptions;
    /// let options = ClaudeCodeOptions::builder()
    ///     .output_format(serde_json::json!({
    ///         "type": "json_schema",
    ///         "schema": {
    ///             "type": "object",
    ///             "properties": {
    ///                 "answer": {"type": "string"}
    ///             }
    ///         }
    ///     }))
    ///     .build();
    /// ```
    pub fn output_format(mut self, format: serde_json::Value) -> Self {
        self.options.output_format = Some(format);
        self
    }

    /// Enable file checkpointing
    ///
    /// When enabled, file changes are tracked and can be rewound to any
    /// user message using `ClaudeSDKClient::rewind_files()`.
    pub fn enable_file_checkpointing(mut self, enable: bool) -> Self {
        self.options.enable_file_checkpointing = enable;
        self
    }

    /// Set sandbox configuration
    ///
    /// Controls bash command sandboxing for filesystem and network isolation.
    pub fn sandbox(mut self, settings: SandboxSettings) -> Self {
        self.options.sandbox = Some(settings);
        self
    }

    /// Set plugin configurations
    pub fn plugins(mut self, plugins: Vec<SdkPluginConfig>) -> Self {
        self.options.plugins = plugins;
        self
    }

    /// Add a single plugin
    pub fn add_plugin(mut self, plugin: SdkPluginConfig) -> Self {
        self.options.plugins.push(plugin);
        self
    }

    /// Set user identifier
    pub fn user(mut self, user: impl Into<String>) -> Self {
        self.options.user = Some(user.into());
        self
    }

    /// Set stderr callback
    ///
    /// Called with each line of stderr output from the CLI.
    pub fn stderr_callback(mut self, callback: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        self.options.stderr_callback = Some(callback);
        self
    }

    /// Deprecated compatibility setter.
    ///
    /// The value is preserved on [`ClaudeCodeOptions`] for callers that still set
    /// it, but transport creation ignores it. Use Acepe's managed agent
    /// install/repair flow to provision Claude Code.
    pub fn auto_download_cli(mut self, enable: bool) -> Self {
        self.options.auto_download_cli = enable;
        self
    }

    // ========== v0.7.0 Builder Methods (Python SDK parity) ==========

    /// Set effort level for Claude's reasoning depth
    ///
    /// # Example
    ///
    /// ```rust
    /// # use acepe_lib::cc_sdk::{ClaudeCodeOptions, Effort};
    /// let options = ClaudeCodeOptions::builder()
    ///     .effort(Effort::High)
    ///     .build();
    /// ```
    pub fn effort(mut self, effort: Effort) -> Self {
        self.options.effort = Some(effort);
        self
    }

    /// Set thinking configuration
    ///
    /// When set, takes priority over `max_thinking_tokens`.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use acepe_lib::cc_sdk::{ClaudeCodeOptions, ThinkingConfig};
    /// let options = ClaudeCodeOptions::builder()
    ///     .thinking(ThinkingConfig::Enabled { budget_tokens: 10000 })
    ///     .build();
    /// ```
    pub fn thinking(mut self, config: ThinkingConfig) -> Self {
        self.options.thinking = Some(config);
        self
    }

    /// Build the options
    pub fn build(self) -> ClaudeCodeOptions {
        self.options
    }
}
