use crate::terminal::types::EnvVariable;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FsReadTextFileParamsRaw {
    pub session_id: Option<String>,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FsWriteTextFileParamsRaw {
    pub session_id: Option<String>,
    pub path: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TerminalRequestParamsRaw {
    pub session_id: Option<String>,
    pub terminal_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TerminalCreateParamsRaw {
    pub session_id: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Vec<EnvVariable>,
    #[serde(default)]
    pub output_byte_limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionRequestPermissionParamsRaw {
    pub session_id: Option<String>,
    pub tool_call: Option<PermissionToolCallRaw>,
    #[serde(default)]
    pub options: Vec<PermissionOptionRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PermissionToolCallRaw {
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub kind: Option<String>,
    #[serde(default)]
    pub raw_input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PermissionOptionRaw {
    pub kind: Option<String>,
    pub option_id: Option<String>,
}
