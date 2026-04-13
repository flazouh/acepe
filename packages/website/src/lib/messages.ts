type MessageArgs = Record<string, string | number>;

function interpolate(template: string, args: MessageArgs = {}): string {
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		const value = args[key];
		return value === undefined ? match : String(value);
	});
}
export const app_name = (args: MessageArgs = {}): string => interpolate(`Acepe`, args);
export const back_to_home = (args: MessageArgs = {}): string => interpolate(`Back to home`, args);
export const blog_back_to_index = (args: MessageArgs = {}): string =>
	interpolate(`Back to Blog`, args);
export const blog_index_subtitle = (args: MessageArgs = {}): string =>
	interpolate(`Product updates and how-to guides for the Acepe desktop app`, args);
export const blog_index_title = (args: MessageArgs = {}): string => interpolate(`Blog`, args);
export const blog_published_on = (args: MessageArgs = {}): string =>
	interpolate(`Published on {date}`, args);
export const blog_read_more = (args: MessageArgs = {}): string => interpolate(`Read more`, args);
export const blog_reading_time = (args: MessageArgs = {}): string =>
	interpolate(`{minutes} min read`, args);
export const blog_related_links_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Keep moving through the comparison, pricing, and download funnel from the feature you just explored.`,
		args
	);
export const blog_related_links_title = (args: MessageArgs = {}): string =>
	interpolate(`Next steps`, args);
export const changelog_nav_label = (args: MessageArgs = {}): string =>
	interpolate(`Changelog`, args);
export const changelog_page_description = (args: MessageArgs = {}): string =>
	interpolate(`What's new in Acepe. Updates are listed newest first.`, args);
export const changelog_page_title = (args: MessageArgs = {}): string =>
	interpolate(`Changelog`, args);
export const compare_badge = (args: MessageArgs = {}): string => interpolate(`comparison`, args);
export const compare_cta_description = (args: MessageArgs = {}): string =>
	interpolate(`Free forever for individuals. One download, every agent, full control.`, args);
export const compare_cta_download = (args: MessageArgs = {}): string =>
	interpolate(`Download Acepe`, args);
export const compare_cta_pricing = (args: MessageArgs = {}): string =>
	interpolate(`See pricing`, args);
export const compare_cta_title = (args: MessageArgs = {}): string =>
	interpolate(`Ready to try Acepe?`, args);
export const compare_differentiators_title = (args: MessageArgs = {}): string =>
	interpolate(`Why developers choose Acepe`, args);
export const compare_faq_title = (args: MessageArgs = {}): string =>
	interpolate(`Frequently asked questions`, args);
export const compare_index_description = (args: MessageArgs = {}): string =>
	interpolate(`See how Acepe stacks up against other developer tools, feature by feature.`, args);
export const compare_index_title = (args: MessageArgs = {}): string =>
	interpolate(`Compare Acepe`, args);
export const compare_resources_description = (args: MessageArgs = {}): string =>
	interpolate(
		`These product articles explain the queue, checkpoint, and SQL workflows that show up as differentiators throughout the comparison.`,
		args
	);
export const compare_resources_title = (args: MessageArgs = {}): string =>
	interpolate(`See Acepe features behind this comparison`, args);
export const compare_table_feature = (args: MessageArgs = {}): string =>
	interpolate(`Feature`, args);
export const compare_table_title = (args: MessageArgs = {}): string =>
	interpolate(`Feature by feature`, args);
export const compare_verification_description = (args: MessageArgs = {}): string =>
	interpolate(
		`This page only publishes claims backed by public product materials or public repository evidence.`,
		args
	);
export const compare_verification_last_verified = (args: MessageArgs = {}): string =>
	interpolate(`Last verified`, args);
export const compare_verification_sources = (args: MessageArgs = {}): string =>
	interpolate(`Sources`, args);
export const compare_verification_title = (args: MessageArgs = {}): string =>
	interpolate(`Public-source verification`, args);
export const copy = (args: MessageArgs = {}): string => interpolate(`Copy`, args);
export const email = (args: MessageArgs = {}): string => interpolate(`Email`, args);
export const feature_checkpoints_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Point-in-time file snapshots at every step. If the agent goes sideways, revert the whole session or just the files you care about.`,
		args
	);
export const feature_checkpoints_title = (args: MessageArgs = {}): string =>
	interpolate(`Checkpoints`, args);
export const feature_checkpoints_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Auto-checkpoints capture state after each tool run`, args);
export const feature_checkpoints_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Revert entire project or individual files to any checkpoint`, args);
export const feature_checkpoints_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Roll back to any checkpoint when the agent goes in the wrong direction`, args);
export const feature_keyboard_description = (args: MessageArgs = {}): string =>
	interpolate(
		`⌘K command palette. ⌘L switch agent. ⌘/ change model. ⌘N new thread. Every action has a shortcut. Your mouse can rest.`,
		args
	);
export const feature_keyboard_title = (args: MessageArgs = {}): string =>
	interpolate(`Keyboard-First`, args);
export const feature_keyboard_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Navigate entirely with keyboard shortcuts for flow state`, args);
export const feature_keyboard_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Customize shortcuts to match your muscle memory`, args);
export const feature_keyboard_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Discover new shortcuts with the searchable command palette`, args);
export const feature_multi_agent_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Claude Code, Codex, Cursor Agent, OpenCode. Switch with ⌘L. Use whichever agent fits the task.`,
		args
	);
export const feature_multi_agent_title = (args: MessageArgs = {}): string =>
	interpolate(`Multi-Agent Support`, args);
export const feature_multi_agent_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Use different agents for different tasks without context switching`, args);
export const feature_multi_agent_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Run multiple agents in parallel for faster development`, args);
export const feature_multi_agent_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Switch agents instantly with keyboard shortcuts`, args);
export const feature_parallel_focus_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Split your screen between agents working on different tasks. Tab between sessions like a browser. Go full-screen on one when you need to dig in.`,
		args
	);
export const feature_parallel_focus_title = (args: MessageArgs = {}): string =>
	interpolate(`Parallel Sessions & Focus`, args);
export const feature_parallel_focus_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Run agents on separate tasks and see all of them making progress at once`, args);
export const feature_parallel_focus_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Work across multiple repos at the same time without losing track`, args);
export const feature_parallel_focus_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(
		`Have 10 agents working across different projects with full visibility into each`,
		args
	);
export const feature_plan_mode_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Agent plan mode outputs a wall of text in your terminal. Acepe renders it as clean markdown with one-click copy, download, and preview toggle.`,
		args
	);
export const feature_plan_mode_title = (args: MessageArgs = {}): string =>
	interpolate(`Plan Mode`, args);
export const feature_plan_mode_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Built-in review and deepen skills refine plans before execution`, args);
export const feature_plan_mode_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Plans render as clean markdown you can copy or download`, args);
export const feature_plan_mode_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Read through the plan, adjust if needed, then run`, args);
export const feature_queue_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Sessions sorted by urgency. Questions waiting for you, active errors, and running agents rise to the top. Idle sessions stay out of the way.`,
		args
	);
export const feature_queue_title = (args: MessageArgs = {}): string =>
	interpolate(`Attention Queue`, args);
export const feature_queue_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Answer-needed sessions stay at the top until you respond`, args);
export const feature_queue_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`See errors and active work before idle sessions`, args);
export const feature_queue_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Switch context quickly without hunting through terminals`, args);
export const feature_sessions_description = (args: MessageArgs = {}): string =>
	interpolate(
		`The CLI doesn't track your history across projects. Acepe indexes every session, searchable and filterable. Find that solution you wrote last week.`,
		args
	);
export const feature_sessions_title = (args: MessageArgs = {}): string =>
	interpolate(`Session Management`, args);
export const feature_sessions_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Search and filter across all your agent interactions`, args);
export const feature_sessions_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Recover context from previous sessions instantly`, args);
export const feature_sessions_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Organize sessions by project for easy reference`, args);
export const feature_skills_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Custom workflows and tasks. Extend agent behavior with reusable skills—invoke before starting work, chain with commands, and stay in control.`,
		args
	);
export const feature_skills_title = (args: MessageArgs = {}): string => interpolate(`Skills`, args);
export const feature_skills_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Define skills that agents invoke before significant tasks`, args);
export const feature_skills_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Browse and manage skills from a dedicated overlay`, args);
export const feature_skills_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Compose workflows across agents and projects`, args);
export const feature_sql_studio_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Query PostgreSQL, MySQL, and SQLite without leaving the app. Schema explorer, SQL editor, and results grid in one overlay.`,
		args
	);
export const feature_sql_studio_title = (args: MessageArgs = {}): string =>
	interpolate(`SQL Studio`, args);
export const feature_sql_studio_usecase_1 = (args: MessageArgs = {}): string =>
	interpolate(`Connect to local or remote databases with saved connections`, args);
export const feature_sql_studio_usecase_2 = (args: MessageArgs = {}): string =>
	interpolate(`Browse schemas and tables, run queries, inspect results`, args);
export const feature_sql_studio_usecase_3 = (args: MessageArgs = {}): string =>
	interpolate(`Execute data-changing SQL with explicit write mode control`, args);
export const footer_copyright = (args: MessageArgs = {}): string =>
	interpolate(`© {year} Acepe. All rights reserved.`, args);
export const footer_legal = (args: MessageArgs = {}): string => interpolate(`Legal`, args);
export const footer_privacy = (args: MessageArgs = {}): string => interpolate(`Privacy`, args);
export const footer_product = (args: MessageArgs = {}): string => interpolate(`Product`, args);
export const footer_resources = (args: MessageArgs = {}): string => interpolate(`Resources`, args);
export const footer_terms = (args: MessageArgs = {}): string => interpolate(`Terms`, args);
export const landing_ade_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Every new agent is another terminal window, another scrollback buffer, another thing to manually track. An ADE collapses all of that into one workspace.`,
		args
	);
export const landing_ade_title = (args: MessageArgs = {}): string =>
	interpolate(`Why an ADE?`, args);
export const landing_cta_compare = (args: MessageArgs = {}): string =>
	interpolate(`See how Acepe compares →`, args);
export const landing_cta_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Acepe is free while in beta.
One download, every agent, full control.`,
		args
	);
export const landing_cta_title = (args: MessageArgs = {}): string =>
	interpolate(`Your ADE is ready`, args);
export const landing_download_button = (args: MessageArgs = {}): string =>
	interpolate(`Download for macOS`, args);
export const landing_feature_focus_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Expand any session to full width. Tabs keep your other work accessible. Collapse the sidebar, maximize the output. Deep work mode for complex tasks.`,
		args
	);
export const landing_feature_focus_title = (args: MessageArgs = {}): string =>
	interpolate(`Focus when you need it`, args);
export const landing_feature_keyboard_description = (args: MessageArgs = {}): string =>
	interpolate(
		`⌘K command palette. ⌘L switch agent. ⌘/ change model. ⌘N new thread. Every action has a shortcut. Your mouse can rest.`,
		args
	);
export const landing_feature_keyboard_title = (args: MessageArgs = {}): string =>
	interpolate(`Keyboard-first`, args);
export const landing_feature_multi_agent_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Claude Code, Codex, Cursor Agent, OpenCode. Switch with ⌘L. No vendor lock-in, just the agent that fits your task.`,
		args
	);
export const landing_feature_multi_agent_title = (args: MessageArgs = {}): string =>
	interpolate(`Any ACP agent, one interface`, args);
export const landing_feature_organization_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Run multiple agents side by side. Debug in one panel while another writes tests. See all your work at once instead of tabbing through terminals.`,
		args
	);
export const landing_feature_organization_title = (args: MessageArgs = {}): string =>
	interpolate(`Parallel sessions`, args);
export const landing_feature_unified_history_description = (args: MessageArgs = {}): string =>
	interpolate(
		`The CLI doesn't track your history across projects. Acepe indexes every session, searchable and filterable. Find that solution you wrote last week.`,
		args
	);
export const landing_feature_unified_history_title = (args: MessageArgs = {}): string =>
	interpolate(`All sessions, one place`, args);
export const landing_features_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Agent plan mode outputs a wall of text in your terminal. Acepe renders it as clean markdown with one-click copy, download, and preview toggle.`,
		args
	);
export const landing_features_heading = (args: MessageArgs = {}): string =>
	interpolate(`Everything an ADE should have`, args);
export const landing_features_subheading = (args: MessageArgs = {}): string =>
	interpolate(`For developers who run AI agents every day.`, args);
export const landing_features_title = (args: MessageArgs = {}): string =>
	interpolate(`Plan Mode, readable`, args);
export const landing_hero_cta = (args: MessageArgs = {}): string =>
	interpolate(`Get started`, args);
export const landing_hero_subtitle = (args: MessageArgs = {}): string =>
	interpolate(
		`Run Claude Code, Codex, Cursor Agent, and OpenCode side by side. Orchestrate parallel sessions, track every change, and ship from plan to PR. All in one window.`,
		args
	);
export const landing_hero_title = (args: MessageArgs = {}): string =>
	interpolate(`The Agentic Developer Environment`, args);
export const landing_main_alt = (args: MessageArgs = {}): string =>
	interpolate(`Acepe main interface showing multiple parallel AI agent sessions`, args);
export const landing_pillar_control_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Checkpoints snapshot your files after every tool run, so you can revert a single file or a whole session. Review plans before the agent acts on them, and intervene mid-task if something looks wrong.`,
		args
	);
export const landing_pillar_control_label = (args: MessageArgs = {}): string =>
	interpolate(`03 — Control`, args);
export const landing_pillar_control_title = (args: MessageArgs = {}): string =>
	interpolate(`Revert, checkpoint, intervene`, args);
export const landing_pillar_observe_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Each session shows its agent, project color, and live status at a glance. The attention queue surfaces what needs you. Plans, todos, file diffs, and code all render cleanly inside the app.`,
		args
	);
export const landing_pillar_observe_label = (args: MessageArgs = {}): string =>
	interpolate(`02 — Observe`, args);
export const landing_pillar_observe_title = (args: MessageArgs = {}): string =>
	interpolate(`See what every agent is doing`, args);
export const landing_pillar_orchestrate_description = (args: MessageArgs = {}): string =>
	interpolate(
		`Claude Code, Codex, Cursor Agent, OpenCode, all in one window. Start multiple agents on separate tasks and switch between them with ⌘L.`,
		args
	);
export const landing_pillar_orchestrate_label = (args: MessageArgs = {}): string =>
	interpolate(`01 — Orchestrate`, args);
export const landing_pillar_orchestrate_title = (args: MessageArgs = {}): string =>
	interpolate(`Run any agent, in parallel`, args);
export const landing_plan_mode_alt = (args: MessageArgs = {}): string =>
	interpolate(`Plan mode with markdown preview, copy and download options`, args);
export const loading = (args: MessageArgs = {}): string => interpolate(`Loading...`, args);
export const login = (args: MessageArgs = {}): string => interpolate(`Login`, args);
export const login_button = (args: MessageArgs = {}): string => interpolate(`Sign in`, args);
export const login_subtitle = (args: MessageArgs = {}): string =>
	interpolate(`Sign in to access the admin dashboard`, args);
export const login_title = (args: MessageArgs = {}): string => interpolate(`Welcome back`, args);
export const login_with_google = (args: MessageArgs = {}): string =>
	interpolate(`Sign in with Google`, args);
export const nav_blog = (args: MessageArgs = {}): string => interpolate(`Blog`, args);
export const nav_compare = (args: MessageArgs = {}): string => interpolate(`Compare`, args);
export const nav_download = (args: MessageArgs = {}): string => interpolate(`Download`, args);
export const nav_menu = (args: MessageArgs = {}): string => interpolate(`Open menu`, args);
export const nav_pricing = (args: MessageArgs = {}): string => interpolate(`Pricing`, args);
export const nav_roadmap = (args: MessageArgs = {}): string => interpolate(`Roadmap`, args);
export const password = (args: MessageArgs = {}): string => interpolate(`Password`, args);
export const roadmap_column_completed = (args: MessageArgs = {}): string =>
	interpolate(`Completed`, args);
export const roadmap_column_in_progress = (args: MessageArgs = {}): string =>
	interpolate(`In Progress`, args);
export const roadmap_column_open = (args: MessageArgs = {}): string => interpolate(`Open`, args);
export const roadmap_column_planned = (args: MessageArgs = {}): string =>
	interpolate(`Planned`, args);
export const roadmap_empty_column = (args: MessageArgs = {}): string =>
	interpolate(`Nothing here yet`, args);
export const roadmap_item_count = (args: MessageArgs = {}): string =>
	interpolate(`{count} items`, args);
export const roadmap_load_error = (args: MessageArgs = {}): string =>
	interpolate(`Failed to load roadmap`, args);
export const roadmap_login_to_vote = (args: MessageArgs = {}): string =>
	interpolate(`Log in to vote`, args);
export const roadmap_page_subtitle = (args: MessageArgs = {}): string =>
	interpolate(`See what we're working on and what's next`, args);
export const roadmap_page_title = (args: MessageArgs = {}): string => interpolate(`Roadmap`, args);
export const theme_switch_to_dark = (args: MessageArgs = {}): string =>
	interpolate(`Switch to dark theme`, args);
export const theme_switch_to_light = (args: MessageArgs = {}): string =>
	interpolate(`Switch to light theme`, args);
