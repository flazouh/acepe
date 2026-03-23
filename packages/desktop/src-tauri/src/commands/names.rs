/// Shared command name constants.
/// These are exported to TypeScript via specta to ensure type safety.
use serde::Serialize;

/// ACP (Agent Client Protocol) command names
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct AcpCommands {
    pub initialize: &'static str,
    pub new_session: &'static str,
    pub resume_session: &'static str,
    pub fork_session: &'static str,
    pub set_model: &'static str,
    pub set_mode: &'static str,
    pub send_prompt: &'static str,
    pub cancel: &'static str,
    pub list_agents: &'static str,
    pub install_agent: &'static str,
    pub uninstall_agent: &'static str,
    pub get_capabilities: &'static str,
}

#[allow(dead_code)]
pub const ACP_COMMANDS: AcpCommands = AcpCommands {
    initialize: "acp_initialize",
    new_session: "acp_new_session",
    resume_session: "acp_resume_session",
    fork_session: "acp_fork_session",
    set_model: "acp_set_model",
    set_mode: "acp_set_mode",
    send_prompt: "acp_send_prompt",
    cancel: "acp_cancel",
    list_agents: "acp_list_agents",
    install_agent: "acp_install_agent",
    uninstall_agent: "acp_uninstall_agent",
    get_capabilities: "acp_get_capabilities",
};

/// Session history command names (jsonl-backed session list and messages).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct SessionHistoryCommands {
    pub get_session_history: &'static str,
    pub get_session_messages: &'static str,
    pub get_full_session: &'static str,
    pub get_converted_session: &'static str,
    pub get_cache_stats: &'static str,
    pub invalidate_history_cache: &'static str,
    pub reset_cache_stats: &'static str,
}

#[allow(dead_code)]
pub const SESSION_HISTORY_COMMANDS: SessionHistoryCommands = SessionHistoryCommands {
    get_session_history: "get_session_history",
    get_session_messages: "get_session_messages",
    get_full_session: "get_full_session",
    get_converted_session: "get_converted_session",
    get_cache_stats: "get_cache_stats",
    invalidate_history_cache: "invalidate_history_cache",
    reset_cache_stats: "reset_cache_stats",
};

/// Storage command names
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct StorageCommands {
    pub save_conversation_metadata: &'static str,
    pub get_conversation_metadata: &'static str,
    pub get_all_conversation_metadata: &'static str,
    pub delete_conversation_metadata: &'static str,
    pub update_conversation_metadata: &'static str,
    pub delete_conversation: &'static str,
    pub open_in_finder: &'static str,
    pub open_streaming_log: &'static str,
    pub get_projects: &'static str,
    pub get_recent_projects: &'static str,
    pub get_project_count: &'static str,
    pub import_project: &'static str,
    pub add_project: &'static str,
    pub remove_project: &'static str,
    pub browse_project: &'static str,
    pub get_all_conversations: &'static str,
    pub upsert_conversation: &'static str,
    pub get_user_setting: &'static str,
    pub save_user_setting: &'static str,
    pub get_analytics_distinct_id: &'static str,
    pub get_panel_layout: &'static str,
    pub save_panel_layout: &'static str,
    pub clear_panel_layout: &'static str,
    pub get_thread_list_settings: &'static str,
    pub save_thread_list_settings: &'static str,
    pub get_api_key: &'static str,
    pub save_api_key: &'static str,
    pub delete_api_key: &'static str,
    pub get_user_keybindings: &'static str,
    pub save_user_keybinding: &'static str,
    pub delete_user_keybinding: &'static str,
    pub reset_keybindings_to_defaults: &'static str,
}

#[allow(dead_code)]
pub const STORAGE_COMMANDS: StorageCommands = StorageCommands {
    save_conversation_metadata: "save_conversation_metadata",
    get_conversation_metadata: "get_conversation_metadata",
    get_all_conversation_metadata: "get_all_conversation_metadata",
    delete_conversation_metadata: "delete_conversation_metadata",
    update_conversation_metadata: "update_conversation_metadata",
    delete_conversation: "delete_conversation",
    open_in_finder: "open_in_finder",
    open_streaming_log: "open_streaming_log",
    get_projects: "get_projects",
    get_recent_projects: "get_recent_projects",
    get_project_count: "get_project_count",
    import_project: "import_project",
    add_project: "add_project",
    remove_project: "remove_project",
    browse_project: "browse_project",
    get_all_conversations: "get_all_conversations",
    upsert_conversation: "upsert_conversation",
    get_user_setting: "get_user_setting",
    save_user_setting: "save_user_setting",
    get_analytics_distinct_id: "get_analytics_distinct_id",
    get_panel_layout: "get_panel_layout",
    save_panel_layout: "save_panel_layout",
    clear_panel_layout: "clear_panel_layout",
    get_thread_list_settings: "get_thread_list_settings",
    save_thread_list_settings: "save_thread_list_settings",
    get_api_key: "get_api_key",
    save_api_key: "save_api_key",
    delete_api_key: "delete_api_key",
    get_user_keybindings: "get_user_keybindings",
    save_user_keybinding: "save_user_keybinding",
    delete_user_keybinding: "delete_user_keybinding",
    reset_keybindings_to_defaults: "reset_keybindings_to_defaults",
};

/// Cursor history command names
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct CursorHistoryCommands {
    pub get_cursor_history: &'static str,
    pub get_cursor_session: &'static str,
}

#[allow(dead_code)]
pub const CURSOR_HISTORY_COMMANDS: CursorHistoryCommands = CursorHistoryCommands {
    get_cursor_history: "get_cursor_history",
    get_cursor_session: "get_cursor_session",
};

/// GitHub integration command names
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct GitHubCommands {
    pub get_github_repo_context: &'static str,
    pub list_pull_requests: &'static str,
    pub fetch_commit_diff: &'static str,
    pub fetch_pr_diff: &'static str,
    pub git_working_file_diff: &'static str,
}

#[allow(dead_code)]
pub const GITHUB_COMMANDS: GitHubCommands = GitHubCommands {
    get_github_repo_context: "get_github_repo_context",
    list_pull_requests: "list_pull_requests",
    fetch_commit_diff: "fetch_commit_diff",
    fetch_pr_diff: "fetch_pr_diff",
    git_working_file_diff: "git_working_file_diff",
};

/// Voice command names
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct VoiceCommands {
    pub list_models: &'static str,
    pub list_languages: &'static str,
    pub get_model_status: &'static str,
    pub download_model: &'static str,
    pub delete_model: &'static str,
    pub start_recording: &'static str,
    pub stop_recording: &'static str,
    pub cancel_recording: &'static str,
    pub load_model: &'static str,
}

#[allow(dead_code)]
pub const VOICE_COMMANDS: VoiceCommands = VoiceCommands {
    list_models: "voice_list_models",
    list_languages: "voice_list_languages",
    get_model_status: "voice_get_model_status",
    download_model: "voice_download_model",
    delete_model: "voice_delete_model",
    start_recording: "voice_start_recording",
    stop_recording: "voice_stop_recording",
    cancel_recording: "voice_cancel_recording",
    load_model: "voice_load_model",
};

/// All command name constants grouped by category
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct Commands {
    pub acp: AcpCommands,
    pub session_history: SessionHistoryCommands,
    pub storage: StorageCommands,
    pub cursor_history: CursorHistoryCommands,
    pub github: GitHubCommands,
    pub voice: VoiceCommands,
}

#[allow(dead_code)]
pub const COMMANDS: Commands = Commands {
    acp: ACP_COMMANDS,
    session_history: SESSION_HISTORY_COMMANDS,
    storage: STORAGE_COMMANDS,
    cursor_history: CURSOR_HISTORY_COMMANDS,
    github: GITHUB_COMMANDS,
    voice: VOICE_COMMANDS,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_bindings() {
        // Test that all command types can be exported via specta
        specta_typescript::export::<Commands>(&Default::default())
            .expect("Failed to export Commands");
        specta_typescript::export::<AcpCommands>(&Default::default())
            .expect("Failed to export AcpCommands");
        specta_typescript::export::<SessionHistoryCommands>(&Default::default())
            .expect("Failed to export ClaudeHistoryCommands");
        specta_typescript::export::<StorageCommands>(&Default::default())
            .expect("Failed to export StorageCommands");
        specta_typescript::export::<CursorHistoryCommands>(&Default::default())
            .expect("Failed to export CursorHistoryCommands");
        specta_typescript::export::<GitHubCommands>(&Default::default())
            .expect("Failed to export GitHubCommands");
    }

    #[test]
    fn export_command_values() {
        use std::fs;
        use std::path::Path;

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let bindings_path = Path::new(manifest_dir).join("../src/lib/services/command-names.ts");

        let mut output = String::from(
            "// This file was generated by specta. Do not edit this file manually.\n\n",
        );

        // Export type definitions
        macro_rules! export_type {
            ($ty:ty) => {
                output.push_str(
                    &specta_typescript::export::<$ty>(&Default::default())
                        .expect(concat!("Failed to export ", stringify!($ty))),
                );
                output.push_str("\n\n");
            };
        }

        export_type!(AcpCommands);
        export_type!(SessionHistoryCommands);
        export_type!(StorageCommands);
        export_type!(CursorHistoryCommands);
        export_type!(GitHubCommands);
        export_type!(VoiceCommands);
        export_type!(Commands);

        // Also export the actual command values as a constant
        let json = serde_json::to_string_pretty(&COMMANDS).unwrap();
        output.push_str(&format!(
            "export const COMMANDS: Commands = {} as const;\n",
            json
        ));

        fs::write(&bindings_path, output).expect("Failed to write command-names.ts");
        eprintln!("Exported command names to {}", bindings_path.display());
    }
}
