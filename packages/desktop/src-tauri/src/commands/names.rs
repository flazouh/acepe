/// Shared command name constants.
/// These are exported to TypeScript via specta to ensure type safety.
use serde::Serialize;

macro_rules! define_command_group {
    ($struct_name:ident, $const_name:ident, $($field:ident : $command:ident),* $(,)?) => {
        #[derive(Debug, Clone, Serialize, specta::Type)]
        #[serde(rename_all = "snake_case")]
        #[allow(dead_code)]
        pub struct $struct_name {
            $(
                pub $field: &'static str,
            )*
        }

        #[allow(dead_code)]
        pub const $const_name: $struct_name = $struct_name {
            $(
                $field: stringify!($command),
            )*
        };
    };
}

crate::acp_command_entries!(define_command_group, AcpCommands, ACP_COMMANDS);
crate::fs_command_entries!(define_command_group, FsCommands, FS_COMMANDS);
crate::history_command_entries!(define_command_group, HistoryCommands, HISTORY_COMMANDS);
crate::cursor_history_command_entries!(
    define_command_group,
    CursorHistoryCommands,
    CURSOR_HISTORY_COMMANDS
);
crate::opencode_history_command_entries!(
    define_command_group,
    OpenCodeHistoryCommands,
    OPENCODE_HISTORY_COMMANDS
);
crate::storage_command_entries!(define_command_group, StorageCommands, STORAGE_COMMANDS);
crate::file_index_command_entries!(define_command_group, FileIndexCommands, FILE_INDEX_COMMANDS);
crate::terminal_command_entries!(define_command_group, TerminalCommands, TERMINAL_COMMANDS);
crate::git_command_entries!(define_command_group, GitCommands, GIT_COMMANDS);
crate::checkpoint_command_entries!(
    define_command_group,
    CheckpointCommands,
    CHECKPOINT_COMMANDS
);
crate::skills_command_entries!(define_command_group, SkillsCommands, SKILLS_COMMANDS);
crate::sql_studio_command_entries!(define_command_group, SqlStudioCommands, SQL_STUDIO_COMMANDS);
crate::github_command_entries!(define_command_group, GitHubCommands, GITHUB_COMMANDS);
crate::browser_webview_command_entries!(
    define_command_group,
    BrowserWebviewCommands,
    BROWSER_WEBVIEW_COMMANDS
);
crate::voice_command_entries!(define_command_group, VoiceCommands, VOICE_COMMANDS);
crate::window_command_entries!(define_command_group, WindowCommands, WINDOW_COMMANDS);
/// All command name constants grouped by category.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct Commands {
    pub acp: AcpCommands,
    pub fs: FsCommands,
    pub history: HistoryCommands,
    pub cursor_history: CursorHistoryCommands,
    pub opencode_history: OpenCodeHistoryCommands,
    pub storage: StorageCommands,
    pub file_index: FileIndexCommands,
    pub terminal: TerminalCommands,
    pub git: GitCommands,
    pub checkpoint: CheckpointCommands,
    pub skills: SkillsCommands,
    pub sql_studio: SqlStudioCommands,
    pub github: GitHubCommands,
    pub browser_webview: BrowserWebviewCommands,
    pub voice: VoiceCommands,
    pub window: WindowCommands,
}

#[allow(dead_code)]
pub const COMMANDS: Commands = Commands {
    acp: ACP_COMMANDS,
    fs: FS_COMMANDS,
    history: HISTORY_COMMANDS,
    cursor_history: CURSOR_HISTORY_COMMANDS,
    opencode_history: OPENCODE_HISTORY_COMMANDS,
    storage: STORAGE_COMMANDS,
    file_index: FILE_INDEX_COMMANDS,
    terminal: TERMINAL_COMMANDS,
    git: GIT_COMMANDS,
    checkpoint: CHECKPOINT_COMMANDS,
    skills: SKILLS_COMMANDS,
    sql_studio: SQL_STUDIO_COMMANDS,
    github: GITHUB_COMMANDS,
    browser_webview: BROWSER_WEBVIEW_COMMANDS,
    voice: VOICE_COMMANDS,
    window: WINDOW_COMMANDS,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn render_client_value(
        output: &mut String,
        value: &serde_json::Value,
        path: &str,
        indent: usize,
    ) {
        match value {
            serde_json::Value::Object(entries) => {
                output.push_str("{\n");
                let mut first = true;
                for (key, entry_value) in entries {
                    if !first {
                        output.push('\n');
                    }
                    first = false;
                    output.push_str(&" ".repeat(indent + 2));
                    output.push_str(key);
                    output.push_str(": ");

                    match entry_value {
                        serde_json::Value::String(_) => {
                            output.push_str(&format!("createGeneratedCommand({path}.{key})"));
                        }
                        serde_json::Value::Object(_) => {
                            render_client_value(
                                output,
                                entry_value,
                                &format!("{path}.{key}"),
                                indent + 2,
                            );
                        }
                        _ => panic!("Unsupported command registry shape for client generation"),
                    }

                    output.push(',');
                }
                output.push('\n');
                output.push_str(&" ".repeat(indent));
                output.push('}');
            }
            _ => panic!("Unsupported command registry shape for client generation"),
        }
    }

    #[test]
    fn export_bindings() {
        specta_typescript::export::<Commands>(&Default::default())
            .expect("Failed to export Commands");
        specta_typescript::export::<AcpCommands>(&Default::default())
            .expect("Failed to export AcpCommands");
        specta_typescript::export::<FsCommands>(&Default::default())
            .expect("Failed to export FsCommands");
        specta_typescript::export::<HistoryCommands>(&Default::default())
            .expect("Failed to export HistoryCommands");
        specta_typescript::export::<CursorHistoryCommands>(&Default::default())
            .expect("Failed to export CursorHistoryCommands");
        specta_typescript::export::<OpenCodeHistoryCommands>(&Default::default())
            .expect("Failed to export OpenCodeHistoryCommands");
        specta_typescript::export::<StorageCommands>(&Default::default())
            .expect("Failed to export StorageCommands");
        specta_typescript::export::<FileIndexCommands>(&Default::default())
            .expect("Failed to export FileIndexCommands");
        specta_typescript::export::<TerminalCommands>(&Default::default())
            .expect("Failed to export TerminalCommands");
        specta_typescript::export::<GitCommands>(&Default::default())
            .expect("Failed to export GitCommands");
        specta_typescript::export::<CheckpointCommands>(&Default::default())
            .expect("Failed to export CheckpointCommands");
        specta_typescript::export::<SkillsCommands>(&Default::default())
            .expect("Failed to export SkillsCommands");
        specta_typescript::export::<SqlStudioCommands>(&Default::default())
            .expect("Failed to export SqlStudioCommands");
        specta_typescript::export::<GitHubCommands>(&Default::default())
            .expect("Failed to export GitHubCommands");
        specta_typescript::export::<BrowserWebviewCommands>(&Default::default())
            .expect("Failed to export BrowserWebviewCommands");
        specta_typescript::export::<VoiceCommands>(&Default::default())
            .expect("Failed to export VoiceCommands");
        specta_typescript::export::<WindowCommands>(&Default::default())
            .expect("Failed to export WindowCommands");
    }

    #[test]
    fn export_command_values() {
        use std::fs;
        use std::path::Path;

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let command_names_path =
            Path::new(manifest_dir).join("../src/lib/services/command-names.ts");
        let command_client_path =
            Path::new(manifest_dir).join("../src/lib/services/tauri-command-client.ts");

        let mut output = String::from(
            "// This file was generated from Rust command metadata. Do not edit this file manually.\n\n",
        );

        let json =
            serde_json::to_string_pretty(&COMMANDS).expect("Failed to serialize command names");
        output.push_str(&format!("export const COMMANDS = {} as const;\n\n", json));
        output.push_str("export type Commands = typeof COMMANDS;\n");
        output.push_str("export type AcpCommands = Commands[\"acp\"];\n");
        output.push_str("export type FsCommands = Commands[\"fs\"];\n");
        output.push_str("export type HistoryCommands = Commands[\"history\"];\n");
        output.push_str("export type CursorHistoryCommands = Commands[\"cursor_history\"];\n");
        output.push_str("export type OpenCodeHistoryCommands = Commands[\"opencode_history\"];\n");
        output.push_str("export type StorageCommands = Commands[\"storage\"];\n");
        output.push_str("export type FileIndexCommands = Commands[\"file_index\"];\n");
        output.push_str("export type TerminalCommands = Commands[\"terminal\"];\n");
        output.push_str("export type GitCommands = Commands[\"git\"];\n");
        output.push_str("export type CheckpointCommands = Commands[\"checkpoint\"];\n");
        output.push_str("export type SkillsCommands = Commands[\"skills\"];\n");
        output.push_str("export type SqlStudioCommands = Commands[\"sql_studio\"];\n");
        output.push_str("export type GitHubCommands = Commands[\"github\"];\n");
        output.push_str("export type BrowserWebviewCommands = Commands[\"browser_webview\"];\n");
        output.push_str("export type VoiceCommands = Commands[\"voice\"];\n");
        output.push_str("export type WindowCommands = Commands[\"window\"];\n");

        fs::write(&command_names_path, output).expect("Failed to write command-names.ts");

        let mut client_output = String::from(
            "// This file was generated from Rust command metadata. Do not edit this file manually.\n\n",
        );
        client_output.push_str(
            "import { createGeneratedCommand } from \"../utils/tauri-client/invoke.js\";\n",
        );
        client_output.push_str("import { COMMANDS } from \"./command-names.js\";\n\n");
        client_output.push_str("export const TAURI_COMMAND_CLIENT = ");
        let value =
            serde_json::to_value(&COMMANDS).expect("Failed to convert command names to JSON");
        render_client_value(&mut client_output, &value, "COMMANDS", 0);
        client_output.push_str(" as const;\n");

        fs::write(&command_client_path, client_output)
            .expect("Failed to write tauri-command-client.ts");
        eprintln!(
            "Exported command names to {} and client to {}",
            command_names_path.display(),
            command_client_path.display()
        );
    }
}
