type MessageValue = string | number | boolean | null | undefined;
type MessageArgs = Record<string, MessageValue>;

function interpolate(template: string, args: MessageArgs = {}): string {
	return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
		const value = args[key];
		return value === undefined || value === null ? "" : String(value);
	});
}

export function app_name(args: MessageArgs = {}): string {
	return interpolate(`Acepe`, args);
}

export function app_title(args: MessageArgs = {}): string {
	return interpolate(`Acepe - AI Agent Client`, args);
}

export function common_save(args: MessageArgs = {}): string {
	return interpolate(`Save`, args);
}

export function common_cancel(args: MessageArgs = {}): string {
	return interpolate(`Cancel`, args);
}

export function common_confirm(args: MessageArgs = {}): string {
	return interpolate(`Confirm`, args);
}

export function common_delete(args: MessageArgs = {}): string {
	return interpolate(`Delete`, args);
}

export function common_edit(args: MessageArgs = {}): string {
	return interpolate(`Edit`, args);
}

export function common_close(args: MessageArgs = {}): string {
	return interpolate(`Close`, args);
}

export function common_back(args: MessageArgs = {}): string {
	return interpolate(`Back`, args);
}

export function common_open(args: MessageArgs = {}): string {
	return interpolate(`Open`, args);
}

export function common_settings(args: MessageArgs = {}): string {
	return interpolate(`Settings`, args);
}

export function common_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading...`, args);
}

export function common_error(args: MessageArgs = {}): string {
	return interpolate(`Error`, args);
}

export function common_success(args: MessageArgs = {}): string {
	return interpolate(`Success`, args);
}

export function common_clear(args: MessageArgs = {}): string {
	return interpolate(`Clear`, args);
}

export function common_command_fallback(args: MessageArgs = {}): string {
	return interpolate(`Command`, args);
}

export function common_result(args: MessageArgs = {}): string {
	return interpolate(`result`, args);
}

export function common_result_plural(args: MessageArgs = {}): string {
	return interpolate(`results`, args);
}

export function common_other(args: MessageArgs = {}): string {
	return interpolate(`Other`, args);
}

export function common_submit(args: MessageArgs = {}): string {
	return interpolate(`Submit`, args);
}

export function question_other_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Type your answer...`, args);
}

export function aria_toggle_sidebar(args: MessageArgs = {}): string {
	return interpolate(`Toggle Sidebar`, args);
}

export function aria_pagination(args: MessageArgs = {}): string {
	return interpolate(`pagination`, args);
}

export function aria_breadcrumb(args: MessageArgs = {}): string {
	return interpolate(`breadcrumb`, args);
}

export function aria_previous_page(args: MessageArgs = {}): string {
	return interpolate(`Go to previous page`, args);
}

export function aria_next_page(args: MessageArgs = {}): string {
	return interpolate(`Go to next page`, args);
}

export function pagination_previous(args: MessageArgs = {}): string {
	return interpolate(`Previous`, args);
}

export function pagination_next(args: MessageArgs = {}): string {
	return interpolate(`Next`, args);
}

export function aria_open_expanded_view(args: MessageArgs = {}): string {
	return interpolate(`Open in expanded view`, args);
}

export function aria_expand_search(args: MessageArgs = {}): string {
	return interpolate(`Expand search results`, args);
}

export function aria_collapse_search(args: MessageArgs = {}): string {
	return interpolate(`Collapse search results`, args);
}

export function aria_expand(args: MessageArgs = {}): string {
	return interpolate(`Expand`, args);
}

export function aria_collapse(args: MessageArgs = {}): string {
	return interpolate(`Collapse`, args);
}

export function aria_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading`, args);
}

export function sidebar_new_thread(args: MessageArgs = {}): string {
	return interpolate(`New Thread`, args);
}

export function sidebar_threads(args: MessageArgs = {}): string {
	return interpolate(`Threads`, args);
}

export function sidebar_history(args: MessageArgs = {}): string {
	return interpolate(`History`, args);
}

export function settings_title(args: MessageArgs = {}): string {
	return interpolate(`Settings`, args);
}

export function settings_api_keys(args: MessageArgs = {}): string {
	return interpolate(`API Keys`, args);
}

export function settings_general(args: MessageArgs = {}): string {
	return interpolate(`General`, args);
}

export function settings_general_description(args: MessageArgs = {}): string {
	return interpolate(`Appearance, theme, and other general preferences.`, args);
}

export function settings_skills(args: MessageArgs = {}): string {
	return interpolate(`Skills`, args);
}

export function settings_skills_description(args: MessageArgs = {}): string {
	return interpolate(`Create and manage custom skills that extend agent capabilities.`, args);
}

export function settings_back_to_app(args: MessageArgs = {}): string {
	return interpolate(`Back to app`, args);
}

export function settings_keybindings(args: MessageArgs = {}): string {
	return interpolate(`Keybindings`, args);
}

export function settings_keybindings_description(args: MessageArgs = {}): string {
	return interpolate(`Customize keyboard shortcuts for actions across the app.`, args);
}

export function settings_keybindings_reset_all(args: MessageArgs = {}): string {
	return interpolate(`Reset All`, args);
}

export function settings_keybindings_search(args: MessageArgs = {}): string {
	return interpolate(`Search keybindings...`, args);
}

export function settings_keybindings_action(args: MessageArgs = {}): string {
	return interpolate(`Action`, args);
}

export function settings_keybindings_keybinding(args: MessageArgs = {}): string {
	return interpolate(`Keybinding`, args);
}

export function settings_keybindings_not_bound(args: MessageArgs = {}): string {
	return interpolate(`Not bound`, args);
}

export function settings_keybindings_press_keys(args: MessageArgs = {}): string {
	return interpolate(`Press keys...`, args);
}

export function settings_keybindings_used_by(args: MessageArgs = {}): string {
	return interpolate(`Used by: {actions}`, args);
}

export function settings_keybindings_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function settings_keybindings_edit(args: MessageArgs = {}): string {
	return interpolate(`Edit keybinding`, args);
}

export function settings_keybindings_reset(args: MessageArgs = {}): string {
	return interpolate(`Reset to default`, args);
}

export function settings_language(args: MessageArgs = {}): string {
	return interpolate(`Language`, args);
}

export function settings_models(args: MessageArgs = {}): string {
	return interpolate(`Models`, args);
}

export function settings_agents(args: MessageArgs = {}): string {
	return interpolate(`Agents`, args);
}

export function settings_agents_and_models(args: MessageArgs = {}): string {
	return interpolate(`Agents & models`, args);
}

export function settings_agents_description(args: MessageArgs = {}): string {
	return interpolate(`Select which agents are visible across the app.`, args);
}

export function settings_agents_visible(args: MessageArgs = {}): string {
	return interpolate(`Visible agents`, args);
}

export function settings_agents_installed(args: MessageArgs = {}): string {
	return interpolate(`Installed`, args);
}

export function settings_agents_not_installed(args: MessageArgs = {}): string {
	return interpolate(`Not installed`, args);
}

export function settings_agents_min_one(args: MessageArgs = {}): string {
	return interpolate(`At least one agent must remain selected.`, args);
}

export function settings_agents_persisted(args: MessageArgs = {}): string {
	return interpolate(`Persisted custom agents`, args);
}

export function settings_models_default(args: MessageArgs = {}): string {
	return interpolate(`Default`, args);
}

export function settings_models_defaults(args: MessageArgs = {}): string {
	return interpolate(`Default Models`, args);
}

export function settings_models_defaults_description(args: MessageArgs = {}): string {
	return interpolate(`Configure the default models to use for each agent and mode.`, args);
}

export function settings_models_no_cache(args: MessageArgs = {}): string {
	return interpolate(`Connect to the agent to see available models.`, args);
}

export function settings_models_plan(args: MessageArgs = {}): string {
	return interpolate(`Plan Mode`, args);
}

export function settings_models_build(args: MessageArgs = {}): string {
	return interpolate(`Build Mode`, args);
}

export function settings_theme(args: MessageArgs = {}): string {
	return interpolate(`Theme`, args);
}

export function settings_appearance(args: MessageArgs = {}): string {
	return interpolate(`Appearance`, args);
}

export function settings_appearance_title(args: MessageArgs = {}): string {
	return interpolate(`Appearance`, args);
}

export function settings_appearance_description(args: MessageArgs = {}): string {
	return interpolate(`Customize how content is displayed in the application.`, args);
}

export function settings_appearance_streaming_animation(args: MessageArgs = {}): string {
	return interpolate(`Streaming Animation`, args);
}

export function settings_appearance_streaming_animation_none(args: MessageArgs = {}): string {
	return interpolate(`None`, args);
}

export function settings_appearance_streaming_animation_none_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Instant display, no animation`, args);
}

export function settings_appearance_streaming_animation_fade(args: MessageArgs = {}): string {
	return interpolate(`Fade In`, args);
}

export function settings_appearance_streaming_animation_fade_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Gentle fade with upward motion`, args);
}

export function settings_appearance_streaming_animation_glow(args: MessageArgs = {}): string {
	return interpolate(`Glow`, args);
}

export function settings_appearance_streaming_animation_glow_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Subtle highlight pulse effect`, args);
}

export function settings_appearance_streaming_animation_typewriter(args: MessageArgs = {}): string {
	return interpolate(`Typewriter`, args);
}

export function settings_appearance_streaming_animation_typewriter_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Characters appear one by one`, args);
}

export function settings_chat(args: MessageArgs = {}): string {
	return interpolate(`Chat`, args);
}

export function settings_chat_description(args: MessageArgs = {}): string {
	return interpolate(`Conversation and message display preferences.`, args);
}

export function settings_chat_thinking_collapsed(args: MessageArgs = {}): string {
	return interpolate(`Thinking block collapsed by default`, args);
}

export function settings_chat_thinking_collapsed_description(args: MessageArgs = {}): string {
	return interpolate(`Start with the thinking block collapsed; use the chevron to expand.`, args);
}

export function settings_chat_streaming_animation(args: MessageArgs = {}): string {
	return interpolate(`Streaming animation`, args);
}

export function settings_chat_streaming_animation_description(args: MessageArgs = {}): string {
	return interpolate(`Choose how assistant text appears while it streams in.`, args);
}

export function settings_chat_streaming_animation_smooth(args: MessageArgs = {}): string {
	return interpolate(`Smooth`, args);
}

export function settings_chat_streaming_animation_smooth_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Buffered, calmer append with a subtle tail fade.`, args);
}

export function settings_chat_streaming_animation_classic(args: MessageArgs = {}): string {
	return interpolate(`Classic`, args);
}

export function settings_chat_streaming_animation_classic_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Current typing-style incremental reveal.`, args);
}

export function settings_chat_streaming_animation_instant(args: MessageArgs = {}): string {
	return interpolate(`Instant`, args);
}

export function settings_chat_streaming_animation_instant_description(
	args: MessageArgs = {}
): string {
	return interpolate(`Immediate display with no animation.`, args);
}

export function settings_voice(args: MessageArgs = {}): string {
	return interpolate(`Voice`, args);
}

export function settings_plans_title(args: MessageArgs = {}): string {
	return interpolate(`Plans`, args);
}

export function settings_plans_prefer_inline(args: MessageArgs = {}): string {
	return interpolate(`Inline plan display`, args);
}

export function settings_plans_prefer_inline_description(args: MessageArgs = {}): string {
	return interpolate(`Show plans inline in chat instead of opening the sidebar`, args);
}

export function settings_appearance_preview(args: MessageArgs = {}): string {
	return interpolate(`Preview`, args);
}

export function settings_appearance_streaming_preview_text(args: MessageArgs = {}): string {
	return interpolate(`This is how text will appear as it streams in from the AI assistant.`, args);
}

export function settings_project(args: MessageArgs = {}): string {
	return interpolate(`Project`, args);
}

export function settings_project_title(args: MessageArgs = {}): string {
	return interpolate(`Project Settings`, args);
}

export function settings_project_description(args: MessageArgs = {}): string {
	return interpolate(`Configure project-specific settings and preferences.`, args);
}

export function settings_project_configuration(args: MessageArgs = {}): string {
	return interpolate(`Project Configuration`, args);
}

export function settings_project_configuration_description(args: MessageArgs = {}): string {
	return interpolate(`Manage your project settings here.`, args);
}

export function settings_project_sessions(args: MessageArgs = {}): string {
	return interpolate(`Sessions`, args);
}

export function settings_project_sessions_description(args: MessageArgs = {}): string {
	return interpolate(`View and manage all conversation sessions.`, args);
}

export function settings_project_sessions_title(args: MessageArgs = {}): string {
	return interpolate(`Title`, args);
}

export function settings_project_sessions_project(args: MessageArgs = {}): string {
	return interpolate(`Project`, args);
}

export function settings_project_sessions_agent(args: MessageArgs = {}): string {
	return interpolate(`Agent`, args);
}

export function settings_project_sessions_status(args: MessageArgs = {}): string {
	return interpolate(`Status`, args);
}

export function settings_project_sessions_messages(args: MessageArgs = {}): string {
	return interpolate(`Messages`, args);
}

export function settings_project_sessions_updated(args: MessageArgs = {}): string {
	return interpolate(`Updated`, args);
}

export function settings_project_sessions_search(args: MessageArgs = {}): string {
	return interpolate(`Search sessions...`, args);
}

export function settings_project_sessions_all_projects(args: MessageArgs = {}): string {
	return interpolate(`All projects`, args);
}

export function settings_project_sessions_all_agents(args: MessageArgs = {}): string {
	return interpolate(`All agents`, args);
}

export function settings_project_sessions_empty(args: MessageArgs = {}): string {
	return interpolate(`No sessions yet`, args);
}

export function settings_project_sessions_no_results(args: MessageArgs = {}): string {
	return interpolate(`No results found`, args);
}

export function settings_project_sessions_count(args: MessageArgs = {}): string {
	return interpolate(`Showing {count} of {total} sessions`, args);
}

export function settings_project_sessions_delete_confirm(args: MessageArgs = {}): string {
	return interpolate(`Delete this session?`, args);
}

export function settings_worktree_section(args: MessageArgs = {}): string {
	return interpolate(`Worktrees`, args);
}

export function settings_worktree_default_label(args: MessageArgs = {}): string {
	return interpolate(`Use worktrees by default`, args);
}

export function settings_worktree_default_description(args: MessageArgs = {}): string {
	return interpolate(
		`New sessions will automatically use git worktrees for branch isolation`,
		args
	);
}

export function settings_worktree_setup_running(args: MessageArgs = {}): string {
	return interpolate(`Running setup...`, args);
}

export function settings_worktree_setup_failed(args: MessageArgs = {}): string {
	return interpolate(`Setup script failed`, args);
}

export function settings_worktree_setup_complete(args: MessageArgs = {}): string {
	return interpolate(`Setup complete`, args);
}

export function settings_worktrees_setup_title(args: MessageArgs = {}): string {
	return interpolate(`Setup scripts`, args);
}

export function settings_worktrees_setup_description(args: MessageArgs = {}): string {
	return interpolate(`Commands run after creating a worktree (e.g., install dependencies)`, args);
}

export function settings_worktrees_no_project(args: MessageArgs = {}): string {
	return interpolate(`Open a project to configure setup scripts`, args);
}

export function settings_worktrees_add_placeholder(args: MessageArgs = {}): string {
	return interpolate(`e.g. bun install`, args);
}

export function settings_worktrees_config_hint(args: MessageArgs = {}): string {
	return interpolate(`Stored in .acepe.json in project root`, args);
}

export function settings_danger_zone(args: MessageArgs = {}): string {
	return interpolate(`Danger Zone`, args);
}

export function settings_reset_database(args: MessageArgs = {}): string {
	return interpolate(`Reset Database`, args);
}

export function settings_reset_database_confirm_description(args: MessageArgs = {}): string {
	return interpolate(
		`This will permanently delete the local SQLite database containing all your projects, API keys, preferences, and session history. Your session files on disk will not be affected. This action cannot be undone.`,
		args
	);
}

export function settings_reset_database_confirm_title(args: MessageArgs = {}): string {
	return interpolate(`Reset Database?`, args);
}

export function settings_reset_database_description(args: MessageArgs = {}): string {
	return interpolate(
		`Deletes the local SQLite database (projects, API keys, preferences, session history). Session files on disk are not affected.`,
		args
	);
}

export function settings_reset_database_reset_button(args: MessageArgs = {}): string {
	return interpolate(`Reset Database`, args);
}

export function image_too_large(args: MessageArgs = {}): string {
	return interpolate(`Image exceeds 10 MB limit`, args);
}

export function session_status_idle(args: MessageArgs = {}): string {
	return interpolate(`Idle`, args);
}

export function session_status_connecting(args: MessageArgs = {}): string {
	return interpolate(`Connecting`, args);
}

export function session_status_ready(args: MessageArgs = {}): string {
	return interpolate(`Ready`, args);
}

export function session_status_streaming(args: MessageArgs = {}): string {
	return interpolate(`Streaming`, args);
}

export function session_status_error(args: MessageArgs = {}): string {
	return interpolate(`Error`, args);
}

export function thread_copy_thread_id(args: MessageArgs = {}): string {
	return interpolate(`Copy Thread ID`, args);
}

export function thread_copy_session_id(args: MessageArgs = {}): string {
	return interpolate(`Copy Session ID`, args);
}

export function thread_copy_thread_id_success(args: MessageArgs = {}): string {
	return interpolate(`Thread ID copied to clipboard`, args);
}

export function thread_copy_thread_id_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy Thread ID`, args);
}

export function thread_copy_session_id_success(args: MessageArgs = {}): string {
	return interpolate(`Session ID copied to clipboard`, args);
}

export function thread_copy_session_id_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy Session ID`, args);
}

export function thread_copy_session_title(args: MessageArgs = {}): string {
	return interpolate(`Copy Session Title`, args);
}

export function thread_copy_session_title_success(args: MessageArgs = {}): string {
	return interpolate(`Session title copied to clipboard`, args);
}

export function thread_copy_session_title_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy session title`, args);
}

export function thread_copy_content(args: MessageArgs = {}): string {
	return interpolate(`Copy Thread`, args);
}

export function thread_copy_content_success(args: MessageArgs = {}): string {
	return interpolate(`Thread content copied to clipboard`, args);
}

export function thread_copy_content_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy thread content`, args);
}

export function thread_copy_content_error_no_thread(args: MessageArgs = {}): string {
	return interpolate(`No thread to copy`, args);
}

export function thread_copy_content_error_empty(args: MessageArgs = {}): string {
	return interpolate(`Thread has no content to copy`, args);
}

export function thread_open_in_finder(args: MessageArgs = {}): string {
	return interpolate(`Open Thread in Finder`, args);
}

export function thread_open_in_finder_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to open thread in Finder`, args);
}

export function thread_open_in_finder_error_no_thread(args: MessageArgs = {}): string {
	return interpolate(`No thread to open`, args);
}

export function thread_export_raw_streaming(args: MessageArgs = {}): string {
	return interpolate(`Open Streaming Log`, args);
}

export function thread_export_raw_success(args: MessageArgs = {}): string {
	return interpolate(`Opened streaming log in file manager`, args);
}

export function thread_export_raw_error_no_thread(args: MessageArgs = {}): string {
	return interpolate(`No thread to export`, args);
}

export function thread_export_raw_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to open streaming log: {error}`, args);
}

export function session_menu_copy_id(args: MessageArgs = {}): string {
	return interpolate(`Copy session ID`, args);
}

export function session_menu_copy_title(args: MessageArgs = {}): string {
	return interpolate(`Copy session title`, args);
}

export function session_menu_open_raw_file(args: MessageArgs = {}): string {
	return interpolate(`Open raw session file`, args);
}

export function session_menu_open_in_acepe(args: MessageArgs = {}): string {
	return interpolate(`Open raw session in Acepe`, args);
}

export function session_menu_delete(args: MessageArgs = {}): string {
	return interpolate(`Delete session`, args);
}

export function session_menu_export(args: MessageArgs = {}): string {
	return interpolate(`Export`, args);
}

export function session_menu_export_markdown(args: MessageArgs = {}): string {
	return interpolate(`Export as Markdown`, args);
}

export function session_menu_export_json(args: MessageArgs = {}): string {
	return interpolate(`Export as JSON`, args);
}

export function session_menu_delete_confirm(args: MessageArgs = {}): string {
	return interpolate(`Delete this session? This cannot be undone.`, args);
}

export function session_menu_delete_success(args: MessageArgs = {}): string {
	return interpolate(`Session deleted`, args);
}

export function session_menu_copy_id_success(args: MessageArgs = {}): string {
	return interpolate(`Session ID copied`, args);
}

export function session_menu_copy_title_success(args: MessageArgs = {}): string {
	return interpolate(`Session title copied`, args);
}

export function session_menu_open_raw_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to open session file: {error}`, args);
}

export function session_menu_delete_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to delete session: {error}`, args);
}

export function session_menu_export_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to export: {error}`, args);
}

export function session_menu_export_success(args: MessageArgs = {}): string {
	return interpolate(`Copied to clipboard`, args);
}

export function project_select_title(args: MessageArgs = {}): string {
	return interpolate(`Select a Project`, args);
}

export function project_select_description(args: MessageArgs = {}): string {
	return interpolate(`Choose a project to start a new conversation`, args);
}

export function project_select_no_projects(args: MessageArgs = {}): string {
	return interpolate(`No projects available. Add a project to get started.`, args);
}

export function project_select_how_title(args: MessageArgs = {}): string {
	return interpolate(`How it works`, args);
}

export function project_select_how_step1(args: MessageArgs = {}): string {
	return interpolate(`Select a project`, args);
}

export function project_select_how_step2(args: MessageArgs = {}): string {
	return interpolate(`Select an agent`, args);
}

export function project_syncing(args: MessageArgs = {}): string {
	return interpolate(`Syncing {processed}/{total}`, args);
}

export function thread_list_filter_projects(args: MessageArgs = {}): string {
	return interpolate(`Filter projects`, args);
}

export function thread_list_visible_projects(args: MessageArgs = {}): string {
	return interpolate(`Visible Projects`, args);
}

export function thread_list_no_projects(args: MessageArgs = {}): string {
	return interpolate(`No projects`, args);
}

export function agent_input_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Plan, @ for context, / for commands`, args);
}

export function agent_input_send_message(args: MessageArgs = {}): string {
	return interpolate(`Send message`, args);
}

export function agent_input_queue_message(args: MessageArgs = {}): string {
	return interpolate(`Queue`, args);
}

export function agent_input_interrupt(args: MessageArgs = {}): string {
	return interpolate(`Interrupt`, args);
}

export function agent_input_queued_messages(args: MessageArgs = {}): string {
	return interpolate(`Queued`, args);
}

export function agent_input_queue_paused(args: MessageArgs = {}): string {
	return interpolate(`Paused`, args);
}

export function agent_input_queue_resume(args: MessageArgs = {}): string {
	return interpolate(`Resume`, args);
}

export function agent_input_queue_clear(args: MessageArgs = {}): string {
	return interpolate(`Clear queue`, args);
}

export function agent_input_queue_send_now(args: MessageArgs = {}): string {
	return interpolate(`Send`, args);
}

export function agent_input_stop_streaming(args: MessageArgs = {}): string {
	return interpolate(`Stop`, args);
}

export function agent_input_toggle_mode(args: MessageArgs = {}): string {
	return interpolate(`Toggle mode`, args);
}

export function agent_panel_select_project(args: MessageArgs = {}): string {
	return interpolate(`Select Project`, args);
}

export function agent_panel_new_thread(args: MessageArgs = {}): string {
	return interpolate(`New Thread`, args);
}

export function agent_panel_loading_session(args: MessageArgs = {}): string {
	return interpolate(`Loading session`, args);
}

export function agent_panel_start_typing(args: MessageArgs = {}): string {
	return interpolate(`Start typing to begin`, args);
}

export function agent_panel_ready_to_assist(args: MessageArgs = {}): string {
	return interpolate(`Ready to assist`, args);
}

export function agent_panel_select_agent_first(args: MessageArgs = {}): string {
	return interpolate(`Please select an agent first`, args);
}

export function agent_panel_project_not_found(args: MessageArgs = {}): string {
	return interpolate(`Project not found. Try refreshing the page.`, args);
}

export function agent_panel_scroll_bottom(args: MessageArgs = {}): string {
	return interpolate(`Scroll Bottom`, args);
}

export function agent_panel_scroll_top(args: MessageArgs = {}): string {
	return interpolate(`Scroll Top`, args);
}

export function agent_panel_create_pr(args: MessageArgs = {}): string {
	return interpolate(`Create PR`, args);
}

export function agent_panel_open_pr(args: MessageArgs = {}): string {
	return interpolate(`Open PR`, args);
}

export function agent_panel_create_pr_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Commit, push and create or open a PR`, args);
}

export function agent_panel_default_commit_message(args: MessageArgs = {}): string {
	return interpolate(`Updates from Acepe session`, args);
}

export function agent_panel_pr_staging(args: MessageArgs = {}): string {
	return interpolate(`Staging…`, args);
}

export function agent_panel_pr_pushing(args: MessageArgs = {}): string {
	return interpolate(`Pushing…`, args);
}

export function agent_panel_pr_merged(args: MessageArgs = {}): string {
	return interpolate(`PR merged!`, args);
}

export function empty_panel_title(args: MessageArgs = {}): string {
	return interpolate(`Ready to start`, args);
}

export function empty_panel_description(args: MessageArgs = {}): string {
	return interpolate(
		`Create a new session to begin working with an AI agent on your project.`,
		args
	);
}

export function empty_panel_start_session(args: MessageArgs = {}): string {
	return interpolate(`Start New Session`, args);
}

export function agent_sidebar_create_new_thread(args: MessageArgs = {}): string {
	return interpolate(`Create New Thread`, args);
}

export function agent_sidebar_create_new_thread_description(args: MessageArgs = {}): string {
	return interpolate(`Create a new conversation thread`, args);
}

export function agent_selector_no_agents(args: MessageArgs = {}): string {
	return interpolate(`No agents available`, args);
}

export function agent_selector_not_installed(args: MessageArgs = {}): string {
	return interpolate(`Not installed`, args);
}

export function agent_install_setting_up(args: MessageArgs = {}): string {
	return interpolate(`Setting up {agentName}...`, args);
}

export function agent_install_failed(args: MessageArgs = {}): string {
	return interpolate(`Setup failed`, args);
}

export function agent_install_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function agent_selection_choose_agent(args: MessageArgs = {}): string {
	return interpolate(`Choose your agent`, args);
}

export function thread_list_search_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Search conversations...`, args);
}

export function thread_list_empty_title(args: MessageArgs = {}): string {
	return interpolate(`No conversations yet`, args);
}

export function thread_list_empty_description(args: MessageArgs = {}): string {
	return interpolate(`Start a new conversation to get started`, args);
}

export function thread_list_new_thread_tooltip(args: MessageArgs = {}): string {
	return interpolate(`New thread (⌘N)`, args);
}

export function thread_list_new_thread_tooltip_disabled(args: MessageArgs = {}): string {
	return interpolate(`Select an agent and project first`, args);
}

export function thread_list_new_thread(args: MessageArgs = {}): string {
	return interpolate(`New Thread`, args);
}

export function thread_list_no_results(args: MessageArgs = {}): string {
	return interpolate(`No results for "{query}"`, args);
}

export function thread_list_new_thread_in_project(args: MessageArgs = {}): string {
	return interpolate(`New thread in {projectName}`, args);
}

export function thread_list_new_agent_session(args: MessageArgs = {}): string {
	return interpolate(`New {agentName} session`, args);
}

export function thread_list_new_session_in_project(args: MessageArgs = {}): string {
	return interpolate(`New session in {projectName}`, args);
}

export function thread_list_open_project_page(args: MessageArgs = {}): string {
	return interpolate(`Open project page: {projectName}`, args);
}

export function thread_list_filter_agents(args: MessageArgs = {}): string {
	return interpolate(`Agents`, args);
}

export function thread_list_filter_by_agent(args: MessageArgs = {}): string {
	return interpolate(`Filter by Agent`, args);
}

export function thread_list_all_agents(args: MessageArgs = {}): string {
	return interpolate(`All Agents`, args);
}

export function thread_list_import_starting(args: MessageArgs = {}): string {
	return interpolate(`Starting import...`, args);
}

export function thread_list_import_progress(args: MessageArgs = {}): string {
	return interpolate(`Import {count} sessions...`, args);
}

export function thread_list_import_complete(args: MessageArgs = {}): string {
	return interpolate(`Import complete`, args);
}

export function thread_view_resizing(args: MessageArgs = {}): string {
	return interpolate(`Resizing...`, args);
}

export function thread_view_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading messages...`, args);
}

export function thread_view_connecting(args: MessageArgs = {}): string {
	return interpolate(`Connecting...`, args);
}

export function thread_status_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing thread...`, args);
}

export function thread_status_connected(args: MessageArgs = {}): string {
	return interpolate(`Thread is connected`, args);
}

export function thread_status_error(args: MessageArgs = {}): string {
	return interpolate(`Thread error - click to retry`, args);
}

export function connection_error_title(args: MessageArgs = {}): string {
	return interpolate(`Connection Failed`, args);
}

export function connection_error_description(args: MessageArgs = {}): string {
	return interpolate(
		`We couldn't connect to the agent. Check your credentials and try again.`,
		args
	);
}

export function connection_error_details(args: MessageArgs = {}): string {
	return interpolate(`Details`, args);
}

export function connection_error_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function message_editor_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Type your message... (Enter to send, Shift+Enter for newline)`, args);
}

export function message_input_copy_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy`, args);
}

export function project_empty_title(args: MessageArgs = {}): string {
	return interpolate(`No Repositories Yet`, args);
}

export function project_empty_description(args: MessageArgs = {}): string {
	return interpolate(`Add a repository to start using AI agents in your codebase.`, args);
}

export function project_add(args: MessageArgs = {}): string {
	return interpolate(`Add Repository`, args);
}

export function command_palette_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Type a command...`, args);
}

export function command_palette_tab_commands(args: MessageArgs = {}): string {
	return interpolate(`Commands`, args);
}

export function command_palette_tab_sessions(args: MessageArgs = {}): string {
	return interpolate(`Sessions`, args);
}

export function command_palette_tab_files(args: MessageArgs = {}): string {
	return interpolate(`Files`, args);
}

export function command_palette_search_commands(args: MessageArgs = {}): string {
	return interpolate(`Search commands...`, args);
}

export function command_palette_search_sessions(args: MessageArgs = {}): string {
	return interpolate(`Search conversations...`, args);
}

export function command_palette_search_files(args: MessageArgs = {}): string {
	return interpolate(`Search files...`, args);
}

export function command_palette_recent(args: MessageArgs = {}): string {
	return interpolate(`Recent`, args);
}

export function command_palette_no_results(args: MessageArgs = {}): string {
	return interpolate(`No results found`, args);
}

export function command_palette_cmd_create_thread(args: MessageArgs = {}): string {
	return interpolate(`Create new thread`, args);
}

export function command_palette_cmd_create_thread_desc(args: MessageArgs = {}): string {
	return interpolate(`Start a new conversation`, args);
}

export function command_palette_cmd_open_settings(args: MessageArgs = {}): string {
	return interpolate(`Open settings`, args);
}

export function command_palette_cmd_open_settings_desc(args: MessageArgs = {}): string {
	return interpolate(`Configure application preferences`, args);
}

export function command_palette_cmd_toggle_sidebar(args: MessageArgs = {}): string {
	return interpolate(`Toggle sidebar`, args);
}

export function command_palette_cmd_toggle_sidebar_desc(args: MessageArgs = {}): string {
	return interpolate(`Show or hide the sidebar`, args);
}

export function command_palette_cmd_close_thread(args: MessageArgs = {}): string {
	return interpolate(`Close current thread`, args);
}

export function command_palette_cmd_close_thread_desc(args: MessageArgs = {}): string {
	return interpolate(`Close the active conversation`, args);
}

export function todo_all_completed(args: MessageArgs = {}): string {
	return interpolate(`All tasks completed`, args);
}

export function todo_tasks_paused(args: MessageArgs = {}): string {
	return interpolate(`Tasks paused`, args);
}

export function todo_close_panel(args: MessageArgs = {}): string {
	return interpolate(`Close todo panel`, args);
}

export function todo_heading(args: MessageArgs = {}): string {
	return interpolate(`Tasks`, args);
}

export function todo_progress(args: MessageArgs = {}): string {
	return interpolate(`{completed} of {total} completed`, args);
}

export function plan_view(args: MessageArgs = {}): string {
	return interpolate(`View Plan`, args);
}

export function plan_render_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to render markdown: {error}`, args);
}

export function plan_preview(args: MessageArgs = {}): string {
	return interpolate(`Preview`, args);
}

export function plan_source(args: MessageArgs = {}): string {
	return interpolate(`Source`, args);
}

export function plan_copy(args: MessageArgs = {}): string {
	return interpolate(`Copy`, args);
}

export function plan_copied(args: MessageArgs = {}): string {
	return interpolate(`Plan copied to clipboard`, args);
}

export function plan_copied_short(args: MessageArgs = {}): string {
	return interpolate(`Copied!`, args);
}

export function plan_copy_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy plan`, args);
}

export function plan_download(args: MessageArgs = {}): string {
	return interpolate(`Download`, args);
}

export function plan_downloaded(args: MessageArgs = {}): string {
	return interpolate(`Plan downloaded`, args);
}

export function plan_download_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to download plan`, args);
}

export function plan_metadata(args: MessageArgs = {}): string {
	return interpolate(`Session Plan • {characters} characters • {mode} Mode`, args);
}

export function plan_heading(args: MessageArgs = {}): string {
	return interpolate(`Plan`, args);
}

export function plan_current_step(args: MessageArgs = {}): string {
	return interpolate(`Current step:`, args);
}

export function plan_sidebar_collapse(args: MessageArgs = {}): string {
	return interpolate(`Close`, args);
}

export function plan_sidebar_expand(args: MessageArgs = {}): string {
	return interpolate(`Open`, args);
}

export function plan_sidebar_open_fullscreen(args: MessageArgs = {}): string {
	return interpolate(`Open in fullscreen`, args);
}

export function plan_sidebar_close(args: MessageArgs = {}): string {
	return interpolate(`Close plan sidebar`, args);
}

export function plan_sidebar_open_in_finder(args: MessageArgs = {}): string {
	return interpolate(`Open in Finder`, args);
}

export function plan_sidebar_open_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to open in Finder`, args);
}

export function plan_sidebar_open_error_no_project(args: MessageArgs = {}): string {
	return interpolate(`No project path available`, args);
}

export function plan_sidebar_open_error_no_session(args: MessageArgs = {}): string {
	return interpolate(`No session available`, args);
}

export function plan_sidebar_no_active_session(args: MessageArgs = {}): string {
	return interpolate(`No active session`, args);
}

export function plan_sidebar_send_message_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to send message: {error}`, args);
}

export function plan_sidebar_build_message(args: MessageArgs = {}): string {
	return interpolate(`Please implement this plan.`, args);
}

export function plan_sidebar_build(args: MessageArgs = {}): string {
	return interpolate(`Build`, args);
}

export function plan_sidebar_building(args: MessageArgs = {}): string {
	return interpolate(`Building`, args);
}

export function plan_sidebar_todo_done(args: MessageArgs = {}): string {
	return interpolate(`Done`, args);
}

export function plan_sidebar_todo_running(args: MessageArgs = {}): string {
	return interpolate(`Running`, args);
}

export function plan_sidebar_todo_pending(args: MessageArgs = {}): string {
	return interpolate(`Pending`, args);
}

export function plan_sidebar_todo_cancelled(args: MessageArgs = {}): string {
	return interpolate(`Cancelled`, args);
}

export function link_preview_title(args: MessageArgs = {}): string {
	return interpolate(`Link Preview`, args);
}

export function link_preview_back(args: MessageArgs = {}): string {
	return interpolate(`Go back`, args);
}

export function link_preview_forward(args: MessageArgs = {}): string {
	return interpolate(`Go forward`, args);
}

export function link_preview_refresh(args: MessageArgs = {}): string {
	return interpolate(`Refresh`, args);
}

export function link_preview_open_browser(args: MessageArgs = {}): string {
	return interpolate(`Open in browser`, args);
}

export function link_preview_error_title(args: MessageArgs = {}): string {
	return interpolate(`Unable to load page`, args);
}

export function link_preview_error_description(args: MessageArgs = {}): string {
	return interpolate(
		`This page cannot be displayed in the preview. Some websites block being embedded in other applications.`,
		args
	);
}

export function link_preview_try_again(args: MessageArgs = {}): string {
	return interpolate(`Try again`, args);
}

export function tool_call_expand_diff(args: MessageArgs = {}): string {
	return interpolate(`Expand diff view`, args);
}

export function tool_call_collapse_diff(args: MessageArgs = {}): string {
	return interpolate(`Collapse diff view`, args);
}

export function tool_call_expand_content(args: MessageArgs = {}): string {
	return interpolate(`Expand content view`, args);
}

export function tool_call_collapse_content(args: MessageArgs = {}): string {
	return interpolate(`Collapse content to few lines`, args);
}

export function tool_call_view_diff(args: MessageArgs = {}): string {
	return interpolate(`Diff`, args);
}

export function tool_call_view_preview(args: MessageArgs = {}): string {
	return interpolate(`Preview`, args);
}

export function workspace_no_threads_title(args: MessageArgs = {}): string {
	return interpolate(`No active threads`, args);
}

export function workspace_no_threads_description(args: MessageArgs = {}): string {
	return interpolate(`Create a new thread or select one from the sidebar to get started`, args);
}

export function workspace_create_first_thread(args: MessageArgs = {}): string {
	return interpolate(`Create Thread`, args);
}

export function project_settings(args: MessageArgs = {}): string {
	return interpolate(`Project Settings`, args);
}

export function project_color(args: MessageArgs = {}): string {
	return interpolate(`Color`, args);
}

export function project_icon_change(args: MessageArgs = {}): string {
	return interpolate(`Change icon...`, args);
}

export function project_icon_reset(args: MessageArgs = {}): string {
	return interpolate(`Reset to letter badge`, args);
}

export function project_move_up(args: MessageArgs = {}): string {
	return interpolate(`Move Up`, args);
}

export function project_move_down(args: MessageArgs = {}): string {
	return interpolate(`Move Down`, args);
}

export function project_reorder_announcement(args: MessageArgs = {}): string {
	return interpolate(`Moved {projectName} to position {position} of {total}`, args);
}

export function project_color_red(args: MessageArgs = {}): string {
	return interpolate(`Red`, args);
}

export function project_color_orange(args: MessageArgs = {}): string {
	return interpolate(`Orange`, args);
}

export function project_color_amber(args: MessageArgs = {}): string {
	return interpolate(`Amber`, args);
}

export function project_color_yellow(args: MessageArgs = {}): string {
	return interpolate(`Yellow`, args);
}

export function project_color_lime(args: MessageArgs = {}): string {
	return interpolate(`Lime`, args);
}

export function project_color_green(args: MessageArgs = {}): string {
	return interpolate(`Green`, args);
}

export function project_color_teal(args: MessageArgs = {}): string {
	return interpolate(`Teal`, args);
}

export function project_color_cyan(args: MessageArgs = {}): string {
	return interpolate(`Cyan`, args);
}

export function project_color_blue(args: MessageArgs = {}): string {
	return interpolate(`Blue`, args);
}

export function project_color_indigo(args: MessageArgs = {}): string {
	return interpolate(`Indigo`, args);
}

export function project_color_purple(args: MessageArgs = {}): string {
	return interpolate(`Purple`, args);
}

export function project_color_pink(args: MessageArgs = {}): string {
	return interpolate(`Pink`, args);
}

export function project_remove(args: MessageArgs = {}): string {
	return interpolate(`Remove Project`, args);
}

export function project_remove_confirm_title(args: MessageArgs = {}): string {
	return interpolate(`Remove Project`, args);
}

export function project_remove_confirm_description(args: MessageArgs = {}): string {
	return interpolate(
		`Remove "{projectName}" from your workspace? This will not delete any files.`,
		args
	);
}

export function panel_fullscreen(args: MessageArgs = {}): string {
	return interpolate(`Fullscreen`, args);
}

export function panel_exit_fullscreen(args: MessageArgs = {}): string {
	return interpolate(`Exit Fullscreen`, args);
}

export function panel_tabs_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Click to focus panel`, args);
}

export function bun_suggestion_title(args: MessageArgs = {}): string {
	return interpolate(`Speed up sessions`, args);
}

export function bun_suggestion_description(args: MessageArgs = {}): string {
	return interpolate(`Install Bun for 10x faster loading`, args);
}

export function bun_install_dialog_title(args: MessageArgs = {}): string {
	return interpolate(`Install Bun`, args);
}

export function bun_install_dialog_description(args: MessageArgs = {}): string {
	return interpolate(
		`Bun is a fast JavaScript runtime that significantly improves session startup time.`,
		args
	);
}

export function bun_install_method_brew(args: MessageArgs = {}): string {
	return interpolate(`Homebrew`, args);
}

export function bun_install_method_npm(args: MessageArgs = {}): string {
	return interpolate(`NPM`, args);
}

export function bun_install_method_curl(args: MessageArgs = {}): string {
	return interpolate(`Curl (Official)`, args);
}

export function bun_install_button(args: MessageArgs = {}): string {
	return interpolate(`Install`, args);
}

export function bun_installing(args: MessageArgs = {}): string {
	return interpolate(`Installing...`, args);
}

export function bun_install_success(args: MessageArgs = {}): string {
	return interpolate(`Bun installed! Sessions will now load faster.`, args);
}

export function bun_install_error(args: MessageArgs = {}): string {
	return interpolate(`Installation failed. Try installing manually.`, args);
}

export function bun_install_no_methods(args: MessageArgs = {}): string {
	return interpolate(`No installation methods available. Please install bun manually.`, args);
}

export function search_label(args: MessageArgs = {}): string {
	return interpolate(`Search`, args);
}

export function tool_call_result_label(args: MessageArgs = {}): string {
	return interpolate(`Result:`, args);
}

export function api_key_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Enter API key...`, args);
}

export function markdown_render_error(args: MessageArgs = {}): string {
	return interpolate(`Markdown rendering failed: {error}`, args);
}

export function mermaid_loading(args: MessageArgs = {}): string {
	return interpolate(`Rendering diagram...`, args);
}

export function mermaid_render_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to render diagram`, args);
}

export function mermaid_show_source(args: MessageArgs = {}): string {
	return interpolate(`Show source`, args);
}

export function mermaid_hide_source(args: MessageArgs = {}): string {
	return interpolate(`Hide source`, args);
}

export function keybinding_open_settings(args: MessageArgs = {}): string {
	return interpolate(`Open Settings`, args);
}

export function keybinding_toggle_command_palette(args: MessageArgs = {}): string {
	return interpolate(`Toggle Command Palette`, args);
}

export function keybinding_toggle_model_selector(args: MessageArgs = {}): string {
	return interpolate(`Toggle Model Selector`, args);
}

export function keybinding_toggle_mode_selector(args: MessageArgs = {}): string {
	return interpolate(`Toggle Mode Selector`, args);
}

export function keybinding_toggle_model_selector_description(args: MessageArgs = {}): string {
	return interpolate(`Open or close the model selector dropdown`, args);
}

export function keybinding_toggle_mode_selector_description(args: MessageArgs = {}): string {
	return interpolate(`Open or close the mode selector dropdown`, args);
}

export function keybinding_close_thread(args: MessageArgs = {}): string {
	return interpolate(`Close Thread`, args);
}

export function keybinding_close_thread_description(args: MessageArgs = {}): string {
	return interpolate(`Close the currently focused thread panel`, args);
}

export function keybinding_toggle_sidebar(args: MessageArgs = {}): string {
	return interpolate(`Toggle Sidebar`, args);
}

export function keybinding_toggle_sidebar_description(args: MessageArgs = {}): string {
	return interpolate(`Show or hide the sidebar`, args);
}

export function keybinding_zoom_in(args: MessageArgs = {}): string {
	return interpolate(`Zoom In`, args);
}

export function keybinding_zoom_in_description(args: MessageArgs = {}): string {
	return interpolate(`Increase the zoom level`, args);
}

export function keybinding_zoom_out(args: MessageArgs = {}): string {
	return interpolate(`Zoom Out`, args);
}

export function keybinding_zoom_out_description(args: MessageArgs = {}): string {
	return interpolate(`Decrease the zoom level`, args);
}

export function keybinding_zoom_reset(args: MessageArgs = {}): string {
	return interpolate(`Reset Zoom`, args);
}

export function keybinding_zoom_reset_description(args: MessageArgs = {}): string {
	return interpolate(`Reset zoom to 100%`, args);
}

export function keybinding_jump_to_urgent(args: MessageArgs = {}): string {
	return interpolate(`Jump to Urgent`, args);
}

export function keybinding_jump_to_urgent_description(args: MessageArgs = {}): string {
	return interpolate(`Focus the most urgent tab (asking question or error)`, args);
}

export function alt_bun_logo(args: MessageArgs = {}): string {
	return interpolate(`Bun`, args);
}

export function alt_agent_icon(args: MessageArgs = {}): string {
	return interpolate(`Agent`, args);
}

export function toast_no_content_to_copy(args: MessageArgs = {}): string {
	return interpolate(`No content to copy`, args);
}

export function toast_copied_to_clipboard(args: MessageArgs = {}): string {
	return interpolate(`Copied to clipboard`, args);
}

export function toast_error_copied(args: MessageArgs = {}): string {
	return interpolate(`Error message copied to clipboard`, args);
}

export function toast_error_copy_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy error message`, args);
}

export function toast_fix_prompt_copied(args: MessageArgs = {}): string {
	return interpolate(`Fix prompt copied to clipboard`, args);
}

export function toast_fix_prompt_copy_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy fix prompt`, args);
}

export function toast_color_update_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to update color: {error}`, args);
}

export function search_conversations_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Search conversations...`, args);
}

export function sr_only_send_message(args: MessageArgs = {}): string {
	return interpolate(`Send message`, args);
}

export function sr_only_toggle_theme(args: MessageArgs = {}): string {
	return interpolate(`Toggle theme`, args);
}

export function sr_only_toggle_sidebar(args: MessageArgs = {}): string {
	return interpolate(`Toggle Sidebar`, args);
}

export function sr_only_more(args: MessageArgs = {}): string {
	return interpolate(`More`, args);
}

export function sr_only_more_pages(args: MessageArgs = {}): string {
	return interpolate(`More pages`, args);
}

export function sr_only_next_slide(args: MessageArgs = {}): string {
	return interpolate(`Next slide`, args);
}

export function sr_only_previous_slide(args: MessageArgs = {}): string {
	return interpolate(`Previous slide`, args);
}

export function sr_only_close(args: MessageArgs = {}): string {
	return interpolate(`Close`, args);
}

export function sr_only_first_page(args: MessageArgs = {}): string {
	return interpolate(`First page`, args);
}

export function sr_only_previous_page(args: MessageArgs = {}): string {
	return interpolate(`Previous page`, args);
}

export function sr_only_next_page(args: MessageArgs = {}): string {
	return interpolate(`Next page`, args);
}

export function sr_only_last_page(args: MessageArgs = {}): string {
	return interpolate(`Last page`, args);
}

export function sr_only_actions(args: MessageArgs = {}): string {
	return interpolate(`Actions`, args);
}

export function button_copy(args: MessageArgs = {}): string {
	return interpolate(`Copy`, args);
}

export function button_copy_error(args: MessageArgs = {}): string {
	return interpolate(`Copy Error`, args);
}

export function button_copied(args: MessageArgs = {}): string {
	return interpolate(`Copied`, args);
}

export function button_fix_with_cursor(args: MessageArgs = {}): string {
	return interpolate(`Fix with Cursor`, args);
}

export function button_reload(args: MessageArgs = {}): string {
	return interpolate(`Reload`, args);
}

export function settings_language_title(args: MessageArgs = {}): string {
	return interpolate(`Language`, args);
}

export function settings_language_description(args: MessageArgs = {}): string {
	return interpolate(`Choose your preferred language for the application interface.`, args);
}

export function settings_supported_languages(args: MessageArgs = {}): string {
	return interpolate(`Supported Languages`, args);
}

export function theme_light(args: MessageArgs = {}): string {
	return interpolate(`Light`, args);
}

export function theme_dark(args: MessageArgs = {}): string {
	return interpolate(`Dark`, args);
}

export function theme_system(args: MessageArgs = {}): string {
	return interpolate(`System`, args);
}

export function sidebar_title(args: MessageArgs = {}): string {
	return interpolate(`Sidebar`, args);
}

export function sidebar_description(args: MessageArgs = {}): string {
	return interpolate(`Displays the mobile sidebar.`, args);
}

export function sidebar_group_changes(args: MessageArgs = {}): string {
	return interpolate(`Changes`, args);
}

export function sidebar_group_files(args: MessageArgs = {}): string {
	return interpolate(`Files`, args);
}

export function model_selector_cycle_modes(args: MessageArgs = {}): string {
	return interpolate(`Cycle modes:`, args);
}

export function model_selector_select_model(args: MessageArgs = {}): string {
	return interpolate(`Select model`, args);
}

export function model_selector_loading_models(args: MessageArgs = {}): string {
	return interpolate(`Loading models`, args);
}

export function model_selector_favorites(args: MessageArgs = {}): string {
	return interpolate(`Favorites`, args);
}

export function model_selector_search_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Search models...`, args);
}

export function model_selector_reasoning_effort_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Reasoning effort`, args);
}

export function model_selector_tooltip_label(args: MessageArgs = {}): string {
	return interpolate(`Model`, args);
}

export function model_selector_tooltip_label_for_agent(args: MessageArgs = {}): string {
	return interpolate(`Select model for {agentName}`, args);
}

export function agent_panel_placeholder_shortcuts_new_thread(args: MessageArgs = {}): string {
	return interpolate(`New Thread`, args);
}

export function agent_panel_placeholder_shortcuts_submit(args: MessageArgs = {}): string {
	return interpolate(`Submit Message`, args);
}

export function agent_panel_placeholder_shortcuts_toggle_agent(args: MessageArgs = {}): string {
	return interpolate(`Toggle Agent`, args);
}

export function slash_command_header(args: MessageArgs = {}): string {
	return interpolate(`Commands`, args);
}

export function slash_command_no_results(args: MessageArgs = {}): string {
	return interpolate(`No commands found`, args);
}

export function slash_command_no_commands_available(args: MessageArgs = {}): string {
	return interpolate(`No commands available`, args);
}

export function slash_command_start_typing(args: MessageArgs = {}): string {
	return interpolate(`Start typing to search commands...`, args);
}

export function slash_command_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Search commands...`, args);
}

export function slash_command_select_hint(args: MessageArgs = {}): string {
	return interpolate(`to select`, args);
}

export function slash_command_close_hint(args: MessageArgs = {}): string {
	return interpolate(`to close`, args);
}

export function file_picker_header(args: MessageArgs = {}): string {
	return interpolate(`Add file context`, args);
}

export function file_picker_no_results(args: MessageArgs = {}): string {
	return interpolate(`No matching files`, args);
}

export function file_picker_select_hint(args: MessageArgs = {}): string {
	return interpolate(`to select`, args);
}

export function file_picker_close_hint(args: MessageArgs = {}): string {
	return interpolate(`to close`, args);
}

export function modified_files_count(args: MessageArgs = {}): string {
	return interpolate(`{count} files changed`, args);
}

export function modified_files_heading(args: MessageArgs = {}): string {
	return interpolate(`Modified Files`, args);
}

export function modified_files_edit_count(args: MessageArgs = {}): string {
	return interpolate(`{count} edits`, args);
}

export function modified_files_close_panel(args: MessageArgs = {}): string {
	return interpolate(`Close modified files panel`, args);
}

export function modified_files_diff_preview(args: MessageArgs = {}): string {
	return interpolate(`Recent Changes`, args);
}

export function modified_files_versions(args: MessageArgs = {}): string {
	return interpolate(`versions`, args);
}

export function modified_files_review_title(args: MessageArgs = {}): string {
	return interpolate(`Review Changes`, args);
}

export function modified_files_review_button(args: MessageArgs = {}): string {
	return interpolate(`Review`, args);
}

export function modified_files_review_panel(args: MessageArgs = {}): string {
	return interpolate(`Panel`, args);
}

export function modified_files_review_fullscreen(args: MessageArgs = {}): string {
	return interpolate(`Fullscreen`, args);
}

export function modified_files_back_button(args: MessageArgs = {}): string {
	return interpolate(`Back`, args);
}

export function modified_files_next_file_button(args: MessageArgs = {}): string {
	return interpolate(`Next`, args);
}

export function review_accept_file(args: MessageArgs = {}): string {
	return interpolate(`Accept file`, args);
}

export function review_reject_file(args: MessageArgs = {}): string {
	return interpolate(`Reject file`, args);
}

export function review_undo(args: MessageArgs = {}): string {
	return interpolate(`Undo`, args);
}

export function review_applied(args: MessageArgs = {}): string {
	return interpolate(`Applied`, args);
}

export function review_keep(args: MessageArgs = {}): string {
	return interpolate(`Keep`, args);
}

export function review_prev_hunk(args: MessageArgs = {}): string {
	return interpolate(`Previous hunk`, args);
}

export function review_next_hunk(args: MessageArgs = {}): string {
	return interpolate(`Next hunk`, args);
}

export function review_scroll_top(args: MessageArgs = {}): string {
	return interpolate(`Scroll to top`, args);
}

export function review_scroll_bottom(args: MessageArgs = {}): string {
	return interpolate(`Scroll to bottom`, args);
}

export function review_prev_file(args: MessageArgs = {}): string {
	return interpolate(`Previous file`, args);
}

export function review_next_file(args: MessageArgs = {}): string {
	return interpolate(`Next file`, args);
}

export function review_next_file_cta(args: MessageArgs = {}): string {
	return interpolate(`Review next file`, args);
}

export function review_status_accepted_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Fully accepted`, args);
}

export function review_status_partial_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Partially reviewed`, args);
}

export function review_status_denied_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Rejected`, args);
}

export function add_repository_button(args: MessageArgs = {}): string {
	return interpolate(`Add repository`, args);
}

export function add_repository_import_project(args: MessageArgs = {}): string {
	return interpolate(`Import project`, args);
}

export function add_repository_browse_folder(args: MessageArgs = {}): string {
	return interpolate(`Browse folder`, args);
}

export function add_repository_clone_repository(args: MessageArgs = {}): string {
	return interpolate(`Clone repository`, args);
}

export function open_project_title(args: MessageArgs = {}): string {
	return interpolate(`Import Project`, args);
}

export function open_project_description(args: MessageArgs = {}): string {
	return interpolate(`Select a project with existing sessions to open`, args);
}

export function open_project_description_detail(args: MessageArgs = {}): string {
	return interpolate(
		`Projects discovered from your agent session history. Click to import a project into Acepe and access its sessions.`,
		args
	);
}

export function open_project_empty(args: MessageArgs = {}): string {
	return interpolate(`No projects with sessions found`, args);
}

export function open_project_empty_hint(args: MessageArgs = {}): string {
	return interpolate(
		`Start a session with an agent in a project directory, then come back here to import it.`,
		args
	);
}

export function open_project_loading(args: MessageArgs = {}): string {
	return interpolate(`Scanning projects...`, args);
}

export function open_project_scanning(args: MessageArgs = {}): string {
	return interpolate(`Scanning for projects...`, args);
}

export function open_project_import(args: MessageArgs = {}): string {
	return interpolate(`Import`, args);
}

export function open_project_open(args: MessageArgs = {}): string {
	return interpolate(`Open`, args);
}

export function open_project_scan_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to scan projects`, args);
}

export function open_project_name(args: MessageArgs = {}): string {
	return interpolate(`Repository`, args);
}

export function open_project_added(args: MessageArgs = {}): string {
	return interpolate(`Added`, args);
}

export function open_project_added_toast(args: MessageArgs = {}): string {
	return interpolate(`{name} added to repositories`, args);
}

export function open_project_table_header(args: MessageArgs = {}): string {
	return interpolate(`Discovered Projects`, args);
}

export function open_project_found_count(args: MessageArgs = {}): string {
	return interpolate(`{count} projects found`, args);
}

export function open_project_filtered_count(args: MessageArgs = {}): string {
	return interpolate(`{visible} of {total} projects`, args);
}

export function open_project_imported_count(args: MessageArgs = {}): string {
	return interpolate(`{count} imported`, args);
}

export function open_project_search_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Filter projects...`, args);
}

export function clone_repository_title(args: MessageArgs = {}): string {
	return interpolate(`Clone Repository`, args);
}

export function clone_repository_description(args: MessageArgs = {}): string {
	return interpolate(`Clone a git repository to your machine`, args);
}

export function clone_repository_url_label(args: MessageArgs = {}): string {
	return interpolate(`Repository URL`, args);
}

export function clone_repository_url_placeholder(args: MessageArgs = {}): string {
	return interpolate(`https://github.com/user/repo.git`, args);
}

export function clone_repository_destination_label(args: MessageArgs = {}): string {
	return interpolate(`Destination`, args);
}

export function clone_repository_destination_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Select a folder...`, args);
}

export function clone_repository_browse(args: MessageArgs = {}): string {
	return interpolate(`Browse`, args);
}

export function clone_repository_browse_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to browse for folder`, args);
}

export function clone_repository_branch_label(args: MessageArgs = {}): string {
	return interpolate(`Branch`, args);
}

export function clone_repository_clone(args: MessageArgs = {}): string {
	return interpolate(`Clone`, args);
}

export function clone_repository_cloning(args: MessageArgs = {}): string {
	return interpolate(`Cloning...`, args);
}

export function clone_repository_success(args: MessageArgs = {}): string {
	return interpolate(`Repository cloned successfully`, args);
}

export function clone_repository_error(args: MessageArgs = {}): string {
	return interpolate(`Clone failed: {error}`, args);
}

export function sidebar_view_sessions(args: MessageArgs = {}): string {
	return interpolate(`Sessions`, args);
}

export function sidebar_view_files(args: MessageArgs = {}): string {
	return interpolate(`Files`, args);
}

export function file_list_empty(args: MessageArgs = {}): string {
	return interpolate(`No files found`, args);
}

export function file_list_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading files...`, args);
}

export function file_list_copy_path(args: MessageArgs = {}): string {
	return interpolate(`Copy path`, args);
}

export function file_list_reveal_in_finder(args: MessageArgs = {}): string {
	return interpolate(`Reveal in Finder`, args);
}

export function file_list_refresh(args: MessageArgs = {}): string {
	return interpolate(`Refresh`, args);
}

export function file_list_copy_path_toast(args: MessageArgs = {}): string {
	return interpolate(`Path copied to clipboard`, args);
}

export function file_list_copy_path_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to copy path`, args);
}

export function file_list_delete(args: MessageArgs = {}): string {
	return interpolate(`Delete`, args);
}

export function file_list_delete_confirm_title(args: MessageArgs = {}): string {
	return interpolate(`Delete item?`, args);
}

export function file_list_delete_confirm_file(args: MessageArgs = {}): string {
	return interpolate(`Delete "{name}"? This cannot be undone.`, args);
}

export function file_list_delete_confirm_folder(args: MessageArgs = {}): string {
	return interpolate(`Delete folder "{name}" and its contents? This cannot be undone.`, args);
}

export function file_list_delete_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to delete: {error}`, args);
}

export function file_list_rename(args: MessageArgs = {}): string {
	return interpolate(`Rename`, args);
}

export function file_list_rename_prompt(args: MessageArgs = {}): string {
	return interpolate(`New name`, args);
}

export function file_list_rename_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to rename: {error}`, args);
}

export function file_list_duplicate(args: MessageArgs = {}): string {
	return interpolate(`Duplicate`, args);
}

export function file_list_duplicate_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to duplicate: {error}`, args);
}

export function file_list_new_file(args: MessageArgs = {}): string {
	return interpolate(`New file`, args);
}

export function file_list_new_folder(args: MessageArgs = {}): string {
	return interpolate(`New folder`, args);
}

export function file_list_new_file_prompt(args: MessageArgs = {}): string {
	return interpolate(`File name`, args);
}

export function file_list_new_folder_prompt(args: MessageArgs = {}): string {
	return interpolate(`Folder name`, args);
}

export function file_list_new_file_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to create file: {error}`, args);
}

export function file_list_new_folder_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to create folder: {error}`, args);
}

export function file_panel_open_in_finder(args: MessageArgs = {}): string {
	return interpolate(`Open in Finder`, args);
}

export function file_panel_open_in_finder_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to open in Finder`, args);
}

export function file_panel_read_error_title(args: MessageArgs = {}): string {
	return interpolate(`Couldn't read file`, args);
}

export function file_panel_git_status_modified(args: MessageArgs = {}): string {
	return interpolate(`Modified`, args);
}

export function file_panel_git_status_added(args: MessageArgs = {}): string {
	return interpolate(`Added`, args);
}

export function file_panel_git_status_deleted(args: MessageArgs = {}): string {
	return interpolate(`Deleted`, args);
}

export function file_panel_git_status_renamed(args: MessageArgs = {}): string {
	return interpolate(`Renamed`, args);
}

export function file_panel_git_status_untracked(args: MessageArgs = {}): string {
	return interpolate(`Untracked`, args);
}

export function project_unknown(args: MessageArgs = {}): string {
	return interpolate(`Unknown`, args);
}

export function welcome_pro(args: MessageArgs = {}): string {
	return interpolate(`Pro`, args);
}

export function welcome_settings(args: MessageArgs = {}): string {
	return interpolate(`Settings`, args);
}

export function welcome_open_project(args: MessageArgs = {}): string {
	return interpolate(`Open project`, args);
}

export function welcome_clone_repo(args: MessageArgs = {}): string {
	return interpolate(`Clone repo`, args);
}

export function welcome_choose_agents(args: MessageArgs = {}): string {
	return interpolate(`Choose your agents`, args);
}

export function welcome_agents_description(args: MessageArgs = {}): string {
	return interpolate(
		`Select one or more AI agents to use. You can always change this later in settings.`,
		args
	);
}

export function welcome_continue(args: MessageArgs = {}): string {
	return interpolate(`Continue`, args);
}

export function welcome_skip_for_now(args: MessageArgs = {}): string {
	return interpolate(`Skip for now`, args);
}

export function welcome_finish(args: MessageArgs = {}): string {
	return interpolate(`Finish`, args);
}

export function welcome_onboarding_choose_agents(args: MessageArgs = {}): string {
	return interpolate(`Choose your agents`, args);
}

export function welcome_onboarding_choose_agents_description(args: MessageArgs = {}): string {
	return interpolate(
		`Select the agents you want to use in Acepe. You can change this anytime in Settings.`,
		args
	);
}

export function welcome_onboarding_select_projects(args: MessageArgs = {}): string {
	return interpolate(`Select projects to import`, args);
}

export function welcome_onboarding_select_projects_description(args: MessageArgs = {}): string {
	return interpolate(
		`Choose which discovered projects you want to import now. You can skip and import later.`,
		args
	);
}

export function onboarding_projects_no_match(args: MessageArgs = {}): string {
	return interpolate(`No projects found with selected agents`, args);
}

export function onboarding_projects_change_agents(args: MessageArgs = {}): string {
	return interpolate(`Go back to select different agents, or skip importing for now.`, args);
}

export function welcome_onboarding_finish(args: MessageArgs = {}): string {
	return interpolate(`Finish`, args);
}

export function welcome_onboarding_skip(args: MessageArgs = {}): string {
	return interpolate(`Skip for now`, args);
}

export function welcome_onboarding_loading_sessions(args: MessageArgs = {}): string {
	return interpolate(`Discovering sessions...`, args);
}

export function welcome_onboarding_importing(args: MessageArgs = {}): string {
	return interpolate(`Importing projects and discovering sessions...`, args);
}

export function welcome_onboarding_no_projects(args: MessageArgs = {}): string {
	return interpolate(`No projects with sessions found.`, args);
}

export function welcome_onboarding_select_agent_error(args: MessageArgs = {}): string {
	return interpolate(`Select at least one agent.`, args);
}

export function welcome_onboarding_loading_counts(args: MessageArgs = {}): string {
	return interpolate(`Loading...`, args);
}

export function welcome_onboarding_error_counts(args: MessageArgs = {}): string {
	return interpolate(`Error`, args);
}

export function welcome_onboarding_sessions(args: MessageArgs = {}): string {
	return interpolate(`{count} sessions`, args);
}

export function welcome_recent_projects(args: MessageArgs = {}): string {
	return interpolate(`Recent projects`, args);
}

export function welcome_view_all(args: MessageArgs = {}): string {
	return interpolate(`View all ({count})`, args);
}

export function welcome_no_recent_projects(args: MessageArgs = {}): string {
	return interpolate(`No recent projects found`, args);
}

export function welcome_import_project(args: MessageArgs = {}): string {
	return interpolate(`Import`, args);
}

export function top_bar_search_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Search...`, args);
}

export function top_bar_command_palette(args: MessageArgs = {}): string {
	return interpolate(`Command Palette`, args);
}

export function top_bar_user_menu(args: MessageArgs = {}): string {
	return interpolate(`User menu`, args);
}

export function review_undo_change(args: MessageArgs = {}): string {
	return interpolate(`Undo`, args);
}

export function review_keep_change(args: MessageArgs = {}): string {
	return interpolate(`Keep`, args);
}

export function tool_task_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing task`, args);
}

export function tool_task_running(args: MessageArgs = {}): string {
	return interpolate(`Running task`, args);
}

export function tool_task_completed(args: MessageArgs = {}): string {
	return interpolate(`Task completed`, args);
}

export function tool_grep_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing search`, args);
}

export function tool_grep_running(args: MessageArgs = {}): string {
	return interpolate(`Grepping`, args);
}

export function tool_grep_grepped(args: MessageArgs = {}): string {
	return interpolate(`Grepped`, args);
}

export function tool_grep_results(args: MessageArgs = {}): string {
	return interpolate(`Grepped {count} files`, args);
}

export function tool_grep_no_matches(args: MessageArgs = {}): string {
	return interpolate(`No matches`, args);
}

export function tool_grep_completed(args: MessageArgs = {}): string {
	return interpolate(`Grep`, args);
}

export function tool_grep_found_files(args: MessageArgs = {}): string {
	return interpolate(`Found {count} files`, args);
}

export function tool_grep_found_matches(args: MessageArgs = {}): string {
	return interpolate(`Found {count} matches`, args);
}

export function tool_grep_for(args: MessageArgs = {}): string {
	return interpolate(`for`, args);
}

export function tool_glob_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing search`, args);
}

export function tool_glob_running(args: MessageArgs = {}): string {
	return interpolate(`Exploring files`, args);
}

export function tool_glob_results(args: MessageArgs = {}): string {
	return interpolate(`Found {count} files`, args);
}

export function tool_glob_no_results(args: MessageArgs = {}): string {
	return interpolate(`No files found`, args);
}

export function tool_read_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing to read`, args);
}

export function tool_read_running(args: MessageArgs = {}): string {
	return interpolate(`Reading`, args);
}

export function tool_read_completed(args: MessageArgs = {}): string {
	return interpolate(`Read`, args);
}

export function tool_read_lints_running(args: MessageArgs = {}): string {
	return interpolate(`Checking lints`, args);
}

export function tool_read_lints_done(args: MessageArgs = {}): string {
	return interpolate(`Read lints`, args);
}

export function tool_read_lints_no_issues(args: MessageArgs = {}): string {
	return interpolate(`No issues`, args);
}

export function tool_read_lints_summary(args: MessageArgs = {}): string {
	return interpolate(`{count} issues in {files} files`, args);
}

export function tool_read_lints_aria_collapse(args: MessageArgs = {}): string {
	return interpolate(`Collapse lint results`, args);
}

export function tool_read_lints_aria_expand(args: MessageArgs = {}): string {
	return interpolate(`Expand lint results`, args);
}

export function tool_edit_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing edit`, args);
}

export function tool_edit_running(args: MessageArgs = {}): string {
	return interpolate(`Editing`, args);
}

export function tool_edit_completed(args: MessageArgs = {}): string {
	return interpolate(`Edited`, args);
}

export function tool_edit_completed_stats(args: MessageArgs = {}): string {
	return interpolate(`Edited (+{added}/-{removed})`, args);
}

export function tool_write_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing to write`, args);
}

export function tool_write_running(args: MessageArgs = {}): string {
	return interpolate(`Writing`, args);
}

export function tool_write_completed(args: MessageArgs = {}): string {
	return interpolate(`Wrote`, args);
}

export function tool_notebook_edit_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing edit`, args);
}

export function tool_notebook_edit_running(args: MessageArgs = {}): string {
	return interpolate(`Editing notebook`, args);
}

export function tool_notebook_edit_completed(args: MessageArgs = {}): string {
	return interpolate(`Edited notebook`, args);
}

export function tool_bash_preparing(args: MessageArgs = {}): string {
	return interpolate(`Generating command`, args);
}

export function tool_bash_running(args: MessageArgs = {}): string {
	return interpolate(`Running command`, args);
}

export function tool_bash_completed(args: MessageArgs = {}): string {
	return interpolate(`Executed`, args);
}

export function tool_kill_shell_running(args: MessageArgs = {}): string {
	return interpolate(`Killing shell`, args);
}

export function tool_kill_shell_completed(args: MessageArgs = {}): string {
	return interpolate(`Killed shell`, args);
}

export function tool_task_output_running(args: MessageArgs = {}): string {
	return interpolate(`Getting output`, args);
}

export function tool_task_output_completed(args: MessageArgs = {}): string {
	return interpolate(`Got output`, args);
}

export function tool_web_fetch_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing fetch`, args);
}

export function tool_web_fetch_running(args: MessageArgs = {}): string {
	return interpolate(`Fetching`, args);
}

export function tool_web_fetch_completed(args: MessageArgs = {}): string {
	return interpolate(`Fetched`, args);
}

export function tool_web_search_preparing(args: MessageArgs = {}): string {
	return interpolate(`Preparing search`, args);
}

export function tool_web_search_running(args: MessageArgs = {}): string {
	return interpolate(`Searching`, args);
}

export function tool_web_search_results(args: MessageArgs = {}): string {
	return interpolate(`Found {count} results`, args);
}

export function tool_web_search_no_results(args: MessageArgs = {}): string {
	return interpolate(`No results found`, args);
}

export function tool_todo_running(args: MessageArgs = {}): string {
	return interpolate(`Updating todos`, args);
}

export function tool_todo_completed(args: MessageArgs = {}): string {
	return interpolate(`Updated todos`, args);
}

export function tool_ask_running(args: MessageArgs = {}): string {
	return interpolate(`Asking question`, args);
}

export function tool_ask_completed(args: MessageArgs = {}): string {
	return interpolate(`Asked question`, args);
}

export function tool_question_waiting(args: MessageArgs = {}): string {
	return interpolate(`Waiting for question...`, args);
}

export function tool_question_label(args: MessageArgs = {}): string {
	return interpolate(`Question`, args);
}

export function tool_question_cancelled_label(args: MessageArgs = {}): string {
	return interpolate(`Cancelled`, args);
}

export function tool_question_cancelled_description(args: MessageArgs = {}): string {
	return interpolate(`Question was cancelled without an answer.`, args);
}

export function tool_question_no_answer(args: MessageArgs = {}): string {
	return interpolate(`No answer`, args);
}

export function tool_question_other_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Other...`, args);
}

export function tool_question_cancel(args: MessageArgs = {}): string {
	return interpolate(`Cancel`, args);
}

export function tool_question_submit(args: MessageArgs = {}): string {
	return interpolate(`Submit`, args);
}

export function tool_skill_running(args: MessageArgs = {}): string {
	return interpolate(`Running {name}`, args);
}

export function tool_skill_completed(args: MessageArgs = {}): string {
	return interpolate(`Ran {name}`, args);
}

export function tool_thinking(args: MessageArgs = {}): string {
	return interpolate(`Thinking`, args);
}

export function tool_thinking_streaming(args: MessageArgs = {}): string {
	return interpolate(`Thinking`, args);
}

export function tool_thinking_done(args: MessageArgs = {}): string {
	return interpolate(`Thought`, args);
}

export function tool_thinking_done_duration(args: MessageArgs = {}): string {
	return interpolate(`Thought for {seconds}s`, args);
}

export function tool_enter_plan_mode_running(args: MessageArgs = {}): string {
	return interpolate(`Entering plan mode`, args);
}

export function tool_enter_plan_mode_completed(args: MessageArgs = {}): string {
	return interpolate(`Entered plan mode`, args);
}

export function tool_exit_plan_mode_running(args: MessageArgs = {}): string {
	return interpolate(`Reviewing plan`, args);
}

export function tool_exit_plan_mode_completed(args: MessageArgs = {}): string {
	return interpolate(`Plan ready`, args);
}

export function tool_create_plan_running(args: MessageArgs = {}): string {
	return interpolate(`Creating plan`, args);
}

export function tool_create_plan_completed(args: MessageArgs = {}): string {
	return interpolate(`Created plan`, args);
}

export function tool_tool_search_running(args: MessageArgs = {}): string {
	return interpolate(`Loading tools`, args);
}

export function tool_tool_search_completed(args: MessageArgs = {}): string {
	return interpolate(`Loaded tools`, args);
}

export function tool_move_running(args: MessageArgs = {}): string {
	return interpolate(`Moving`, args);
}

export function tool_move_completed(args: MessageArgs = {}): string {
	return interpolate(`Moved`, args);
}

export function tool_delete_running(args: MessageArgs = {}): string {
	return interpolate(`Deleting`, args);
}

export function tool_delete_completed(args: MessageArgs = {}): string {
	return interpolate(`Deleted`, args);
}

export function waiting_planning_next_moves(args: MessageArgs = {}): string {
	return interpolate(`Planning next moves`, args);
}

export function sidebar_open_terminal(args: MessageArgs = {}): string {
	return interpolate(`Open terminal in {projectName}`, args);
}

export function sidebar_open_browser(args: MessageArgs = {}): string {
	return interpolate(`Open browser in {projectName}`, args);
}

export function terminal_panel_title(args: MessageArgs = {}): string {
	return interpolate(`Terminal`, args);
}

export function terminal_new_tab(args: MessageArgs = {}): string {
	return interpolate(`New terminal`, args);
}

export function terminal_loading_shell(args: MessageArgs = {}): string {
	return interpolate(`Detecting shell...`, args);
}

export function terminal_shell_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to detect shell: {error}`, args);
}

export function terminal_pty_error(args: MessageArgs = {}): string {
	return interpolate(`Failed to start terminal: {error}`, args);
}

export function embedded_terminal_toggle_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Toggle terminal`, args);
}

export function embedded_terminal_no_cwd_tooltip(args: MessageArgs = {}): string {
	return interpolate(`No project selected`, args);
}

export function embedded_terminal_close_tab_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Close terminal`, args);
}

export function embedded_terminal_error_fallback(args: MessageArgs = {}): string {
	return interpolate(`Terminal failed to load. Close and reopen the drawer to retry.`, args);
}

export function skills_welcome_title(args: MessageArgs = {}): string {
	return interpolate(`Welcome to Skills Library`, args);
}

export function skills_welcome_description(args: MessageArgs = {}): string {
	return interpolate(`Import your existing skills from agent directories to get started.`, args);
}

export function skills_import_existing(args: MessageArgs = {}): string {
	return interpolate(`Import Existing Skills`, args);
}

export function checkpoint_timeline_title(args: MessageArgs = {}): string {
	return interpolate(`Checkpoints`, args);
}

export function checkpoint_revert_button(args: MessageArgs = {}): string {
	return interpolate(`Revert`, args);
}

export function checkpoint_revert_confirm_title(args: MessageArgs = {}): string {
	return interpolate(`Revert to Checkpoint`, args);
}

export function checkpoint_revert_confirm_description(args: MessageArgs = {}): string {
	return interpolate(
		`This will revert {fileCount} file(s) to their state at checkpoint #{checkpointNumber}. This action cannot be undone.`,
		args
	);
}

export function checkpoint_revert_success(args: MessageArgs = {}): string {
	return interpolate(`Reverted to checkpoint #{checkpointNumber}`, args);
}

export function checkpoint_revert_partial(args: MessageArgs = {}): string {
	return interpolate(`Partially reverted: {succeeded} succeeded, {failed} failed`, args);
}

export function checkpoint_revert_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to revert: {error}`, args);
}

export function checkpoint_rewind_title(args: MessageArgs = {}): string {
	return interpolate(`Rewind Session`, args);
}

export function checkpoint_rewind_description(args: MessageArgs = {}): string {
	return interpolate(
		`Revert all files to their state at the beginning of this session. This will undo all changes made during this session.`,
		args
	);
}

export function checkpoint_rewind_button(args: MessageArgs = {}): string {
	return interpolate(`Rewind Session`, args);
}

export function checkpoint_rewind_confirm(args: MessageArgs = {}): string {
	return interpolate(`Rewind`, args);
}

export function checkpoint_rewind_confirm_prompt(args: MessageArgs = {}): string {
	return interpolate(`Rewind all changes?`, args);
}

export function checkpoint_rewind_success(args: MessageArgs = {}): string {
	return interpolate(`Session rewound successfully`, args);
}

export function checkpoint_rewind_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to rewind session: {error}`, args);
}

export function checkpoint_auto_label(args: MessageArgs = {}): string {
	return interpolate(`Auto`, args);
}

export function checkpoint_manual_label(args: MessageArgs = {}): string {
	return interpolate(`Manual`, args);
}

export function checkpoint_files_count(args: MessageArgs = {}): string {
	return interpolate(`{count} file(s)`, args);
}

export function checkpoint_no_checkpoints(args: MessageArgs = {}): string {
	return interpolate(`No checkpoints yet`, args);
}

export function checkpoint_no_checkpoints_title(args: MessageArgs = {}): string {
	return interpolate(`No checkpoints yet`, args);
}

export function checkpoint_no_checkpoints_description(args: MessageArgs = {}): string {
	return interpolate(
		`Checkpoints are automatically created as you work. They'll appear here once the agent makes changes to your project.`,
		args
	);
}

export function checkpoint_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading checkpoints...`, args);
}

export function checkpoint_loading_files(args: MessageArgs = {}): string {
	return interpolate(`Loading files...`, args);
}

export function checkpoint_load_files_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to load files: {error}`, args);
}

export function checkpoint_panel_title(args: MessageArgs = {}): string {
	return interpolate(`Checkpoints`, args);
}

export function checkpoint_empty_state(args: MessageArgs = {}): string {
	return interpolate(`No checkpoints yet`, args);
}

export function checkpoint_toggle_tooltip(args: MessageArgs = {}): string {
	return interpolate(`View checkpoints`, args);
}

export function checkpoint_revert_file_button(args: MessageArgs = {}): string {
	return interpolate(`Revert`, args);
}

export function checkpoint_file_reverted(args: MessageArgs = {}): string {
	return interpolate(`Reverted {filePath}`, args);
}

export function checkpoint_file_revert_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to revert file: {error}`, args);
}

export function checkpoint_reverting(args: MessageArgs = {}): string {
	return interpolate(`Reverting...`, args);
}

export function checkpoint_rewinding(args: MessageArgs = {}): string {
	return interpolate(`Rewinding...`, args);
}

export function hunk_revert_success(args: MessageArgs = {}): string {
	return interpolate(`Reverted changes in {filePath}`, args);
}

export function hunk_revert_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to revert: {error}`, args);
}

export function worktree_toggle_label(args: MessageArgs = {}): string {
	return interpolate(`New Worktree`, args);
}

export function worktree_toggle_creating(args: MessageArgs = {}): string {
	return interpolate(`Creating worktree...`, args);
}

export function worktree_toggle_checking(args: MessageArgs = {}): string {
	return interpolate(`Checking repository...`, args);
}

export function worktree_toggle_not_git_repo(args: MessageArgs = {}): string {
	return interpolate(`Not a git repository`, args);
}

export function worktree_toggle_disabled_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Cannot change after files have been edited`, args);
}

export function worktree_toggle_tooltip_create(args: MessageArgs = {}): string {
	return interpolate(`Create a worktree for this session`, args);
}

export function worktree_toggle_tooltip_on(args: MessageArgs = {}): string {
	return interpolate(`Using isolated worktree (click to disable)`, args);
}

export function worktree_toggle_tooltip_off(args: MessageArgs = {}): string {
	return interpolate(`Work in main repository (click to use worktree)`, args);
}

export function worktree_toggle_has_messages(args: MessageArgs = {}): string {
	return interpolate(`Worktree can only be set before sending messages`, args);
}

export function worktree_toggle_pending_label(args: MessageArgs = {}): string {
	return interpolate(`Worktree (auto)`, args);
}

export function worktree_toggle_pending_tooltip(args: MessageArgs = {}): string {
	return interpolate(`A worktree will be created when you send your first message`, args);
}

export function worktree_create_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to create worktree. Session will run without branch isolation.`, args);
}

export function worktree_close_confirm_title(args: MessageArgs = {}): string {
	return interpolate(`Remove worktree "{name}"?`, args);
}

export function worktree_close_confirm_dirty_title(args: MessageArgs = {}): string {
	return interpolate(`Has uncommitted changes — remove "{name}"?`, args);
}

export function worktree_close_confirm_description(args: MessageArgs = {}): string {
	return interpolate(`The worktree branch and directory will be permanently deleted.`, args);
}

export function worktree_close_confirm_close_only(args: MessageArgs = {}): string {
	return interpolate(`Close only, keep worktree`, args);
}

export function worktree_close_confirm_remove_and_close(args: MessageArgs = {}): string {
	return interpolate(`Remove worktree & close`, args);
}

export function worktree_close_confirm_remove_label(args: MessageArgs = {}): string {
	return interpolate(`Remove`, args);
}

export function worktree_close_confirm_keep_label(args: MessageArgs = {}): string {
	return interpolate(`Keep`, args);
}

export function worktree_deleted_banner(args: MessageArgs = {}): string {
	return interpolate(`The worktree associated with this session has been deleted.`, args);
}

export function setup_scripts_button_title(args: MessageArgs = {}): string {
	return interpolate(`Setup scripts`, args);
}

export function setup_scripts_dialog_title(args: MessageArgs = {}): string {
	return interpolate(`Setup Scripts`, args);
}

export function setup_scripts_add_placeholder(args: MessageArgs = {}): string {
	return interpolate(`add a command...`, args);
}

export function setup_scripts_empty_state(args: MessageArgs = {}): string {
	return interpolate(`No setup scripts yet. Commands run when a new worktree is created.`, args);
}

export function git_generate(args: MessageArgs = {}): string {
	return interpolate(`Generate`, args);
}

export function git_generate_tooltip(args: MessageArgs = {}): string {
	return interpolate(`Generate commit message and PR description with AI`, args);
}

export function git_generating(args: MessageArgs = {}): string {
	return interpolate(`Generating...`, args);
}

export function git_no_staged_changes(args: MessageArgs = {}): string {
	return interpolate(`No staged changes to generate from`, args);
}

export function git_no_active_session(args: MessageArgs = {}): string {
	return interpolate(`No active agent session`, args);
}

export function git_generation_failed(args: MessageArgs = {}): string {
	return interpolate(`Generation failed: {error}`, args);
}

export function git_shipping(args: MessageArgs = {}): string {
	return interpolate(`Creating PR...`, args);
}

export function git_shipped(args: MessageArgs = {}): string {
	return interpolate(`PR created!`, args);
}

export function git_open_pr(args: MessageArgs = {}): string {
	return interpolate(`Open PR`, args);
}

export function git_retry_ship(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function ship_card_commit_message(args: MessageArgs = {}): string {
	return interpolate(`Commit message`, args);
}

export function settings_git_section_title(args: MessageArgs = {}): string {
	return interpolate(`Git`, args);
}

export function git_text_generation_agent_label(args: MessageArgs = {}): string {
	return interpolate(`AI generation agent`, args);
}

export function git_text_generation_agent_description(args: MessageArgs = {}): string {
	return interpolate(`Agent used to generate commit messages and PR descriptions`, args);
}

export function pr_card_generating(args: MessageArgs = {}): string {
	return interpolate(`Generating...`, args);
}

export function pr_card_creating(args: MessageArgs = {}): string {
	return interpolate(`Creating PR...`, args);
}

export function pr_card_open(args: MessageArgs = {}): string {
	return interpolate(`Open PR`, args);
}

export function pr_card_merge(args: MessageArgs = {}): string {
	return interpolate(`Merge`, args);
}

export function pr_card_squash_merge(args: MessageArgs = {}): string {
	return interpolate(`Squash merge`, args);
}

export function pr_card_merge_commit(args: MessageArgs = {}): string {
	return interpolate(`Merge commit`, args);
}

export function pr_card_rebase_merge(args: MessageArgs = {}): string {
	return interpolate(`Rebase merge`, args);
}

export function pr_card_merged(args: MessageArgs = {}): string {
	return interpolate(`Merged`, args);
}

export function pr_card_closed(args: MessageArgs = {}): string {
	return interpolate(`Closed`, args);
}

export function pr_card_draft(args: MessageArgs = {}): string {
	return interpolate(`Draft`, args);
}

export function pr_card_description(args: MessageArgs = {}): string {
	return interpolate(`Description`, args);
}

export function pr_card_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function pr_card_merge_failed(args: MessageArgs = {}): string {
	return interpolate(`Merge failed: {error}`, args);
}

export function splash_welcome(args: MessageArgs = {}): string {
	return interpolate(`Welcome to Acepe`, args);
}

export function splash_description(args: MessageArgs = {}): string {
	return interpolate(
		`Your unified interface for AI coding agents. Work with Claude, Copilot, Codex, and other agents in parallel, all in one place.`,
		args
	);
}

export function splash_description_secondary(args: MessageArgs = {}): string {
	return interpolate(``, args);
}

export function splash_enter(args: MessageArgs = {}): string {
	return interpolate(`Get Started`, args);
}

export function changelog_title(args: MessageArgs = {}): string {
	return interpolate(`What's New in`, args);
}

export function changelog_hero_title(args: MessageArgs = {}): string {
	return interpolate(`What's New in Acepe`, args);
}

export function changelog_whats_new(args: MessageArgs = {}): string {
	return interpolate(`What's New`, args);
}

export function changelog_continue(args: MessageArgs = {}): string {
	return interpolate(`Continue`, args);
}

export function update_checking(args: MessageArgs = {}): string {
	return interpolate(`Checking for updates`, args);
}

export function update_checking_description(args: MessageArgs = {}): string {
	return interpolate(`Looking for the latest version...`, args);
}

export function update_downloading(args: MessageArgs = {}): string {
	return interpolate(`Downloading update`, args);
}

export function update_installing(args: MessageArgs = {}): string {
	return interpolate(`Installing update...`, args);
}

export function update_error(args: MessageArgs = {}): string {
	return interpolate(`Update failed`, args);
}

export function update_error_description(args: MessageArgs = {}): string {
	return interpolate(
		`Something went wrong while updating. Please check your connection and try again.`,
		args
	);
}

export function update_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}

export function queue_section_title(args: MessageArgs = {}): string {
	return interpolate(`Attention Queue`, args);
}

export function queue_section_description(args: MessageArgs = {}): string {
	return interpolate(
		`Sessions that need your attention. Questions, permissions, and completed work appear here.`,
		args
	);
}

export function queue_group_answer_needed(args: MessageArgs = {}): string {
	return interpolate(`Input needed`, args);
}

export function queue_group_working(args: MessageArgs = {}): string {
	return interpolate(`Working`, args);
}

export function queue_group_planning(args: MessageArgs = {}): string {
	return interpolate(`Planning`, args);
}

export function queue_group_finished(args: MessageArgs = {}): string {
	return interpolate(`Finished`, args);
}

export function queue_group_error(args: MessageArgs = {}): string {
	return interpolate(`Error`, args);
}

export function permission_deny(args: MessageArgs = {}): string {
	return interpolate(`Deny`, args);
}

export function permission_allow(args: MessageArgs = {}): string {
	return interpolate(`Allow`, args);
}

export function permission_always_allow(args: MessageArgs = {}): string {
	return interpolate(`Always`, args);
}

export function permission_autonomous(args: MessageArgs = {}): string {
	return interpolate(`Autonomous`, args);
}

export function tool_fetch_fetching(args: MessageArgs = {}): string {
	return interpolate(`Fetching`, args);
}

export function tool_fetch_fetched(args: MessageArgs = {}): string {
	return interpolate(`Fetched`, args);
}

export function tool_fetch_failed(args: MessageArgs = {}): string {
	return interpolate(`Fetch failed`, args);
}

export function tool_fetch_result_label(args: MessageArgs = {}): string {
	return interpolate(`Result`, args);
}

export function tool_fetch_error_label(args: MessageArgs = {}): string {
	return interpolate(`Error`, args);
}

export function tool_bash_running_no_cmd(args: MessageArgs = {}): string {
	return interpolate(`Running command…`, args);
}

export function tool_bash_running_label(args: MessageArgs = {}): string {
	return interpolate(`Running command:`, args);
}

export function tool_bash_completed_label(args: MessageArgs = {}): string {
	return interpolate(`Ran command:`, args);
}

export function tool_bash_success(args: MessageArgs = {}): string {
	return interpolate(`Success`, args);
}

export function tool_bash_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed`, args);
}

export function tool_search_finding(args: MessageArgs = {}): string {
	return interpolate(`Finding`, args);
}

export function tool_search_found(args: MessageArgs = {}): string {
	return interpolate(`Found`, args);
}

export function tool_search_grepping(args: MessageArgs = {}): string {
	return interpolate(`Grepping`, args);
}

export function tool_search_grepped(args: MessageArgs = {}): string {
	return interpolate(`Grepped`, args);
}

export function tool_search_result_count_one(args: MessageArgs = {}): string {
	return interpolate(`{count} result`, args);
}

export function tool_search_result_count_other(args: MessageArgs = {}): string {
	return interpolate(`{count} results`, args);
}

export function tool_search_show_more(args: MessageArgs = {}): string {
	return interpolate(`Show {count} more`, args);
}

export function tool_search_show_less(args: MessageArgs = {}): string {
	return interpolate(`Show less`, args);
}

export function tool_web_search_searching(args: MessageArgs = {}): string {
	return interpolate(`Searching`, args);
}

export function tool_web_search_searched(args: MessageArgs = {}): string {
	return interpolate(`Searched`, args);
}

export function tool_web_search_failed(args: MessageArgs = {}): string {
	return interpolate(`Search Failed`, args);
}

export function tool_web_search_no_results_label(args: MessageArgs = {}): string {
	return interpolate(`No results`, args);
}

export function tool_web_search_result_count_one(args: MessageArgs = {}): string {
	return interpolate(`{count} result`, args);
}

export function tool_web_search_result_count_other(args: MessageArgs = {}): string {
	return interpolate(`{count} results`, args);
}

export function tool_web_search_show_more(args: MessageArgs = {}): string {
	return interpolate(`+{count} more`, args);
}

export function tool_web_search_show_less(args: MessageArgs = {}): string {
	return interpolate(`show less`, args);
}

export function tool_web_search_show_more_expanded(args: MessageArgs = {}): string {
	return interpolate(`Show {count} more`, args);
}

export function tool_web_search_show_less_expanded(args: MessageArgs = {}): string {
	return interpolate(`Show less`, args);
}

export function tool_skill_loading(args: MessageArgs = {}): string {
	return interpolate(`Loading skill`, args);
}

export function tool_skill_fallback(args: MessageArgs = {}): string {
	return interpolate(`Skill`, args);
}

export function tool_skill_status_running(args: MessageArgs = {}): string {
	return interpolate(`Running`, args);
}

export function tool_skill_status_done(args: MessageArgs = {}): string {
	return interpolate(`Done`, args);
}

export function tool_task_running_fallback(args: MessageArgs = {}): string {
	return interpolate(`Running task…`, args);
}

export function tool_task_fallback(args: MessageArgs = {}): string {
	return interpolate(`Task`, args);
}

export function tool_task_tool_count_one(args: MessageArgs = {}): string {
	return interpolate(`{count} tool`, args);
}

export function tool_task_tool_count_other(args: MessageArgs = {}): string {
	return interpolate(`{count} tools`, args);
}

export function tool_task_result_label(args: MessageArgs = {}): string {
	return interpolate(`Result`, args);
}

export function tool_todo_tasks_label(args: MessageArgs = {}): string {
	return interpolate(`Tasks`, args);
}

export function tool_todo_fallback(args: MessageArgs = {}): string {
	return interpolate(`Updated todos`, args);
}

export function tool_edit_editing(args: MessageArgs = {}): string {
	return interpolate(`Editing`, args);
}

export function tool_edit_edited(args: MessageArgs = {}): string {
	return interpolate(`Edited`, args);
}

export function tool_edit_awaiting_approval(args: MessageArgs = {}): string {
	return interpolate(`Awaiting approval`, args);
}

export function tool_edit_interrupted(args: MessageArgs = {}): string {
	return interpolate(`Interrupted`, args);
}

export function tool_edit_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed`, args);
}

export function tool_edit_pending(args: MessageArgs = {}): string {
	return interpolate(`Pending`, args);
}

export function tool_edit_preparing_label(args: MessageArgs = {}): string {
	return interpolate(`Preparing edit…`, args);
}

export function aria_expand_output(args: MessageArgs = {}): string {
	return interpolate(`Expand output`, args);
}

export function aria_collapse_output(args: MessageArgs = {}): string {
	return interpolate(`Collapse output`, args);
}

export function aria_expand_diff(args: MessageArgs = {}): string {
	return interpolate(`Expand diff`, args);
}

export function aria_collapse_diff(args: MessageArgs = {}): string {
	return interpolate(`Collapse diff`, args);
}

export function aria_expand_results(args: MessageArgs = {}): string {
	return interpolate(`Expand results`, args);
}

export function aria_collapse_results(args: MessageArgs = {}): string {
	return interpolate(`Collapse results`, args);
}

export function aria_expand_description(args: MessageArgs = {}): string {
	return interpolate(`Expand to see full description`, args);
}

export function add_project_title(args: MessageArgs = {}): string {
	return interpolate(`Add Project`, args);
}

export function add_project_view_import(args: MessageArgs = {}): string {
	return interpolate(`Import from history`, args);
}

export function add_project_view_clone(args: MessageArgs = {}): string {
	return interpolate(`Clone repository`, args);
}

export function add_project_view_browse(args: MessageArgs = {}): string {
	return interpolate(`Browse folder`, args);
}

export function clone_form_url_label(args: MessageArgs = {}): string {
	return interpolate(`Repository URL`, args);
}

export function clone_form_url_placeholder(args: MessageArgs = {}): string {
	return interpolate(`https://github.com/user/repo.git`, args);
}

export function clone_form_destination_label(args: MessageArgs = {}): string {
	return interpolate(`Destination`, args);
}

export function clone_form_destination_placeholder(args: MessageArgs = {}): string {
	return interpolate(`Select a folder...`, args);
}

export function clone_form_branch_label(args: MessageArgs = {}): string {
	return interpolate(`Branch`, args);
}

export function clone_form_branch_placeholder(args: MessageArgs = {}): string {
	return interpolate(`main`, args);
}

export function clone_form_browse(args: MessageArgs = {}): string {
	return interpolate(`Browse`, args);
}

export function clone_form_clone(args: MessageArgs = {}): string {
	return interpolate(`Clone`, args);
}

export function clone_form_cloning(args: MessageArgs = {}): string {
	return interpolate(`Cloning...`, args);
}

export function voice_start_recording(args: MessageArgs = {}): string {
	return interpolate(`Start voice recording`, args);
}

export function voice_stop_recording(args: MessageArgs = {}): string {
	return interpolate(`Stop recording`, args);
}

export function voice_cancel(args: MessageArgs = {}): string {
	return interpolate(`Cancel`, args);
}

export function voice_recording(args: MessageArgs = {}): string {
	return interpolate(`Recording…`, args);
}

export function voice_transcribing(args: MessageArgs = {}): string {
	return interpolate(`Transcribing…`, args);
}

export function voice_downloading_model(args: MessageArgs = {}): string {
	return interpolate(`Downloading speech model…`, args);
}

export function voice_waveform_label(args: MessageArgs = {}): string {
	return interpolate(`Voice recording waveform`, args);
}

export function voice_no_speech_detected(args: MessageArgs = {}): string {
	return interpolate(`No speech detected`, args);
}

export function voice_error_permission_denied(args: MessageArgs = {}): string {
	return interpolate(`Microphone permission denied`, args);
}

export function voice_settings_enable_label(args: MessageArgs = {}): string {
	return interpolate(`Enable voice dictation`, args);
}

export function voice_settings_enable_description(args: MessageArgs = {}): string {
	return interpolate(`Allow microphone-based transcription in the composer.`, args);
}

export function voice_settings_language_label(args: MessageArgs = {}): string {
	return interpolate(`Transcription language`, args);
}

export function voice_settings_language_description(args: MessageArgs = {}): string {
	return interpolate(`Choose a preferred language or let Whisper auto-detect it.`, args);
}

export function voice_settings_models_title(args: MessageArgs = {}): string {
	return interpolate(`Speech models`, args);
}

export function voice_settings_auto_detect(args: MessageArgs = {}): string {
	return interpolate(`Auto-detect`, args);
}

export function voice_settings_download(args: MessageArgs = {}): string {
	return interpolate(`Download`, args);
}

export function voice_settings_delete(args: MessageArgs = {}): string {
	return interpolate(`Delete`, args);
}

export function voice_settings_selected(args: MessageArgs = {}): string {
	return interpolate(`Selected`, args);
}

export function voice_settings_model_english_only(args: MessageArgs = {}): string {
	return interpolate(`English-only`, args);
}

export function voice_settings_model_multilingual(args: MessageArgs = {}): string {
	return interpolate(`Multilingual`, args);
}

export function voice_settings_loading_models(args: MessageArgs = {}): string {
	return interpolate(`Loading voice models…`, args);
}

export function voice_error_stop_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to stop recording`, args);
}

export function voice_error_download_failed(args: MessageArgs = {}): string {
	return interpolate(`Model download failed`, args);
}

export function voice_error_model_status_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to check model status`, args);
}

export function voice_error_start_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to start recording`, args);
}

export function voice_error_load_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to load model`, args);
}

export function voice_error_transcription_timeout(args: MessageArgs = {}): string {
	return interpolate(`Transcription timed out`, args);
}

export function voice_model_menu_label(args: MessageArgs = {}): string {
	return interpolate(`Voice model`, args);
}

export function voice_model_menu_downloading(args: MessageArgs = {}): string {
	return interpolate(`Downloading…`, args);
}

export function error_boundary_panel_failed(args: MessageArgs = {}): string {
	return interpolate(`This panel encountered an error.`, args);
}

export function error_boundary_sidebar_failed(args: MessageArgs = {}): string {
	return interpolate(`Sidebar encountered an error.`, args);
}

export function error_boundary_session_item_failed(args: MessageArgs = {}): string {
	return interpolate(`Failed to render session.`, args);
}

export function error_boundary_retry(args: MessageArgs = {}): string {
	return interpolate(`Retry`, args);
}
