pub mod acp;
mod analytics;
pub mod browser_webview;
pub mod checkpoint;
pub mod codex_history;
mod commands;
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
    resize_browser_webview, show_browser_webview, BrowserWebviewState,
};

use acp::active_agent::ActiveAgent;
use acp::commands::{
    acp_cancel, acp_close_session, acp_fork_session, acp_get_event_bridge_info, acp_initialize,
    acp_install_agent, acp_list_agents, acp_new_session, acp_read_text_file,
    acp_register_custom_agent, acp_reply_permission, acp_reply_question,
    acp_respond_inbound_request, acp_resume_session, acp_send_prompt, acp_set_config_option,
    acp_set_mode, acp_set_model, acp_uninstall_agent, acp_write_text_file,
};
use acp::event_bridge_server::start_event_bridge_server;
use acp::event_hub::AcpEventHubState;
use acp::github_commands::{
    fetch_commit_diff, fetch_pr_diff, get_github_repo_context, list_pull_requests,
};
use acp::opencode::OpenCodeManagerRegistry;
use acp::provider::CommandAvailabilityCache;
use acp::providers::CustomAgentConfig;
use acp::registry::AgentRegistry;
use acp::session_registry::SessionRegistry;
use checkpoint::commands::{
    checkpoint_create, checkpoint_get_file_content, checkpoint_get_file_diff_content,
    checkpoint_get_file_snapshots, checkpoint_list, checkpoint_revert, checkpoint_revert_file,
};
use commands::locale::get_system_locale;
use commands::window::activate_window;
use cursor_history::commands::{has_cursor_history, is_cursor_installed};
use db::repository::{AppSettingsRepository, ProjectRepository};
use file_index::{
    copy_file, create_directory, create_file, delete_path, get_file_diff, get_project_files,
    get_project_git_overview_summary, get_project_git_status, get_project_git_status_summary,
    invalidate_project_files, read_file_content, read_image_as_base64, rename_path,
    resolve_file_path, revert_file_content, FileIndexService,
};
use git::commands::{browse_clone_destination, git_clone, git_collect_ship_context};
use git::gh_pr::{get_open_pr_for_branch, git_merge_pr, git_pr_details};
use git::watcher::{git_watch_head, GitHeadWatcher};
use git::worktree::{
    git_checkout_branch, git_current_branch, git_has_uncommitted_changes, git_init, git_is_repo,
    git_list_branches, git_worktree_create, git_worktree_disk_size, git_worktree_list,
    git_worktree_remove, git_worktree_reset,
};
use git::worktree_config::{load_worktree_config, run_worktree_setup, save_worktree_config};
use history::indexer::IndexerActor;
use opencode_history::commands::{
    get_opencode_converted_session, get_opencode_history, get_opencode_session,
    get_opencode_sessions_for_project,
};
use pty::commands::get_default_shell;
use session_jsonl::commands::{
    get_cache_stats, get_full_session, get_index_status, get_session_history, get_session_messages,
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
    sql_studio_delete_connection, sql_studio_download_s3_object, sql_studio_execute_query,
    sql_studio_explore_table, sql_studio_get_connection, sql_studio_list_connections,
    sql_studio_list_s3_buckets, sql_studio_list_s3_objects, sql_studio_list_schema,
    sql_studio_pick_sqlite_file, sql_studio_preview_s3_object, sql_studio_save_connection,
    sql_studio_test_connection, sql_studio_test_connection_input, sql_studio_update_table_cell,
};
use std::sync::Arc;
use storage::commands::{
    add_project, browse_project, delete_api_key, delete_session, delete_session_review_state,
    get_api_key, get_custom_keybindings, get_project_count, get_projects, get_recent_projects,
    get_session_file_path, get_session_review_state, get_streaming_log_path,
    get_thread_list_settings, get_user_setting, import_project, open_in_finder, open_streaming_log,
    remove_project, reset_database, save_api_key, save_custom_keybindings,
    save_session_review_state, save_thread_list_settings, save_user_setting, update_project_color,
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

/// Kill orphaned ACP subprocesses left by previous crash/force-quit.
/// Drop on SessionRegistry never fires on crash, so we sweep at startup.
/// SIGTERM first (graceful), then SIGKILL after 500ms (forceful).
fn kill_orphaned_acp_processes() {
    #[cfg(unix)]
    {
        use std::process::Command;
        use std::thread;
        use std::time::Duration;

        let patterns = ["acps/claude/claude-agent-acp"];
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

    // Forward tracing events to Sentry:
    // - error/fatal → Sentry issues (events)
    // - warn/info/debug → breadcrumbs only (context for errors, not standalone issues)
    // This prevents product-analytics-level logs (app_started, session_created, etc.)
    // from polluting the Sentry issues feed.
    let sentry_layer = sentry::integrations::tracing::layer().event_filter(|metadata| {
        use sentry::integrations::tracing::EventFilter;
        match *metadata.level() {
            tracing::Level::ERROR => EventFilter::Event,
            _ => EventFilter::Breadcrumb,
        }
    });

    #[cfg(debug_assertions)]
    {
        let console_layer = fmt::layer()
            .event_format(NoSpanEventFormatter)
            .with_ansi(true);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(console_layer)
            .with(file_layer)
            .with(sentry_layer)
            .init();
    }

    #[cfg(not(debug_assertions))]
    {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(file_layer)
            .with(sentry_layer)
            .init();
    }
}

fn panic_payload_to_string(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }

    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }

    "unknown panic payload".to_string()
}

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

const ANALYTICS_DISTINCT_ID_FILENAME: &str = "analytics_distinct_id";

fn generate_analytics_distinct_id() -> String {
    format!("desktop-{}", uuid::Uuid::new_v4())
}

fn load_or_create_analytics_distinct_id(app_handle: &tauri::AppHandle) -> String {
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "Failed to resolve app data directory for analytics distinct ID"
            );
            return generate_analytics_distinct_id();
        }
    };

    if let Err(error) = std::fs::create_dir_all(&app_data_dir) {
        tracing::warn!(
            path = %app_data_dir.display(),
            error = %error,
            "Failed to create app data directory for analytics distinct ID"
        );
        return generate_analytics_distinct_id();
    }

    let distinct_id_path = app_data_dir.join(ANALYTICS_DISTINCT_ID_FILENAME);
    if let Ok(existing_id) = std::fs::read_to_string(&distinct_id_path) {
        let trimmed_id = existing_id.trim();
        if !trimmed_id.is_empty() {
            return trimmed_id.to_string();
        }
    }

    let distinct_id = generate_analytics_distinct_id();
    if let Err(error) = std::fs::write(&distinct_id_path, &distinct_id) {
        tracing::warn!(
            path = %distinct_id_path.display(),
            error = %error,
            "Failed to persist analytics distinct ID"
        );
    }
    distinct_id
}

#[tauri::command]
#[specta::specta]
fn get_analytics_distinct_id() -> Result<String, String> {
    analytics::get_distinct_id()
        .ok_or_else(|| "Analytics distinct ID is not initialized".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse --audit-session for CLI timing audit (before starting full Tauri app)
    let args: Vec<String> = std::env::args().collect();
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

    // Initialize Sentry BEFORE logging so the tracing layer can forward errors.
    // The guard must live for the entire app lifetime to flush events on exit.
    let _sentry_guard = analytics::init(
        option_env!("SENTRY_DSN").unwrap_or_default().to_string(),
        String::new(), // distinct_id set later after app data dir is available
    );

    // Initialize logging (includes sentry_tracing layer for error forwarding)
    init_logging();

    // Create a Tokio runtime and register it with Tauri's async runtime.
    let runtime = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = runtime.enter();
    tauri::async_runtime::set(runtime.handle().clone());

    // CrabNebula DevTools disabled - using console logging instead
    // To re-enable: comment out init_logging() above and uncomment these lines
    // #[cfg(debug_assertions)]
    // let devtools = tauri_plugin_devtools::init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_locale::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            kill_orphaned_acp_processes();

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

            // Set the analytics distinct ID (Sentry user context + Mixpanel)
            let analytics_distinct_id = load_or_create_analytics_distinct_id(app.handle());
            analytics::set_distinct_id(analytics_distinct_id.clone());
            let mixpanel_token = analytics::resolve_mixpanel_token(
                std::env::var("MIXPANEL_TOKEN").ok(),
                option_env!("MIXPANEL_TOKEN"),
            );
            analytics::init_mixpanel(mixpanel_token);
            tracing::info!(
                distinct_id = %analytics_distinct_id,
                "Initialized analytics distinct ID"
            );
            analytics::track_event(
                app.handle().clone(),
                analytics::AnalyticsEvent::AppStarted,
                None,
            );
            // Note: Sentry's built-in panic integration captures panics automatically.

            // Initialize resource directory for bundled ACP
            if let Ok(resource_dir) = app.path().resource_dir() {
                tracing::info!(path = %resource_dir.display(), "Setting resource directory for bundled ACP");
                crate::acp::providers::set_resource_dir(resource_dir);
            }

            // Initialize agent installer cache directory and clean up stale temps
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let agents_dir = app_data_dir.join("agents");
                if let Err(e) = std::fs::create_dir_all(&agents_dir) {
                    tracing::warn!(error = %e, "Failed to create agents cache directory");
                } else {
                    tracing::info!(path = %agents_dir.display(), "Setting agent installer cache directory");
                    crate::acp::agent_installer::set_cache_dir(agents_dir);
                    crate::acp::agent_installer::cleanup_stale_temps();
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
                        analytics::track_error(
                            app_handle.clone(),
                            "db_init_failed",
                            e.to_string(),
                            None,
                        );
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

            // Terminal manager for process spawning
            app.manage(Arc::new(terminal::TerminalManager::new()));

            if let Ok(app_data_dir) = app.path().app_data_dir() {
                app.manage(VoiceState::new(&app_data_dir));
            } else {
                tracing::error!("Failed to resolve app data directory for voice state");
                std::process::exit(1);
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
        .invoke_handler(tauri::generate_handler![
            acp_initialize,
            acp_new_session,
            acp_resume_session,
            acp_fork_session,
            acp_set_model,
            acp_set_mode,
            acp_set_config_option,
            acp_send_prompt,
            acp_cancel,
            acp_reply_permission,
            acp_reply_question,
            acp_respond_inbound_request,
            acp_get_event_bridge_info,
            acp_list_agents,
            acp_install_agent,
            acp_uninstall_agent,
            acp_close_session,
            acp_register_custom_agent,
            acp_read_text_file,
            acp_write_text_file,
            get_session_history,
            get_session_messages,
            get_full_session,
            get_cache_stats,
            invalidate_history_cache,
            reset_cache_stats,
            get_index_status,
            reindex_sessions,
            history::commands::session_loading::get_unified_session,
            history::commands::session_loading::audit_session_load_timing,
            history::commands::session_loading::set_session_worktree_path,
            history::commands::session_loading::set_session_pr_number,
            history::commands::plans::get_unified_plan,
            history::commands::scanning::scan_project_sessions,
            history::commands::scanning::discover_all_projects_with_sessions,
            history::commands::projects::list_all_project_paths,
            history::commands::projects::count_sessions_for_project,
            has_cursor_history,
            is_cursor_installed,
            get_opencode_history,
            get_opencode_session,
            get_opencode_converted_session,
            get_opencode_sessions_for_project,
            get_projects,
            get_recent_projects,
            get_project_count,
            import_project,
            add_project,
            update_project_color,
            remove_project,
            browse_project,
            get_api_key,
            save_api_key,
            delete_api_key,
            get_custom_keybindings,
            save_custom_keybindings,
            get_system_locale,
            open_in_finder,
            open_streaming_log,
            get_streaming_log_path,
            get_session_file_path,
            delete_session,
            save_user_setting,
            get_user_setting,
            get_analytics_distinct_id,
            save_session_review_state,
            get_session_review_state,
            delete_session_review_state,
            save_thread_list_settings,
            get_thread_list_settings,
            reset_database,
            get_project_files,
            get_project_git_status,
            get_project_git_status_summary,
            get_project_git_overview_summary,
            invalidate_project_files,
            read_file_content,
            resolve_file_path,
            read_image_as_base64,
            get_file_diff,
            revert_file_content,
            copy_file,
            create_directory,
            create_file,
            delete_path,
            rename_path,
            terminal_create,
            terminal_output,
            terminal_wait_for_exit,
            terminal_kill,
            terminal_release,
            git_clone,
            git_collect_ship_context,
            browse_clone_destination,
            git_worktree_create,
            git_worktree_remove,
            git_worktree_reset,
            git_worktree_list,
            git_worktree_disk_size,
            git_init,
            git_is_repo,
            git_current_branch,
            git_list_branches,
            git_checkout_branch,
            git_has_uncommitted_changes,
            git_watch_head,
            git::operations::git_panel_status,
            git::operations::git_diff_stats,
            git::operations::git_stage_files,
            git::operations::git_unstage_files,
            git::operations::git_stage_all,
            git::operations::git_discard_changes,
            git::operations::git_commit,
            git::operations::git_push,
            git::operations::git_pull,
            git::operations::git_fetch,
            git::operations::git_remote_status,
            git::operations::git_stash_list,
            git::operations::git_stash_pop,
            git::operations::git_stash_drop,
            git::operations::git_stash_save,
            git::operations::git_log,
            git::operations::git_create_branch,
            git::operations::git_delete_branch,
            git::operations::git_run_stacked_action,
            get_open_pr_for_branch,
            git_merge_pr,
            git_pr_details,
            load_worktree_config,
            run_worktree_setup,
            save_worktree_config,
            get_default_shell,
            skills_list_tree,
            skills_get,
            skills_create,
            skills_update,
            skills_delete,
            skills_copy_to,
            skills_start_watching,
            skills_stop_watching,
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
            sql_studio_explore_table,
            sql_studio_update_table_cell,
            sql_studio_execute_query,
            sql_studio_list_s3_buckets,
            sql_studio_list_s3_objects,
            sql_studio_preview_s3_object,
            sql_studio_download_s3_object,
            skills_list_plugins,
            skills_list_plugin_skills,
            skills_get_plugin_skill,
            skills_copy_plugin_skill_to_agent,
            checkpoint_create,
            checkpoint_list,
            checkpoint_get_file_content,
            checkpoint_get_file_diff_content,
            checkpoint_get_file_snapshots,
            checkpoint_revert,
            checkpoint_revert_file,
            get_github_repo_context,
            fetch_commit_diff,
            fetch_pr_diff,
            list_pull_requests,
            voice_list_models,
            voice_list_languages,
            voice_get_model_status,
            voice_download_model,
            voice_delete_model,
            voice_load_model,
            voice_start_recording,
            voice_stop_recording,
            voice_cancel_recording,
            open_browser_webview,
            close_browser_webview,
            resize_browser_webview,
            navigate_browser_webview,
            reload_browser_webview,
            browser_webview_back,
            browser_webview_forward,
            get_browser_webview_url,
            hide_browser_webview,
            show_browser_webview,
            activate_window,
        ])
        .on_window_event(|window, event| {
            // When the last window is destroyed, stop all ACP subprocess trees.
            // The SessionRegistry::Drop impl handles this, but we also do it
            // explicitly here to ensure cleanup happens before Tauri state is dropped.
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if app.webview_windows().is_empty() {
                    tracing::info!("Last window destroyed, cleaning up all ACP sessions");
                    let registry = app.state::<SessionRegistry>();
                    registry.stop_all();
                    let git_watcher = app.state::<Arc<GitHeadWatcher>>();
                    git_watcher.unwatch_all();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                analytics::track_event(app_handle.clone(), analytics::AnalyticsEvent::AppExited, None);
            }
        });
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
