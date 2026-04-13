#[macro_export]
macro_rules! __command_handler_idents {
    ($($field:ident : $command:ident),* $(,)?) => {
        $(
            $command,
        )*
    };
}

#[macro_export]
macro_rules! acp_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            initialize: acp_initialize,
            new_session: acp_new_session,
            resume_session: acp_resume_session,
            fork_session: acp_fork_session,
            set_model: acp_set_model,
            set_mode: acp_set_mode,
            set_session_autonomous: acp_set_session_autonomous,
            set_config_option: acp_set_config_option,
            send_prompt: acp_send_prompt,
            cancel: acp_cancel,
            reply_interaction: acp_reply_interaction,
            reply_permission: acp_reply_permission,
            reply_question: acp_reply_question,
            respond_inbound_request: acp_respond_inbound_request,
            get_event_bridge_info: acp_get_event_bridge_info,
            get_session_projection: acp_get_session_projection,
            list_agents: acp_list_agents,
            list_preconnection_commands: acp_list_preconnection_commands,
            install_agent: acp_install_agent,
            uninstall_agent: acp_uninstall_agent,
            close_session: acp_close_session,
            register_custom_agent: acp_register_custom_agent
        );
    };
}

#[macro_export]
macro_rules! fs_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            read_text_file: acp_read_text_file,
            write_text_file: acp_write_text_file
        );
    };
}

#[macro_export]
macro_rules! history_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            get_session_history: get_session_history,
            get_session_messages: get_session_messages,
            get_full_session: get_full_session,
            get_converted_session: get_converted_session,
            get_cache_stats: get_cache_stats,
            invalidate_history_cache: invalidate_history_cache,
            reset_cache_stats: reset_cache_stats,
            get_index_status: get_index_status,
            reindex_sessions: reindex_sessions,
            get_unified_session: get_unified_session,
            audit_session_load_timing: audit_session_load_timing,
            set_session_worktree_path: set_session_worktree_path,
            set_session_pr_number: set_session_pr_number,
            set_session_title: set_session_title,
            get_unified_plan: get_unified_plan,
            scan_project_sessions: scan_project_sessions,
            get_startup_sessions: get_startup_sessions,
            discover_all_projects_with_sessions: discover_all_projects_with_sessions,
            list_all_project_paths: list_all_project_paths,
            count_sessions_for_project: count_sessions_for_project
        );
    };
}

#[macro_export]
macro_rules! cursor_history_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            has_cursor_history: has_cursor_history,
            is_cursor_installed: is_cursor_installed
        );
    };
}

#[macro_export]
macro_rules! opencode_history_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            get_opencode_history: get_opencode_history,
            get_opencode_session: get_opencode_session,
            get_opencode_converted_session: get_opencode_converted_session,
            get_opencode_sessions_for_project: get_opencode_sessions_for_project
        );
    };
}

#[macro_export]
macro_rules! storage_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            get_projects: get_projects,
            get_recent_projects: get_recent_projects,
            get_project_count: get_project_count,
            get_missing_project_paths: get_missing_project_paths,
            import_project: import_project,
            add_project: add_project,
            update_project_color: update_project_color,
            update_project_icon: update_project_icon,
            update_project_order: update_project_order,
            remove_project: remove_project,
            browse_project: browse_project,
            get_api_key: get_api_key,
            save_api_key: save_api_key,
            delete_api_key: delete_api_key,
            get_custom_keybindings: get_custom_keybindings,
            save_custom_keybindings: save_custom_keybindings,
            get_streaming_log_path: get_streaming_log_path,
            get_session_file_path: get_session_file_path,
            save_user_setting: save_user_setting,
            get_user_setting: get_user_setting,
            save_session_review_state: save_session_review_state,
            get_session_review_state: get_session_review_state,
            delete_session_review_state: delete_session_review_state,
            save_thread_list_settings: save_thread_list_settings,
            get_thread_list_settings: get_thread_list_settings,
            reset_database: reset_database,
            open_in_finder: open_in_finder,
            open_streaming_log: open_streaming_log
        );
    };
}

#[macro_export]
macro_rules! file_index_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            get_project_files: get_project_files,
            get_project_git_status: get_project_git_status,
            get_project_git_status_summary: get_project_git_status_summary,
            get_project_git_overview_summary: get_project_git_overview_summary,
            invalidate_project_files: invalidate_project_files,
            read_file_content: read_file_content,
            resolve_file_path: resolve_file_path,
            get_file_diff: get_file_diff,
            revert_file_content: revert_file_content,
            read_image_as_base64: read_image_as_base64,
            copy_file: copy_file,
            create_directory: create_directory,
            create_file: create_file,
            delete_path: delete_path,
            rename_path: rename_path,
            search_project_files_for_explorer: search_project_files_for_explorer,
            get_file_explorer_preview: get_file_explorer_preview
        );
    };
}

#[macro_export]
macro_rules! terminal_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            create: terminal_create,
            output: terminal_output,
            wait_for_exit: terminal_wait_for_exit,
            kill: terminal_kill,
            release: terminal_release,
            get_default_shell: get_default_shell
        );
    };
}

#[macro_export]
macro_rules! git_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            clone: git_clone,
            browse_destination: browse_clone_destination,
            init: git_init,
            is_repo: git_is_repo,
            current_branch: git_current_branch,
            list_branches: git_list_branches,
            checkout_branch: git_checkout_branch,
            has_uncommitted_changes: git_has_uncommitted_changes,
            worktree_create: git_worktree_create,
            prepare_worktree_session_launch: git_prepare_worktree_session_launch,
            discard_prepared_worktree_session_launch: git_discard_prepared_worktree_session_launch,
            worktree_remove: git_worktree_remove,
            worktree_reset: git_worktree_reset,
            worktree_list: git_worktree_list,
            worktree_rename: git_worktree_rename,
            worktree_disk_size: git_worktree_disk_size,
            collect_ship_context: git_collect_ship_context,
            pr_details: git_pr_details,
            merge_pr: git_merge_pr,
            get_open_pr_for_branch: get_open_pr_for_branch,
            watch_head: git_watch_head,
            load_worktree_config: load_worktree_config,
            run_worktree_setup: run_worktree_setup,
            save_worktree_config: save_worktree_config,
            panel_status: git_panel_status,
            diff_stats: git_diff_stats,
            stage_files: git_stage_files,
            unstage_files: git_unstage_files,
            stage_all: git_stage_all,
            discard_changes: git_discard_changes,
            commit: git_commit,
            push: git_push,
            pull: git_pull,
            fetch: git_fetch,
            remote_status: git_remote_status,
            stash_list: git_stash_list,
            stash_pop: git_stash_pop,
            stash_drop: git_stash_drop,
            stash_save: git_stash_save,
            log: git_log,
            create_branch: git_create_branch,
            delete_branch: git_delete_branch,
            run_stacked_action: git_run_stacked_action
        );
    };
}

#[macro_export]
macro_rules! checkpoint_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            create: checkpoint_create,
            list: checkpoint_list,
            get_file_content: checkpoint_get_file_content,
            get_file_diff_content: checkpoint_get_file_diff_content,
            revert: checkpoint_revert,
            revert_file: checkpoint_revert_file,
            get_file_snapshots: checkpoint_get_file_snapshots
        );
    };
}

#[macro_export]
macro_rules! skills_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            list_tree: skills_list_tree,
            list_agent_skills: skills_list_agent_skills,
            get: skills_get,
            create: skills_create,
            update: skills_update,
            delete: skills_delete,
            copy_to: skills_copy_to,
            start_watching: skills_start_watching,
            stop_watching: skills_stop_watching,
            list_plugins: skills_list_plugins,
            list_plugin_skills: skills_list_plugin_skills,
            get_plugin_skill: skills_get_plugin_skill,
            copy_plugin_skill_to_agent: skills_copy_plugin_skill_to_agent,
            library_list_skills: library_skills_list,
            library_list_skills_with_sync: library_skills_list_with_sync,
            library_get_skill: library_skill_get,
            library_create_skill: library_skill_create,
            library_update_skill: library_skill_update,
            library_delete_skill: library_skill_delete,
            library_get_sync_targets: library_skill_get_sync_targets,
            library_set_sync_target: library_skill_set_sync_target,
            library_sync_skill: library_skill_sync,
            library_sync_all: library_sync_all,
            library_is_empty: library_is_empty,
            library_import_existing: library_import_existing,
            library_get_skill_folder_path: library_skill_get_folder_path,
            library_delete_skill_from_agents: library_skill_delete_from_agents
        );
    };
}

#[macro_export]
macro_rules! sql_studio_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            list_connections: sql_studio_list_connections,
            get_connection: sql_studio_get_connection,
            save_connection: sql_studio_save_connection,
            delete_connection: sql_studio_delete_connection,
            pick_sqlite_file: sql_studio_pick_sqlite_file,
            test_connection: sql_studio_test_connection,
            test_connection_input: sql_studio_test_connection_input,
            list_schema: sql_studio_list_schema,
            execute_query: sql_studio_execute_query,
            explore_table: sql_studio_explore_table,
            update_table_cell: sql_studio_update_table_cell
        );
    };
}

#[macro_export]
macro_rules! github_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            fetch_commit_diff: fetch_commit_diff,
            fetch_pr_diff: fetch_pr_diff,
            get_github_repo_context: get_github_repo_context,
            git_working_file_diff: git_working_file_diff,
            list_pull_requests: list_pull_requests,
            check_github_auth: check_github_auth,
            create_github_issue: create_github_issue,
            create_issue_comment: create_issue_comment,
            get_github_issue: get_github_issue,
            list_github_issues: list_github_issues,
            list_issue_comments: list_issue_comments,
            search_github_issues: search_github_issues,
            toggle_comment_reaction: toggle_comment_reaction,
            toggle_issue_reaction: toggle_issue_reaction
        );
    };
}

#[macro_export]
macro_rules! browser_webview_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            open: open_browser_webview,
            close: close_browser_webview,
            navigate: navigate_browser_webview,
            reload: reload_browser_webview,
            back: browser_webview_back,
            forward: browser_webview_forward,
            get_url: get_browser_webview_url,
            show: show_browser_webview,
            hide: hide_browser_webview,
            resize: resize_browser_webview,
            set_zoom: set_browser_webview_zoom
        );
    };
}

#[macro_export]
macro_rules! voice_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            list_models: voice_list_models,
            list_languages: voice_list_languages,
            get_model_status: voice_get_model_status,
            download_model: voice_download_model,
            delete_model: voice_delete_model,
            load_model: voice_load_model,
            start_recording: voice_start_recording,
            stop_recording: voice_stop_recording,
            cancel_recording: voice_cancel_recording
        );
    };
}

#[macro_export]
macro_rules! locale_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            get_system_locale: get_system_locale
        );
    };
}

#[macro_export]
macro_rules! window_command_entries {
    ($callback:ident $(, $args:tt)*) => {
        $callback!($($args,)*
            activate: activate_window
        );
    };
}

#[macro_export]
macro_rules! registered_tauri_handlers {
    () => {
        tauri::generate_handler![
            acp_initialize,
            acp_new_session,
            acp_resume_session,
            acp_fork_session,
            acp_set_model,
            acp_set_mode,
            acp_set_session_autonomous,
            acp_set_config_option,
            acp_send_prompt,
            acp_cancel,
            acp_reply_interaction,
            acp_reply_permission,
            acp_reply_question,
            acp_respond_inbound_request,
            acp_get_event_bridge_info,
            acp_get_session_projection,
            acp_list_agents,
            acp_list_preconnection_commands,
            acp_install_agent,
            acp_uninstall_agent,
            acp_close_session,
            acp_register_custom_agent,
            acp_read_text_file,
            acp_write_text_file,
            get_session_history,
            get_session_messages,
            get_full_session,
            get_converted_session,
            get_cache_stats,
            invalidate_history_cache,
            reset_cache_stats,
            get_index_status,
            reindex_sessions,
            get_unified_session,
            audit_session_load_timing,
            set_session_worktree_path,
            set_session_pr_number,
            set_session_title,
            get_unified_plan,
            scan_project_sessions,
            get_startup_sessions,
            discover_all_projects_with_sessions,
            list_all_project_paths,
            count_sessions_for_project,
            has_cursor_history,
            is_cursor_installed,
            get_opencode_history,
            get_opencode_session,
            get_opencode_converted_session,
            get_opencode_sessions_for_project,
            get_projects,
            get_recent_projects,
            get_project_count,
            get_missing_project_paths,
            import_project,
            add_project,
            update_project_color,
            update_project_icon,
            update_project_order,
            remove_project,
            browse_project,
            get_api_key,
            save_api_key,
            delete_api_key,
            get_custom_keybindings,
            save_custom_keybindings,
            get_streaming_log_path,
            get_session_file_path,
            save_user_setting,
            get_user_setting,
            save_session_review_state,
            get_session_review_state,
            delete_session_review_state,
            save_thread_list_settings,
            get_thread_list_settings,
            reset_database,
            open_in_finder,
            open_streaming_log,
            get_project_files,
            get_project_git_status,
            get_project_git_status_summary,
            get_project_git_overview_summary,
            invalidate_project_files,
            read_file_content,
            resolve_file_path,
            get_file_diff,
            revert_file_content,
            read_image_as_base64,
            copy_file,
            create_directory,
            create_file,
            delete_path,
            rename_path,
            search_project_files_for_explorer,
            get_file_explorer_preview,
            terminal_create,
            terminal_output,
            terminal_wait_for_exit,
            terminal_kill,
            terminal_release,
            get_default_shell,
            git_clone,
            browse_clone_destination,
            git_init,
            git_is_repo,
            git_current_branch,
            git_list_branches,
            git_checkout_branch,
            git_has_uncommitted_changes,
            git_worktree_create,
            git_prepare_worktree_session_launch,
            git_discard_prepared_worktree_session_launch,
            git_worktree_remove,
            git_worktree_reset,
            git_worktree_list,
            git_worktree_rename,
            git_worktree_disk_size,
            git_collect_ship_context,
            git_pr_details,
            git_merge_pr,
            get_open_pr_for_branch,
            git_watch_head,
            load_worktree_config,
            run_worktree_setup,
            save_worktree_config,
            git_panel_status,
            git_diff_stats,
            git_stage_files,
            git_unstage_files,
            git_stage_all,
            git_discard_changes,
            git_commit,
            git_push,
            git_pull,
            git_fetch,
            git_remote_status,
            git_stash_list,
            git_stash_pop,
            git_stash_drop,
            git_stash_save,
            git_log,
            git_create_branch,
            git_delete_branch,
            git_run_stacked_action,
            checkpoint_create,
            checkpoint_list,
            checkpoint_get_file_content,
            checkpoint_get_file_diff_content,
            checkpoint_revert,
            checkpoint_revert_file,
            checkpoint_get_file_snapshots,
            skills_list_tree,
            skills_list_agent_skills,
            skills_get,
            skills_create,
            skills_update,
            skills_delete,
            skills_copy_to,
            skills_start_watching,
            skills_stop_watching,
            skills_list_plugins,
            skills_list_plugin_skills,
            skills_get_plugin_skill,
            skills_copy_plugin_skill_to_agent,
            library_skills_list,
            library_skills_list_with_sync,
            library_skill_get,
            library_skill_create,
            library_skill_update,
            library_skill_delete,
            library_skill_get_sync_targets,
            library_skill_set_sync_target,
            library_skill_sync,
            library_sync_all,
            library_is_empty,
            library_import_existing,
            library_skill_get_folder_path,
            library_skill_delete_from_agents,
            sql_studio_list_connections,
            sql_studio_get_connection,
            sql_studio_save_connection,
            sql_studio_delete_connection,
            sql_studio_pick_sqlite_file,
            sql_studio_test_connection,
            sql_studio_test_connection_input,
            sql_studio_list_schema,
            sql_studio_execute_query,
            sql_studio_explore_table,
            sql_studio_update_table_cell,
            fetch_commit_diff,
            fetch_pr_diff,
            get_github_repo_context,
            git_working_file_diff,
            list_pull_requests,
            check_github_auth,
            create_github_issue,
            create_issue_comment,
            get_github_issue,
            list_github_issues,
            list_issue_comments,
            search_github_issues,
            toggle_comment_reaction,
            toggle_issue_reaction,
            open_browser_webview,
            close_browser_webview,
            navigate_browser_webview,
            reload_browser_webview,
            browser_webview_back,
            browser_webview_forward,
            get_browser_webview_url,
            show_browser_webview,
            hide_browser_webview,
            resize_browser_webview,
            set_browser_webview_zoom,
            voice_list_models,
            voice_list_languages,
            voice_get_model_status,
            voice_download_model,
            voice_delete_model,
            voice_load_model,
            voice_start_recording,
            voice_stop_recording,
            voice_cancel_recording,
            get_system_locale,
            activate_window,
        ]
    };
}
