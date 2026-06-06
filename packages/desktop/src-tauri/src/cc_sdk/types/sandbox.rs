//! Sandbox configuration.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Network configuration for sandbox
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxNetworkConfig {
    /// Unix socket paths accessible in sandbox (e.g., SSH agents)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_unix_sockets: Option<Vec<String>>,
    /// Allow all Unix sockets (less secure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_all_unix_sockets: Option<bool>,
    /// Allow binding to localhost ports (macOS only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_local_binding: Option<bool>,
    /// HTTP proxy port if bringing your own proxy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_proxy_port: Option<u16>,
    /// SOCKS5 proxy port if bringing your own proxy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub socks_proxy_port: Option<u16>,
}

/// Violations to ignore in sandbox
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxIgnoreViolations {
    /// File paths for which violations should be ignored
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<Vec<String>>,
    /// Network hosts for which violations should be ignored
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<Vec<String>>,
}

/// Sandbox settings configuration
///
/// Controls how Claude Code sandboxes bash commands for filesystem
/// and network isolation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSettings {
    /// Enable bash sandboxing (macOS/Linux only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Auto-approve bash commands when sandboxed (default: true)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_allow_bash_if_sandboxed: Option<bool>,
    /// Commands that should run outside the sandbox (e.g., ["git", "docker"])
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_commands: Option<Vec<String>>,
    /// Allow commands to bypass sandbox via dangerouslyDisableSandbox
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_unsandboxed_commands: Option<bool>,
    /// Network configuration for sandbox
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<SandboxNetworkConfig>,
    /// Violations to ignore
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_violations: Option<SandboxIgnoreViolations>,
    /// Enable weaker sandbox for unprivileged Docker environments (Linux only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_weaker_nested_sandbox: Option<bool>,
}
