pub mod acp;
pub mod analytics;
pub mod browser_webview;
pub mod cc_sdk;
pub mod checkpoint;
pub mod codex_history;
mod commands;
pub mod copilot_history;
pub mod cursor_history;
pub mod db;
pub mod file_index;
pub mod git;
pub mod history;
#[cfg(target_os = "macos")]
mod macos_fps;
#[cfg(target_os = "macos")]
mod macos_resource_limits;
pub mod opencode_history;
pub mod path_safety;
pub mod project_access;
pub mod pty;
mod session_converter;
pub mod session_jsonl;
pub mod shell_env;
pub mod skills;
pub mod sql_studio;
mod storage;
pub mod terminal;
pub mod voice;

use browser_webview::{
    browser_webview_back, browser_webview_forward, close_browser_webview, get_browser_webview_url,
    hide_browser_webview, navigate_browser_webview, open_browser_webview, reload_browser_webview,
    resize_browser_webview, set_browser_webview_zoom, show_browser_webview, BrowserWebviewState,
};

use acp::active_agent::ActiveAgent;
use acp::commands::{
    acp_cancel, acp_close_session, acp_fork_session, acp_get_event_bridge_info,
    acp_get_session_projection, acp_initialize, acp_install_agent, acp_list_agents,
    acp_list_preconnection_commands, acp_new_session, acp_read_text_file,
    acp_register_custom_agent, acp_reply_interaction, acp_reply_permission, acp_reply_question,
    acp_respond_inbound_request, acp_resume_session, acp_send_prompt, acp_set_config_option,
    acp_set_mode, acp_set_model, acp_set_session_autonomous, acp_uninstall_agent,
    acp_write_text_file,
};
use acp::event_bridge_server::start_event_bridge_server;
use acp::event_hub::AcpEventHubState;
use acp::github_commands::{
    fetch_commit_diff, fetch_pr_diff, get_github_repo_context, git_working_file_diff,
    list_pull_requests,
};
use acp::github_issues::{
    check_github_auth, create_github_issue, create_issue_comment, get_github_issue,
    list_github_issues, list_issue_comments, search_github_issues, toggle_comment_reaction,
    toggle_issue_reaction,
};
use acp::opencode::OpenCodeManagerRegistry;
use acp::projections::ProjectionRegistry;
use acp::provider::{AgentProvider, CommandAvailabilityCache};
use acp::providers::CustomAgentConfig;
use acp::registry::AgentRegistry;
use acp::session_policy::SessionPolicyRegistry;
use acp::session_registry::SessionRegistry;
use acp::transcript_projection::TranscriptProjectionRegistry;
use checkpoint::commands::{
    checkpoint_create, checkpoint_get_file_content, checkpoint_get_file_diff_content,
    checkpoint_get_file_snapshots, checkpoint_list, checkpoint_revert, checkpoint_revert_file,
};
use commands::window::activate_window;
use cursor_history::commands::{has_cursor_history, is_cursor_installed};
use db::repository::{AppSettingsRepository, ProjectRepository};
use file_index::{
    copy_file, create_directory, create_file, delete_path, get_file_diff,
    get_file_explorer_preview, get_project_files, get_project_git_overview_summary,
    get_project_git_status, get_project_git_status_summary, invalidate_project_files,
    read_file_content, read_image_as_base64, rename_path, resolve_file_path, revert_file_content,
    search_project_files_for_explorer, FileIndexService,
};
use git::commands::{browse_clone_destination, git_clone, git_collect_ship_context};
use git::gh_pr::{get_open_pr_for_branch, git_merge_pr, git_pr_details};
use git::operations::{
    git_commit, git_create_branch, git_delete_branch, git_diff_stats, git_discard_changes,
    git_fetch, git_log, git_panel_status, git_pull, git_push, git_remote_status,
    git_run_stacked_action, git_stage_all, git_stage_files, git_stash_drop, git_stash_list,
    git_stash_pop, git_stash_save, git_unstage_files,
};
use git::watcher::{git_watch_head, GitHeadWatcher};
use git::worktree::{
    git_checkout_branch, git_current_branch, git_discard_prepared_worktree_session_launch,
    git_has_uncommitted_changes, git_init, git_is_repo, git_list_branches,
    git_prepare_worktree_session_launch, git_worktree_create, git_worktree_disk_size,
    git_worktree_list, git_worktree_remove, git_worktree_rename, git_worktree_reset,
};
use git::worktree_config::{load_worktree_config, run_worktree_setup, save_worktree_config};
use history::commands::{
    audit_session_load_timing, count_sessions_for_project, discover_all_projects_with_sessions,
    get_session_open_result, get_startup_sessions, get_unified_plan, list_all_project_paths,
    scan_project_sessions, set_session_pr_number, set_session_title, set_session_worktree_path,
};
use history::indexer::IndexerActor;
use opencode_history::commands::{get_opencode_history, get_opencode_sessions_for_project};
use pty::commands::get_default_shell;
use session_jsonl::commands::{
    get_cache_stats, get_index_status,
    invalidate_history_cache, reindex_sessions, reset_cache_stats,
};
use skills::commands::{
    library_import_existing,
    library_is_empty,
    library_skill_create,
    library_skill_delete,
    library_skill_delete_from_agents,
    library_skill_get,
    library_skill_get_folder_path,
    library_skill_get_sync_targets,
    library_skill_set_sync_target,
    library_skill_sync,
    library_skill_update,
    // Unified library commands
    library_skills_list,
    library_skills_list_with_sync,
    library_sync_all,
    skills_copy_plugin_skill_to_agent,
    skills_copy_to,
    skills_create,
    skills_delete,
    skills_get,
    skills_get_plugin_skill,
    skills_list_agent_skills,
    skills_list_plugin_skills,
    // Plugin skills commands
    skills_list_plugins,
    skills_list_tree,
    skills_start_watching,
    skills_stop_watching,
    skills_update,
};
use skills::SkillsService;
use sql_studio::commands::{
    sql_studio_delete_connection, sql_studio_execute_query, sql_studio_explore_table,
    sql_studio_get_connection, sql_studio_list_connections, sql_studio_list_schema,
    sql_studio_pick_sqlite_file, sql_studio_save_connection, sql_studio_test_connection,
    sql_studio_test_connection_input, sql_studio_update_table_cell,
};
use std::sync::{Arc, Mutex};
use storage::commands::{
    add_project, backfill_project_icons, browse_project, browse_project_icon, delete_api_key,
    delete_session_review_state, get_api_key, get_custom_keybindings, get_missing_project_paths,
    get_project_count, get_projects, get_recent_projects, get_session_file_path,
    get_session_review_state, get_streaming_log_path, get_thread_list_settings, get_user_setting,
    import_project, list_project_images, open_in_finder, open_streaming_log, remove_project,
    reset_database, save_api_key, save_custom_keybindings, save_session_review_state,
    save_thread_list_settings, save_user_setting, update_project_color, update_project_icon,
    update_project_order,
};
use tauri::Manager;
use terminal::commands::{
    terminal_create, terminal_kill, terminal_output, terminal_release, terminal_wait_for_exit,
};
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use voice::{
    voice_cancel_recording, voice_delete_model, voice_download_model, voice_get_model_status,
    voice_list_languages, voice_list_models, voice_load_model, voice_start_recording,
    voice_stop_recording, VoiceState,
};

struct NoSpanEventFormatter;

struct PrettyDevEventFormatter {
    started_at: std::time::Instant,
    last_event_at: Mutex<Option<std::time::Instant>>,
}

const ANSI_RESET: &str = "\x1b[0m";
const ANSI_BOLD: &str = "\x1b[1m";
const ANSI_DIM: &str = "\x1b[2m";
const ANSI_RED: &str = "\x1b[31m";
const ANSI_GREEN: &str = "\x1b[32m";
const ANSI_YELLOW: &str = "\x1b[33m";
const ANSI_BLUE: &str = "\x1b[34m";
const ANSI_MAGENTA: &str = "\x1b[35m";
const ANSI_CYAN: &str = "\x1b[36m";
const ANSI_BRIGHT_BLACK: &str = "\x1b[90m";

impl PrettyDevEventFormatter {
    fn new() -> Self {
        Self {
            started_at: std::time::Instant::now(),
            last_event_at: Mutex::new(None),
        }
    }
}

fn level_style(level: &tracing::Level) -> &'static str {
    match *level {
        tracing::Level::TRACE => ANSI_BRIGHT_BLACK,
        tracing::Level::DEBUG => ANSI_BLUE,
        tracing::Level::INFO => ANSI_CYAN,
        tracing::Level::WARN => ANSI_YELLOW,
        tracing::Level::ERROR => ANSI_RED,
    }
}

fn format_elapsed_label(duration: std::time::Duration) -> String {
    let total_millis = duration.as_millis();

    if total_millis < 1000 {
        return format!("{}ms", total_millis);
    }

    if total_millis < 60_000 {
        let seconds = total_millis as f64 / 1000.0;
        if total_millis < 10_000 {
            return format!("{seconds:.2}s");
        }

        return format!("{seconds:.1}s");
    }

    let total_seconds = duration.as_secs();
    if total_seconds < 3600 {
        let minutes = total_seconds / 60;
        let seconds = total_seconds % 60;
        return format!("{minutes}m{seconds:02}s");
    }

    let total_minutes = total_seconds / 60;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    format!("{hours}h{minutes:02}m")
}

fn format_delta_label(delta: Option<std::time::Duration>) -> String {
    match delta {
        Some(value) => format!("+{}", format_elapsed_label(value)),
        None => "start".to_string(),
    }
}

fn format_total_label(elapsed: std::time::Duration) -> String {
    format!("T+{}", format_elapsed_label(elapsed))
}

fn format_location(metadata: &tracing::Metadata<'_>) -> Option<String> {
    match (metadata.file(), metadata.line()) {
        (Some(file), Some(line)) => Some(format!("{file}:{line}")),
        _ => None,
    }
}

fn write_ansi(writer: &mut Writer<'_>, style: &str, text: &str) -> std::fmt::Result {
    write!(writer, "{style}{text}{ANSI_RESET}")
}

impl<S, N> FormatEvent<S, N> for NoSpanEventFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let metadata = event.metadata();
        write!(&mut writer, "{} {} ", metadata.level(), metadata.target())?;

        if let Some(line) = metadata.line() {
            if let Some(file) = metadata.file() {
                write!(&mut writer, "{}:{}: ", file, line)?;
            }
        }

        ctx.field_format().format_fields(writer.by_ref(), event)?;
        writeln!(&mut writer)
    }
}

impl<S, N> FormatEvent<S, N> for PrettyDevEventFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let metadata = event.metadata();
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(self.started_at);
        let delta = {
            let mut last_event_at = self.last_event_at.lock().expect("last_event_at poisoned");
            let previous = *last_event_at;
            *last_event_at = Some(now);
            previous.map(|previous_event| now.duration_since(previous_event))
        };

        let level_text = format!("{ANSI_BOLD}{:<5}", metadata.level());
        write_ansi(&mut writer, level_style(metadata.level()), &level_text)?;
        write!(&mut writer, " ")?;
        write_ansi(
            &mut writer,
            ANSI_DIM,
            &chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        )?;
        write!(&mut writer, " ")?;
        write_ansi(&mut writer, ANSI_GREEN, &format_delta_label(delta))?;
        write!(&mut writer, " ")?;
        write_ansi(&mut writer, ANSI_MAGENTA, &format_total_label(elapsed))?;
        write!(&mut writer, " ")?;
        write_ansi(&mut writer, ANSI_BLUE, metadata.target())?;

        if let Some(location) = format_location(metadata) {
            write!(&mut writer, " ")?;
            write_ansi(&mut writer, ANSI_BRIGHT_BLACK, &location)?;
        }

        write!(&mut writer, " ")?;
        ctx.field_format().format_fields(writer.by_ref(), event)?;
        writeln!(&mut writer)
    }
}

/// Kill orphaned ACP subprocesses left by previous crash/force-quit.
/// Drop on SessionRegistry never fires on crash, so we sweep at startup.
/// SIGTERM first (graceful), then SIGKILL after 500ms (forceful).
/// Uses the agents cache dir path to narrow the match and avoid killing unrelated processes.
fn orphaned_acp_process_patterns(agents_dir: &std::path::Path) -> Vec<String> {
    let agents_dir_str = agents_dir.to_string_lossy();
    vec![
        format!("{}/codex-acp/codex-acp", agents_dir_str),
        format!("{}/codex/codex", agents_dir_str),
        format!("{}/opencode/opencode", agents_dir_str),
    ]
}

fn cleanup_app_runtime(app: &tauri::AppHandle, reason: &'static str) {
    tracing::info!(reason, "Cleaning up ACP sessions and background managers");

    let registry = app.state::<SessionRegistry>();
    registry.stop_all();

    let opencode_registry = app.state::<Arc<OpenCodeManagerRegistry>>();
    tauri::async_runtime::block_on(opencode_registry.shutdown_all());

    let git_watcher = app.state::<Arc<GitHeadWatcher>>();
    git_watcher.unwatch_all();

    if let Some(voice_state) = app.try_state::<VoiceState>() {
        tracing::info!(reason, "Shutting down voice runtime");
        voice_state.shutdown();
    }
}

fn kill_orphaned_acp_processes(agents_dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::process::Command;
        use std::thread;
        use std::time::Duration;

        let patterns = orphaned_acp_process_patterns(agents_dir);
        for pattern in &patterns {
            let _ = Command::new("/usr/bin/pkill")
                .args(["-f", pattern])
                .status();
        }
        thread::sleep(Duration::from_millis(500));
        for pattern in &patterns {
            let _ = Command::new("/usr/bin/pkill")
                .args(["-9", "-f", pattern])
                .status();
        }
    }
}

/// Returns the path to the log file
fn get_log_path() -> std::path::PathBuf {
    let log_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".acepe-logs");
    std::fs::create_dir_all(&log_dir).ok();
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    log_dir.join(format!("acepe_{}.log", timestamp))
}

fn init_logging() {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));

    let log_path = get_log_path();
    eprintln!("📝 Log file: {}", log_path.display());

    let file_layer = std::fs::File::create(&log_path)
        .map(|file| {
            fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .event_format(NoSpanEventFormatter)
                .with_ansi(false)
        })
        .map_err(|error| {
            eprintln!(
                "Failed to create log file at {}: {}. Continuing with console logging only.",
                log_path.display(),
                error
            );
        })
        .ok();

    #[cfg(debug_assertions)]
    {
        let console_layer = fmt::layer()
            .event_format(PrettyDevEventFormatter::new())
            .with_ansi(true);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(analytics::sentry_tracing_layer())
            .with(console_layer)
            .with(file_layer)
            .init();
    }

    #[cfg(not(debug_assertions))]
    {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(analytics::sentry_tracing_layer())
            .with(file_layer)
            .init();
    }
}

#[cfg(any(target_os = "macos", test))]
fn panic_payload_to_string(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }

    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }

    "unknown panic payload".to_string()
}

#[cfg(any(target_os = "macos", test))]
fn run_startup_step<T, F>(step_name: &str, step: F) -> anyhow::Result<T>
where
    F: FnOnce() -> T,
{
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(step)).map_err(|payload| {
        anyhow::anyhow!(
            "Startup step '{}' panicked: {}",
            step_name,
            panic_payload_to_string(payload)
        )
    })
}

#[cfg(target_os = "macos")]
fn should_enable_high_refresh_webview_fix() -> bool {
    true
}

/// Run session load timing audit from CLI (no Tauri app). Supports Claude, Cursor, Codex.
/// OpenCode requires the running app - returns error for OpenCode in CLI mode.
fn run_audit_cli(
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<history::SessionLoadTiming, String> {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(history::commands::audit_session_load_timing_cli(
        session_id,
        project_path,
        agent_id,
        source_path,
    ))
}

#[derive(serde::Serialize)]
struct ClaudeModelDiscoveryCommandProbe {
    attempted: bool,
    command: String,
    args: Vec<String>,
    elapsed_ms: u128,
    status_code: Option<i32>,
    timed_out: bool,
    parsed_model_ids: Vec<String>,
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct ClaudeModelHydrationProbe {
    project_path: String,
    provider_model_ids: Vec<String>,
    discovery_attempted_in_app: bool,
    hydrated_model_ids: Vec<String>,
    cli_probe: Option<ClaudeModelDiscoveryCommandProbe>,
}

fn should_attempt_claude_model_discovery(provider_model_ids: &[String]) -> bool {
    provider_model_ids.is_empty()
}

fn merge_claude_model_ids(
    mut provider_model_ids: Vec<String>,
    discovered_model_ids: Vec<String>,
) -> Vec<String> {
    for model_id in discovered_model_ids {
        if !provider_model_ids
            .iter()
            .any(|existing| existing == &model_id)
        {
            provider_model_ids.push(model_id);
        }
    }

    provider_model_ids.sort();
    provider_model_ids
}

async fn run_claude_model_discovery_command_probe(
    project_path: String,
) -> ClaudeModelDiscoveryCommandProbe {
    let provider = acp::providers::ClaudeCodeProvider;
    let attempts = provider.model_discovery_commands();
    let Some(attempt) = attempts.into_iter().next() else {
        return ClaudeModelDiscoveryCommandProbe {
            attempted: false,
            command: String::new(),
            args: Vec::new(),
            elapsed_ms: 0,
            status_code: None,
            timed_out: false,
            parsed_model_ids: Vec::new(),
            error: Some("Claude provider does not expose any model discovery command".to_string()),
        };
    };

    let mut command = tokio::process::Command::new(&attempt.command);
    command.args(&attempt.args);
    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    command.current_dir(&project_path);

    for (key, value) in &attempt.env {
        command.env(key, value);
    }

    let started_at = std::time::Instant::now();
    match tokio::time::timeout(std::time::Duration::from_secs(10), command.output()).await {
        Ok(Ok(output)) => ClaudeModelDiscoveryCommandProbe {
            attempted: true,
            command: attempt.command,
            args: attempt.args,
            elapsed_ms: started_at.elapsed().as_millis(),
            status_code: output.status.code(),
            timed_out: false,
            parsed_model_ids: crate::acp::client_session::parse_model_discovery_output(
                &String::from_utf8_lossy(&output.stdout),
            )
            .into_iter()
            .map(|model| model.model_id)
            .collect(),
            error: None,
        },
        Ok(Err(error)) => ClaudeModelDiscoveryCommandProbe {
            attempted: true,
            command: attempt.command,
            args: attempt.args,
            elapsed_ms: started_at.elapsed().as_millis(),
            status_code: None,
            timed_out: false,
            parsed_model_ids: Vec::new(),
            error: Some(error.to_string()),
        },
        Err(_) => ClaudeModelDiscoveryCommandProbe {
            attempted: true,
            command: attempt.command,
            args: attempt.args,
            elapsed_ms: started_at.elapsed().as_millis(),
            status_code: None,
            timed_out: true,
            parsed_model_ids: Vec::new(),
            error: Some("Timed out after 10s".to_string()),
        },
    }
}

fn run_claude_model_hydration_probe_cli(
    project_path: String,
    include_cli_probe: bool,
) -> Result<ClaudeModelHydrationProbe, String> {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(async move {
        let provider = acp::providers::ClaudeCodeProvider;
        let mut provider_model_ids = provider
            .default_model_candidates()
            .into_iter()
            .map(|candidate| candidate.model_id)
            .collect::<Vec<_>>();
        provider_model_ids.sort();

        let discovery_attempted_in_app = should_attempt_claude_model_discovery(&provider_model_ids);
        let cli_probe = if include_cli_probe {
            Some(run_claude_model_discovery_command_probe(project_path.clone()).await)
        } else {
            None
        };

        let hydrated_model_ids = if discovery_attempted_in_app {
            merge_claude_model_ids(
                provider_model_ids.clone(),
                cli_probe
                    .as_ref()
                    .map(|probe| probe.parsed_model_ids.clone())
                    .unwrap_or_default(),
            )
        } else {
            provider_model_ids.clone()
        };

        Ok(ClaudeModelHydrationProbe {
            project_path,
            provider_model_ids,
            discovery_attempted_in_app,
            hydrated_model_ids,
            cli_probe,
        })
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse --probe-claude-model-hydration for CLI validation of the cc-sdk
    // model hydration path (before starting the full Tauri app).
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args
        .iter()
        .position(|argument| argument == "--probe-claude-model-hydration")
    {
        let candidate_project_path = args.get(pos + 1).cloned();
        let project_path = match candidate_project_path {
            Some(path) if !path.starts_with("--") => path,
            _ => std::env::current_dir()
                .map_err(|error| error.to_string())
                .and_then(|path| {
                    path.into_os_string()
                        .into_string()
                        .map_err(|_| "Current directory is not valid UTF-8".to_string())
                })
                .unwrap_or_else(|_| ".".to_string()),
        };
        let include_cli_probe = !args.iter().any(|argument| argument == "--skip-cli-probe");

        init_logging();
        dotenv::dotenv().ok();

        match run_claude_model_hydration_probe_cli(project_path, include_cli_probe) {
            Ok(report) => {
                println!("{}", serde_json::to_string_pretty(&report).unwrap());
                std::process::exit(0);
            }
            Err(error) => {
                eprintln!("Claude model hydration probe failed: {}", error);
                std::process::exit(1);
            }
        }
    }

    // Parse --audit-session for CLI timing audit (before starting full Tauri app)
    if let Some(pos) = args.iter().position(|a| a == "--audit-session") {
        if pos + 4 <= args.len() {
            let session_id = args[pos + 1].clone();
            let project_path = args[pos + 2].clone();
            let agent_id = args[pos + 3].clone();
            let source_path = args.get(pos + 4).cloned();

            init_logging();
            dotenv::dotenv().ok();

            match run_audit_cli(session_id, project_path, agent_id, source_path) {
                Ok(timing) => {
                    println!("{}", serde_json::to_string_pretty(&timing).unwrap());
                    std::process::exit(0);
                }
                Err(e) => {
                    eprintln!("Audit failed: {}", e);
                    std::process::exit(1);
                }
            }
        }
    }

    // Load environment variables from .env file in src-tauri directory
    // This allows the Rust backend to access ANTHROPIC_API_KEY at runtime
    dotenv::dotenv().ok();

    // Initialize logging
    init_logging();

    // NOTE: Rust Sentry init moved into .setup() — see below — so it can
    // check the persisted analytics_opt_out preference after DB is ready.

    // Create a Tokio runtime and register it with Tauri's async runtime.
    let runtime = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = runtime.enter();
    tauri::async_runtime::set(runtime.handle().clone());

    // CrabNebula DevTools disabled - using console logging instead
    // To re-enable: comment out init_logging() above and uncomment these lines
    // #[cfg(debug_assertions)]
    // let devtools = tauri_plugin_devtools::init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_locale::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Err(error) = run_startup_step("macos-resource-limits", || {
                    macos_resource_limits::raise_fd_limits();
                }) {
                    tracing::warn!(error = %error, "Failed macOS resource limits startup step");
                }
            }

            // Pre-warm shell environment cache so agent subprocesses get vars
            // from the user's login shell (e.g. AZURE_API_KEY in .zshrc).
            // Fires early to overlap with DB init; result ready before first agent spawn.
            tokio::spawn(async {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    crate::shell_env::prewarm(),
                )
                .await
                {
                    Ok(_) => {}
                    Err(_) => tracing::error!("Shell env capture timed out after 5s"),
                }
            });

            // Initialize agent installer cache directory and clean up stale temps
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let agents_dir = app_data_dir.join("agents");
                if let Err(e) = std::fs::create_dir_all(&agents_dir) {
                    tracing::warn!(error = %e, "Failed to create agents cache directory");
                } else {
                    tracing::info!(path = %agents_dir.display(), "Setting agent installer cache directory");
                    crate::acp::agent_installer::set_cache_dir(agents_dir.clone());
                    crate::acp::agent_installer::cleanup_stale_temps();
                    kill_orphaned_acp_processes(&agents_dir);
                }
            }

            // Pre-warm command availability checks so first ACP session creation/resume
            // never falls back to synchronous PATH scanning on request path.
            tauri::async_runtime::block_on(CommandAvailabilityCache::prewarm());

            // Initialize database
            let app_handle = app.handle().clone();
            let identifier = app.config().identifier.clone();
            let db_conn = tauri::async_runtime::block_on(async {
                match db::init_db(Some(identifier.as_str())).await {
                    Ok(db_conn) => {
                        tracing::info!("Database initialized successfully");
                        db_conn
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to initialize database, exiting");
                        std::process::exit(1);
                    }
                }
            });

            // Fetch all projects once (reused by TCC pre-warm and legacy cleanup).
            let all_projects = tauri::async_runtime::block_on(async {
                ProjectRepository::get_all(&db_conn).await.unwrap_or_default()
            });

            // Pre-warm macOS TCC grants before any filesystem operations.
            // Probes protected parent dirs (~/Documents, ~/Desktop, ~/Downloads)
            // so the user sees at most one "Allow" dialog per directory.
            #[cfg(target_os = "macos")]
            {
                let paths: Vec<std::path::PathBuf> = all_projects
                    .iter()
                    .map(|p| std::path::PathBuf::from(&p.path))
                    .collect();
                crate::project_access::pre_warm_protected_parents_for_projects(
                    &paths,
                    "app-startup-prewarm",
                );
            }

            // Remove legacy unsafe project roots (home/root) before any UI loads projects.
            tauri::async_runtime::block_on(async {
                for project in &all_projects {
                    let path = std::path::Path::new(&project.path);
                    let is_legacy_unsafe = matches!(
                        crate::path_safety::classify_legacy_unsafe_project_root_lexical(path),
                        Some(crate::path_safety::ProjectPathSafetyError::RootDirectory)
                            | Some(crate::path_safety::ProjectPathSafetyError::HomeDirectory)
                    );

                    if !is_legacy_unsafe {
                        continue;
                    }

                    if let Err(error) = ProjectRepository::delete(&db_conn, &project.path).await {
                        tracing::warn!(
                            project_path = %project.path,
                            error = %error,
                            "Failed to remove legacy unsafe project path"
                        );
                    } else {
                        tracing::warn!(
                            project_path = %project.path,
                            "Removed legacy unsafe project path to prevent macOS TCC prompt spam"
                        );
                    }
                }
            });

            // Manage database connection
            app.manage(db_conn.clone());

            // Initialize Sentry error reporting after DB is available
            // so we can respect the persisted analytics opt-out preference.
            {
                let analytics_opted_out = tauri::async_runtime::block_on(async {
                    AppSettingsRepository::get(&db_conn, "analytics_opt_out")
                        .await
                        .ok()
                        .flatten()
                        .and_then(|v| serde_json::from_str::<bool>(&v).ok())
                        .unwrap_or(false)
                });
                analytics::init(option_env!("CARGO_PKG_VERSION"), analytics_opted_out);
            }

            crate::project_access::log_startup_summary("app-setup-after-db-and-prewarm");

            // Initialize session indexer (Actor pattern)
            let db_arc = Arc::new(db_conn.clone());
            let indexer_handle = IndexerActor::spawn(db_arc.clone());
            app.manage(indexer_handle.clone());

            // Start background indexing after app is ready
            let indexer_for_init = indexer_handle.clone();
            let db_for_init = db_arc.clone();
            tauri::async_runtime::spawn(async move {
                // Small delay to let app fully initialize
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;

                // Get project paths from database, dropping unsafe legacy roots on macOS.
                let project_paths = match ProjectRepository::get_all(&db_for_init).await {
                    Ok(projects) => {
                        let mut valid_paths = Vec::new();

                        for project in projects {
                            let trimmed = project.path.trim();
                            if trimmed.is_empty() {
                                tracing::debug!(
                                    project_path = %project.path,
                                    "Skipping empty project path during startup indexing"
                                );
                                continue;
                            }

                            let path = std::path::Path::new(trimmed);
                            if matches!(
                                crate::path_safety::classify_legacy_unsafe_project_root_lexical(path),
                                Some(crate::path_safety::ProjectPathSafetyError::RootDirectory)
                                    | Some(crate::path_safety::ProjectPathSafetyError::HomeDirectory)
                            ) {
                                continue;
                            }

                            // Avoid filesystem validation at startup to prevent macOS TCC
                            // prompt storms when many saved projects live in protected dirs.
                            // The indexer only uses these paths to derive Claude slugs.
                            valid_paths.push(trimmed.to_string());
                        }

                        valid_paths
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to get projects for indexing");
                        return;
                    }
                };

                if project_paths.is_empty() {
                    tracing::info!("No projects found, skipping initial indexing");
                    return;
                }

                // Check if index is empty (first run)
                match crate::db::repository::SessionMetadataRepository::is_empty(&db_for_init).await {
                    Ok(true) => {
                        tracing::info!("First run detected, performing full index scan");
                        if let Err(e) = indexer_for_init.full_scan(project_paths.clone()).await {
                            tracing::error!(error = %e, "Initial full scan failed");
                        }
                    }
                    Ok(false) => {
                        tracing::info!("Index exists, performing incremental scan");
                        if let Err(e) = indexer_for_init.incremental_scan(project_paths.clone()).await {
                            tracing::error!(error = %e, "Incremental scan failed");
                        }
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to check index status");
                    }
                }

            });

            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                crate::project_access::log_startup_summary("startup-plus-5s");
            });

            // Initialize ACP state components
            // Agent registry (read-only after init)
            let agent_registry = Arc::new(AgentRegistry::new());

            let custom_agents_result = tauri::async_runtime::block_on(async {
                AppSettingsRepository::get(&db_conn, "custom_agent_configs").await
            });

            match custom_agents_result {
                Ok(Some(json)) => match serde_json::from_str::<Vec<CustomAgentConfig>>(&json) {
                    Ok(configs) => {
                        for config in configs {
                            if let Err(error) = agent_registry.register_custom(config.clone()) {
                                tracing::error!(
                                    error = %error,
                                    agent_id = %config.id,
                                    "Failed to restore persisted custom agent"
                                );
                            }
                        }
                    }
                    Err(error) => {
                        tracing::error!(
                            error = %error,
                            "Failed to deserialize persisted custom agent configs"
                        );
                    }
                },
                Ok(None) => {}
                Err(error) => {
                    tracing::error!(error = %error, "Failed to load persisted custom agent configs");
                }
            }

            app.manage(agent_registry);

            // ACP event hub and local SSE bridge for frontend event transport.
            let acp_event_hub = Arc::new(AcpEventHubState::new());
            if let Err(error) = tauri::async_runtime::block_on(start_event_bridge_server(
                acp_event_hub.clone(),
            )) {
                tracing::error!(%error, "Failed to start ACP event bridge server");
                std::process::exit(1);
            }
            app.manage(acp_event_hub);

            // Active agent preference
            app.manage(ActiveAgent::new());

            // Project-scoped OpenCode manager registry.
            app.manage(Arc::new(OpenCodeManagerRegistry::new(app_handle.clone())));

            // Session client registry
            app.manage(SessionRegistry::new());
            app.manage(Arc::new(SessionPolicyRegistry::new()));
            app.manage(Arc::new(ProjectionRegistry::new()));
            app.manage(Arc::new(TranscriptProjectionRegistry::new()));

            // Terminal manager for process spawning
            app.manage(Arc::new(terminal::TerminalManager::new()));

            if let Ok(app_data_dir) = app.path().app_data_dir() {
                match VoiceState::new(&app_data_dir) {
                    Ok(state) => {
                        app.manage(state);
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to initialize voice subsystem");
                        // Voice is non-critical — log but don't crash the app
                    }
                }
            } else {
                tracing::warn!("Failed to resolve app data directory; voice disabled");
            }

            // Initialize file index service
            app.manage(FileIndexService::new());

            // Initialize skills service
            app.manage(Arc::new(SkillsService::new()));

            // Browser webview state for native child webviews
            app.manage(BrowserWebviewState::<tauri::Wry>::new());

            // Git HEAD file watcher for external branch change detection
            app.manage(Arc::new(GitHeadWatcher::new()));

            // Disable WebKit's 60fps cap on macOS so requestAnimationFrame
            // can run at the display's native refresh rate (120fps on ProMotion).
            #[cfg(target_os = "macos")]
            {
                if should_enable_high_refresh_webview_fix() {
                    if let Err(error) = run_startup_step("macos-high-refresh-webview-fix", || {
                        for (_label, webview_window) in app.webview_windows() {
                            if let Err(e) = webview_window.with_webview(|webview| {
                                macos_fps::enable_high_refresh_rate(webview.inner());
                            }) {
                                tracing::warn!(error = %e, "Failed to apply 120fps fix");
                            }
                        }
                    }) {
                        tracing::warn!(
                            error = %error,
                            "Failed macOS high-refresh WebView startup step"
                        );
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(registered_tauri_handlers!())
        .on_window_event(|window, event| {
            // When the last window is destroyed, stop all ACP subprocess trees
            // and project-scoped OpenCode helpers before Tauri drops app state.
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if app.webview_windows().is_empty() {
                    cleanup_app_runtime(app, "last window destroyed");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } => {
                cleanup_app_runtime(app_handle, "exit requested");
            }
            tauri::RunEvent::Exit => {
                cleanup_app_runtime(app_handle, "event loop exit");
            }
            _ => {}
        });
}

#[cfg(test)]
mod lib_tests {
    use super::format_delta_label;
    use super::format_elapsed_label;
    use super::orphaned_acp_process_patterns;
    use super::should_attempt_claude_model_discovery;
    use crate::acp::provider::AgentProvider;
    use std::path::Path;
    use std::time::Duration;

    #[test]
    fn claude_defaults_skip_model_discovery_probe() {
        let provider = crate::acp::providers::ClaudeCodeProvider;
        let provider_model_ids = provider
            .default_model_candidates()
            .into_iter()
            .map(|candidate| candidate.model_id)
            .collect::<Vec<_>>();

        assert!(!provider_model_ids.is_empty());
        assert!(!should_attempt_claude_model_discovery(&provider_model_ids));
    }

    #[test]
    fn orphaned_acp_process_patterns_include_opencode() {
        let patterns = orphaned_acp_process_patterns(Path::new("/tmp/agents"));

        assert!(
            patterns.contains(&"/tmp/agents/opencode/opencode".to_string()),
            "startup orphan sweep should include the bundled opencode binary"
        );
    }

    #[test]
    fn logging_duration_labels_stay_compact() {
        assert_eq!(format_elapsed_label(Duration::from_millis(125)), "125ms");
        assert_eq!(format_elapsed_label(Duration::from_millis(1_550)), "1.55s");
        assert_eq!(format_elapsed_label(Duration::from_secs(75)), "1m15s");
        assert_eq!(format_elapsed_label(Duration::from_secs(3_900)), "1h05m");
        assert_eq!(format_delta_label(None), "start");
        assert_eq!(format_delta_label(Some(Duration::from_millis(85))), "+85ms");
    }
}

#[cfg(test)]
mod tests {
    use super::run_startup_step;

    #[cfg(target_os = "macos")]
    use super::should_enable_high_refresh_webview_fix;

    #[test]
    fn startup_step_returns_value_when_no_panic_occurs() {
        let result = run_startup_step("non-panicking-step", || 42);

        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn startup_step_converts_panics_into_errors() {
        let result = run_startup_step("panicking-step", || -> usize {
            panic!("boom");
        });

        assert!(result.is_err());
        let error = result.unwrap_err().to_string();
        assert!(error.contains("panicking-step"));
        assert!(error.contains("panic"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn high_refresh_webview_fix_is_enabled_by_default() {
        assert!(should_enable_high_refresh_webview_fix());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn high_refresh_webview_fix_cannot_be_disabled() {
        assert!(should_enable_high_refresh_webview_fix());
    }
}
