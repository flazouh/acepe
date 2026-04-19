use super::sse;
use crate::acp::providers::opencode::resolve_opencode_spawn_configs;
use crate::acp::runtime_resolver::{load_saved_agent_env_overrides, resolve_effective_runtime};
use crate::acp::types::CanonicalAgentId;
use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

/// Timeout for waiting for OpenCode server to be ready (milliseconds)
const READY_CHECK_TIMEOUT_MS: u64 = 15000;

/// Interval between ready checks (milliseconds)
const READY_CHECK_INTERVAL_MS: u64 = 200;

/// Regex to extract port and API prefix from OpenCode serve output
static URL_REGEX: LazyLock<Option<Regex>> =
    LazyLock::new(
        || match Regex::new(r#"https?://[^:\s]+:(?P<port>\d+)(?P<path>/[^\s"']*)?"#) {
            Ok(regex) => Some(regex),
            Err(error) => {
                tracing::error!(%error, "Failed to compile OpenCode URL regex");
                None
            }
        },
    );

#[cfg(unix)]
fn configure_child_process_group(cmd: &mut Command) {
    unsafe {
        cmd.pre_exec(|| {
            nix::unistd::setsid().map_err(std::io::Error::other)?;
            Ok(())
        });
    }
}

#[cfg(unix)]
fn signal_child_tree(child: &Child, signal: nix::sys::signal::Signal) -> bool {
    use nix::sys::signal::kill;
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;

    let Some(raw_pid) = child.id().and_then(|pid| i32::try_from(pid).ok()) else {
        return false;
    };

    let pid = Pid::from_raw(raw_pid);
    if killpg(pid, signal).is_ok() {
        return true;
    }

    kill(pid, signal).is_ok()
}

/// Manages the lifecycle of the OpenCode HTTP server subprocess
pub struct OpenCodeManager {
    /// Project root this manager is bound to.
    project_root: PathBuf,
    /// Child process handle
    child: Option<Child>,
    /// Detected port (auto-selected by OpenCode)
    port: Arc<RwLock<Option<u16>>>,
    /// API prefix (e.g., "" or "/api")
    api_prefix: Arc<RwLock<String>>,
    /// HTTP client for health checks
    http_client: reqwest::Client,
    /// Shutdown flag
    shutdown_flag: Arc<AtomicBool>,
    /// SSE subscription task handle
    sse_task: Option<JoinHandle<()>>,
    /// SSE cancellation token for cleanup
    sse_cancel_token: Option<CancellationToken>,
    /// App handle for event emission
    app_handle: Option<AppHandle>,
}

impl OpenCodeManager {
    /// Create a new OpenCodeManager
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            child: None,
            port: Arc::new(RwLock::new(None)),
            api_prefix: Arc::new(RwLock::new(String::new())),
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .unwrap_or_else(|error| {
                    tracing::error!(%error, "Failed to configure OpenCode HTTP client, using default client");
                    reqwest::Client::new()
                }),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            sse_task: None,
            sse_cancel_token: None,
            app_handle: None,
        }
    }

    /// Set app handle for event emission. Call once at init.
    pub fn set_app_handle(&mut self, handle: AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Canonical project root this manager is responsible for.
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Ensure the OpenCode server is running and return the port
    pub async fn ensure_running(&mut self) -> Result<u16> {
        // Check if already running (drop the lock before await)
        let existing_port = *self.port.read().await;
        if let Some(port) = existing_port {
            if self.is_child_running().await? {
                tracing::debug!(port = port, "OpenCode server already running");
                // Server running, ensure SSE is subscribed
                self.ensure_sse_subscription().await?;
                return Ok(port);
            }
        }

        // Start the server
        self.start().await?;
        self.ensure_sse_subscription().await?;

        // Get the port (create a new lock scope)
        let port = *self.port.read().await;
        port.ok_or_else(|| anyhow!("Failed to get port after starting"))
    }

    /// Start or restart SSE subscription
    async fn ensure_sse_subscription(&mut self) -> Result<()> {
        // Already have an active subscription?
        if let Some(handle) = self.sse_task.as_ref() {
            if !handle.is_finished() {
                return Ok(());
            }
            tracing::warn!("Detected finished SSE subscription task, restarting");
        }

        // Clean up stale finished task and token before resubscribing
        if let Some(handle) = self.sse_task.take() {
            match handle.await {
                Ok(()) => {
                    tracing::debug!("Previous SSE task ended cleanly");
                }
                Err(error) => {
                    tracing::warn!(%error, "Previous SSE task ended with join error");
                }
            }
        }
        if let Some(token) = self.sse_cancel_token.take() {
            token.cancel();
        }

        // Clear SSE caches on new subscription to prevent stale data from previous sessions
        sse::clear_message_role_cache();
        tracing::debug!("Cleared SSE message caches for fresh subscription");

        let app_handle = self
            .app_handle
            .clone()
            .ok_or_else(|| anyhow!("App handle not set - cannot subscribe to SSE"))?;

        let base_url = self
            .base_url()
            .await
            .ok_or_else(|| anyhow!("Server not running - cannot subscribe to SSE"))?;

        let cancel_token = CancellationToken::new();
        self.sse_cancel_token = Some(cancel_token.clone());

        // Subscribe without directory filter - manager handles all sessions
        let handle = sse::subscribe_to_events(
            &base_url,
            None, // No directory filter - receive all events
            app_handle,
            cancel_token,
        )
        .await?;

        self.sse_task = Some(handle);
        tracing::info!("OpenCodeManager SSE subscription started");
        Ok(())
    }

    /// Stop SSE subscription
    fn stop_sse(&mut self) {
        if let Some(token) = self.sse_cancel_token.take() {
            token.cancel();
        }
        if let Some(handle) = self.sse_task.take() {
            handle.abort();
        }
    }

    /// Start the OpenCode HTTP server
    async fn start(&mut self) -> Result<()> {
        if self.child.is_some() {
            tracing::warn!(
                project_root = %self.project_root.display(),
                "Restarting OpenCode server after stale child state"
            );
            self.graceful_stop().await?;
        }

        self.shutdown_flag.store(false, Ordering::Relaxed);
        *self.port.write().await = None;
        *self.api_prefix.write().await = String::new();

        tracing::info!(
            project_root = %self.project_root.display(),
            "Starting OpenCode HTTP server"
        );

        let mut spawn_config = resolve_opencode_spawn_configs(
            crate::acp::agent_installer::get_cached_binary(&CanonicalAgentId::OpenCode)
                .map(|path| path.to_string_lossy().to_string()),
            crate::acp::agent_installer::get_cached_args(&CanonicalAgentId::OpenCode),
        )
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!(
            "No launchers available for provider opencode. Install the agent before starting a session."
        ))?;

        // Use port 0 for auto-selection
        let desired_port = 0u16;
        spawn_config.args.push("--port".to_string());
        spawn_config.args.push(desired_port.to_string());
        let saved_overrides = if let Some(app_handle) = &self.app_handle {
            match load_saved_agent_env_overrides(app_handle).await {
                Ok(saved_overrides) => Some(saved_overrides),
                Err(error) => {
                    tracing::warn!(
                        agent_id = "opencode",
                        error = %error,
                        "Failed to load saved agent env overrides for OpenCode"
                    );
                    None
                }
            }
        } else {
            None
        };
        let runtime = resolve_effective_runtime(
            "opencode",
            &self.project_root,
            &spawn_config,
            saved_overrides.as_ref(),
        );

        // Spawn the process with the provider-resolved launcher
        let mut cmd = Command::new(&runtime.command);
        cmd.args(&runtime.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&runtime.cwd)
            .kill_on_drop(false); // We handle cleanup manually

        #[cfg(unix)]
        configure_child_process_group(&mut cmd);

        // Preserve the provider env contract for downloaded OpenCode binaries.
        cmd.env_clear();
        for (key, value) in &runtime.env {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .context("Failed to spawn opencode serve subprocess")?;

        tracing::info!(pid = ?child.id(), "OpenCode subprocess spawned");

        // Capture stdout to parse port
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to capture stdout"))?;

        // Capture and drain stderr to prevent blocking
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("Failed to capture stderr"))?;
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            while let Ok(n) = reader.read_until(b'\n', &mut buf).await {
                if n > 0 {
                    if let Ok(line) = std::str::from_utf8(&buf) {
                        tracing::debug!(line = %line.trim(), "OpenCode stderr");
                    }
                }
                buf.clear();
            }
        });

        let port = self.port.clone();
        let api_prefix = self.api_prefix.clone();

        // Spawn task to read output and extract port
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(line = %line, "OpenCode stdout");

                // Try to extract port from URL
                if let Some(captures) = URL_REGEX.as_ref().and_then(|regex| regex.captures(&line)) {
                    if let Some(port_match) = captures
                        .name("port")
                        .and_then(|m| m.as_str().parse::<u16>().ok())
                    {
                        *port.write().await = Some(port_match);
                        tracing::info!(port = port_match, "Detected OpenCode server port");
                    }

                    // Extract API prefix if present
                    if let Some(path_match) = captures.name("path") {
                        let path = path_match.as_str();
                        if !path.is_empty() && path != "/" {
                            *api_prefix.write().await = path.to_string();
                            tracing::info!(api_prefix = %path, "Detected API prefix");
                        }
                    }
                }
            }
        });

        self.child = Some(child);

        // Wait for server to be ready
        self.wait_for_ready().await?;

        tracing::info!("OpenCode HTTP server started successfully");
        Ok(())
    }

    /// Wait for the OpenCode server to be ready
    async fn wait_for_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(READY_CHECK_TIMEOUT_MS);
        let mut last_error: Option<String> = None;

        while tokio::time::Instant::now() < deadline {
            // Wait for port to be detected
            let port = match *self.port.read().await {
                Some(p) => p,
                None => {
                    tokio::time::sleep(Duration::from_millis(READY_CHECK_INTERVAL_MS)).await;
                    continue;
                }
            };

            // Try to check endpoints
            match self.check_endpoints(port).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_error = Some(e.to_string());
                    tokio::time::sleep(Duration::from_millis(READY_CHECK_INTERVAL_MS)).await;
                }
            }
        }

        Err(anyhow!(
            "OpenCode not ready after {}ms: {}",
            READY_CHECK_TIMEOUT_MS,
            last_error.unwrap_or_else(|| "no error details".to_string())
        ))
    }

    /// Check if OpenCode endpoints are responding
    async fn check_endpoints(&self, port: u16) -> Result<()> {
        let api_prefix = self.api_prefix.read().await.clone();
        let base_url = format!("http://127.0.0.1:{}{}", port, api_prefix);

        // Try /config endpoint
        let config_url = format!("{}/config", base_url);
        let response = self.http_client.get(&config_url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Config endpoint returned status: {}",
                response.status()
            ));
        }

        tracing::debug!("OpenCode /config endpoint responding");
        Ok(())
    }

    /// Get the base URL for the OpenCode server
    pub async fn base_url(&self) -> Option<String> {
        let port_guard = self.port.read().await;
        let port = (*port_guard)?;
        let api_prefix = self.api_prefix.read().await.clone();
        Some(format!("http://127.0.0.1:{}{}", port, api_prefix))
    }

    /// Check if the child process is still running
    pub async fn is_child_running(&self) -> Result<bool> {
        if let Some(_child) = &self.child {
            // Check if process is still alive by checking port
            if let Some(port) = *self.port.read().await {
                return Ok(self.check_endpoints(port).await.is_ok());
            }
        }
        Ok(false)
    }

    /// Check if shutting down
    pub fn is_shutting_down(&self) -> bool {
        self.shutdown_flag.load(Ordering::Relaxed)
    }

    /// Gracefully stop the OpenCode server
    pub async fn graceful_stop(&mut self) -> Result<()> {
        self.shutdown_flag.store(true, Ordering::Relaxed);
        self.stop_sse(); // Stop SSE before stopping server
        *self.port.write().await = None;
        *self.api_prefix.write().await = String::new();

        if let Some(mut child) = self.child.take() {
            tracing::info!("Stopping OpenCode server gracefully");

            // Send SIGTERM on Unix
            #[cfg(unix)]
            {
                if let Some(pid) = child.id() {
                    let signaled = signal_child_tree(&child, nix::sys::signal::Signal::SIGTERM);
                    tracing::debug!(
                        pid = pid,
                        signaled_tree = signaled,
                        "Sent SIGTERM to OpenCode process tree"
                    );
                }
            }

            // Wait up to 3 seconds for graceful exit
            match timeout(Duration::from_secs(3), child.wait()).await {
                Ok(_) => {
                    tracing::info!("OpenCode server stopped gracefully");
                    return Ok(());
                }
                Err(_) => {
                    tracing::warn!("OpenCode did not stop gracefully, killing");
                }
            }

            // Force kill if still running
            #[cfg(unix)]
            {
                let _ = signal_child_tree(&child, nix::sys::signal::Signal::SIGKILL);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill().await;
            }
            let _ = child.wait().await;
            tracing::info!("OpenCode server killed");
        }

        Ok(())
    }
}

impl Drop for OpenCodeManager {
    fn drop(&mut self) {
        self.stop_sse(); // Clean up SSE on drop
                         // Attempt to kill the child on drop (non-async)
        if let Some(mut child) = self.child.take() {
            #[cfg(unix)]
            {
                let _ = signal_child_tree(&child, nix::sys::signal::Signal::SIGKILL);
            }
            let _ = child.start_kill();

            match child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => {
                    if let Ok(handle) = tokio::runtime::Handle::try_current() {
                        handle.spawn(async move {
                            let _ = child.wait().await;
                        });
                    }
                }
            }
        }
    }
}

/// Errors that indicate a permanently failed init attempt.
///
/// When the init closure encounters one of these, the result is stored in the
/// `OnceCell` so subsequent callers fail fast instead of retrying.
#[derive(Debug, Clone)]
pub enum PermanentInitError {
    BinaryNotFound(String),
    DirectoryNotFound(String),
    RegistryShuttingDown,
}

impl std::fmt::Display for PermanentInitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BinaryNotFound(msg) => write!(f, "binary not found: {}", msg),
            Self::DirectoryNotFound(msg) => write!(f, "directory not found: {}", msg),
            Self::RegistryShuttingDown => write!(f, "registry is shutting down"),
        }
    }
}

/// The value stored inside each per-key `OnceCell`.
///
/// - `Ok(...)` — successfully initialized manager.
/// - `Err(PermanentInitError)` — terminal failure; callers fail fast.
///
/// Transient errors leave the cell **uninitialized** so the next caller
/// retries via `get_or_try_init`.
type RegistryEntry = Result<Arc<TokioMutex<OpenCodeManager>>, PermanentInitError>;

/// Project-scoped OpenCode manager registry.
///
/// Uses a `DashMap` of `OnceCell`s for single-flight initialization per
/// runtime-root key.  This eliminates the TOCTOU race in the previous
/// lock-check-unlock-create-relock pattern: only one caller ever executes
/// the init closure for a given key, and all concurrent callers await the
/// same `OnceCell`.
pub struct OpenCodeManagerRegistry {
    app_handle: AppHandle,
    cells: DashMap<String, Arc<tokio::sync::OnceCell<RegistryEntry>>>,
    /// Set to `true` before draining in `shutdown_all()`.
    shutting_down: AtomicBool,
}

impl OpenCodeManagerRegistry {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            cells: DashMap::new(),
            shutting_down: AtomicBool::new(false),
        }
    }

    /// Get or start the OpenCode manager for the given runtime root.
    ///
    /// The `project_root` is resolved via [`super::runtime_root::resolve`]
    /// by the caller before reaching this method. This method uses
    /// [`super::runtime_root::registry_key`] semantics: the key is the
    /// stringified canonical `runtime_root`.
    pub async fn get_or_start(
        &self,
        project_root: &Path,
    ) -> Result<(String, Arc<TokioMutex<OpenCodeManager>>)> {
        let canonical_root = canonicalize_project_root(project_root);
        let key = canonical_root.to_string_lossy().to_string();

        // Get or insert the per-key OnceCell.  The DashMap entry is cheap;
        // only the init closure does real work.
        let cell = self
            .cells
            .entry(key.clone())
            .or_insert_with(|| Arc::new(tokio::sync::OnceCell::new()))
            .value()
            .clone();

        // Single-flight: only one caller runs the closure; others await.
        let result = cell
            .get_or_try_init(|| {
                let app_handle = self.app_handle.clone();
                let root = canonical_root.clone();
                let shutting_down = &self.shutting_down;

                async move {
                    // Guard: abort if shutdown is in progress.
                    if shutting_down.load(Ordering::Acquire) {
                        return Err(anyhow::anyhow!(PermanentInitError::RegistryShuttingDown));
                    }

                    // Validate the directory still exists.
                    if !root.is_dir() {
                        return Err(anyhow::anyhow!(PermanentInitError::DirectoryNotFound(
                            root.display().to_string()
                        )));
                    }

                    let mut manager = OpenCodeManager::new(root);
                    manager.set_app_handle(app_handle);

                    match manager.ensure_running().await {
                        Ok(_port) => Ok(Ok(Arc::new(TokioMutex::new(manager)))),
                        Err(err) => {
                            // Classify: is this permanent or transient?
                            let msg = err.to_string();
                            if msg.contains("No launchers available")
                                || msg.contains("not found")
                                || msg.contains("Install the agent")
                            {
                                // Permanent: store in cell so callers fail fast.
                                Ok(Err(PermanentInitError::BinaryNotFound(msg)))
                            } else {
                                // Transient: return Err so OnceCell stays
                                // uninitialized and the next caller retries.
                                //
                                // Clean up the failed manager to avoid leaking
                                // a partially-spawned subprocess.
                                let _ = manager.graceful_stop().await;
                                Err(err)
                            }
                        }
                    }
                }
            })
            .await?;

        // Unwrap the inner Result to surface permanent failures.
        match result {
            Ok(mgr) => {
                // Ensure the manager is still running (it may have been
                // stopped externally or timed out).
                let mut guard = mgr.lock().await;
                guard.ensure_running().await?;
                drop(guard);
                Ok((key, mgr.clone()))
            }
            Err(permanent) => Err(anyhow::anyhow!(
                "OpenCode manager permanently failed for {}: {}",
                key,
                permanent
            )),
        }
    }

    /// Shut down a single runtime by key.
    ///
    /// Removes the cell from the map and stops the manager if initialized.
    pub async fn shutdown_runtime(&self, key: &str) {
        if let Some((_, cell)) = self.cells.remove(key) {
            if let Some(Ok(mgr)) = cell.get() {
                let mut guard = mgr.lock().await;
                if let Err(error) = guard.graceful_stop().await {
                    tracing::warn!(
                        project_key = %key,
                        %error,
                        "Failed to stop OpenCode manager during runtime shutdown"
                    );
                }
            }
        }
    }

    pub async fn shutdown_all(&self) {
        // Signal init closures to abort.
        self.shutting_down.store(true, Ordering::Release);

        // First drain: collect all initialized managers.
        let mut to_stop: Vec<(String, Arc<TokioMutex<OpenCodeManager>>)> = Vec::new();
        self.cells.retain(|key, cell| {
            if let Some(Ok(mgr)) = cell.get() {
                to_stop.push((key.clone(), mgr.clone()));
            }
            false // remove all entries
        });

        if !to_stop.is_empty() {
            tracing::info!(count = to_stop.len(), "Shutting down all OpenCode managers");

            for (project_key, manager) in &to_stop {
                let mut guard = manager.lock().await;
                if let Err(error) = guard.graceful_stop().await {
                    tracing::warn!(
                        project_key = %project_key,
                        %error,
                        "Failed to stop OpenCode manager during shutdown"
                    );
                }
            }
        }

        // Second drain: catch any inits that raced past the flag check.
        // The `retain(false)` drops the DashMap entries, which drops the
        // OnceCell+Arc chain, ultimately triggering OpenCodeManager::Drop
        // (which kills the child process).
        tokio::time::sleep(Duration::from_millis(100)).await;
        self.cells.retain(|key, cell| {
            if cell.get().is_some_and(|entry| entry.is_ok()) {
                tracing::warn!(
                    project_key = %key,
                    "Late-arriving OpenCode manager detected during shutdown; dropping"
                );
            }
            false
        });
    }
}

fn canonicalize_project_root(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::{canonicalize_project_root, OpenCodeManager, PermanentInitError};
    use std::fs;
    use std::path::PathBuf;
    use std::process::Stdio;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::process::Command;

    #[test]
    fn permanent_init_error_display_binary_not_found() {
        let err = PermanentInitError::BinaryNotFound("No launchers available".to_string());
        assert_eq!(err.to_string(), "binary not found: No launchers available");
    }

    #[test]
    fn permanent_init_error_display_directory_not_found() {
        let err = PermanentInitError::DirectoryNotFound("/tmp/missing".to_string());
        assert_eq!(err.to_string(), "directory not found: /tmp/missing");
    }

    #[test]
    fn permanent_init_error_display_shutting_down() {
        let err = PermanentInitError::RegistryShuttingDown;
        assert_eq!(err.to_string(), "registry is shutting down");
    }

    #[test]
    fn canonicalize_project_root_falls_back_to_original_on_missing_path() {
        let missing = PathBuf::from("/tmp/acepe-test-nonexistent-path-12345");
        let result = canonicalize_project_root(&missing);
        assert_eq!(result, missing);
    }

    #[test]
    fn canonicalize_project_root_resolves_existing_path() {
        let tmp = std::env::temp_dir();
        let result = canonicalize_project_root(&tmp);
        // On macOS, /tmp -> /private/tmp, so the result should be canonical
        assert!(result.is_absolute());
        assert!(result.exists());
    }

    /// Verify the OnceCell single-flight pattern works correctly:
    /// two concurrent callers get the same Arc.
    #[tokio::test]
    async fn oncecell_single_flight_returns_same_arc() {
        let cell: Arc<tokio::sync::OnceCell<Arc<String>>> = Arc::new(tokio::sync::OnceCell::new());

        let cell1 = cell.clone();
        let cell2 = cell.clone();

        let (r1, r2) = tokio::join!(
            async move {
                cell1
                    .get_or_init(|| async { Arc::new("initialized".to_string()) })
                    .await
                    .clone()
            },
            async move {
                cell2
                    .get_or_init(|| async { Arc::new("initialized".to_string()) })
                    .await
                    .clone()
            },
        );

        assert!(
            Arc::ptr_eq(&r1, &r2),
            "Both callers should get the same Arc"
        );
    }

    /// Verify transient failure leaves cell uninitialized for retry.
    #[tokio::test]
    async fn oncecell_transient_failure_allows_retry() {
        let cell: Arc<tokio::sync::OnceCell<String>> = Arc::new(tokio::sync::OnceCell::new());
        let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));

        // First call: fail transiently
        let attempt_clone = attempt.clone();
        let result = cell
            .get_or_try_init(|| async move {
                attempt_clone.fetch_add(1, Ordering::SeqCst);
                Err::<String, anyhow::Error>(anyhow::anyhow!("transient"))
            })
            .await;
        assert!(result.is_err());
        assert!(
            cell.get().is_none(),
            "Cell should remain uninitialized after transient failure"
        );

        // Second call: succeed
        let attempt_clone = attempt.clone();
        let result: Result<&String, anyhow::Error> = cell
            .get_or_try_init(|| async move {
                attempt_clone.fetch_add(1, Ordering::SeqCst);
                Ok("success".to_string())
            })
            .await;
        assert!(result.is_ok());
        assert_eq!(
            attempt.load(Ordering::SeqCst),
            2,
            "Init closure should run twice"
        );
    }

    /// Verify permanent failure is stored in cell and prevents retry.
    #[tokio::test]
    async fn oncecell_permanent_failure_prevents_retry() {
        type Entry = Result<Arc<String>, PermanentInitError>;
        let cell: Arc<tokio::sync::OnceCell<Entry>> = Arc::new(tokio::sync::OnceCell::new());
        let init_count = Arc::new(std::sync::atomic::AtomicU32::new(0));

        // First call: permanent failure (stored as Ok(Err(...)))
        let count = init_count.clone();
        let entry = cell
            .get_or_try_init(|| {
                let count = count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<Entry, anyhow::Error>(Err(PermanentInitError::BinaryNotFound(
                        "not found".to_string(),
                    )))
                }
            })
            .await
            .expect("outer Result should be Ok");
        assert!(entry.is_err(), "Inner result should be permanent error");

        // Second call: init closure should NOT run again
        let count = init_count.clone();
        let entry = cell
            .get_or_try_init(|| {
                let count = count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok::<Entry, anyhow::Error>(Ok(Arc::new("should not reach".to_string())))
                }
            })
            .await
            .expect("outer Result should be Ok");
        assert!(entry.is_err(), "Should still be permanent error");
        assert_eq!(
            init_count.load(Ordering::SeqCst),
            1,
            "Init closure should only run once for permanent failure"
        );
    }

    #[cfg(unix)]
    async fn wait_for_pid_file(pid_file: &PathBuf) -> u32 {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

        loop {
            if let Ok(contents) = fs::read_to_string(pid_file) {
                if let Ok(pid) = contents.trim().parse::<u32>() {
                    return pid;
                }
            }

            assert!(
                tokio::time::Instant::now() < deadline,
                "timed out waiting for grandchild pid file"
            );

            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok()
    }

    #[cfg(unix)]
    fn kill_process(pid: u32) {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGKILL,
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn graceful_stop_kills_spawned_descendants() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let pid_file = std::env::temp_dir().join(format!("acepe-opencode-child-{}.pid", unique));
        let _ = fs::remove_file(&pid_file);

        let script = format!(
            "sleep 30 & echo $! > '{}' && while :; do sleep 1; done",
            pid_file.display()
        );

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        unsafe {
            command.pre_exec(|| {
                nix::unistd::setsid().map_err(std::io::Error::other)?;
                Ok(())
            });
        }

        let child = command.spawn().expect("test shell should spawn");
        let grandchild_pid = wait_for_pid_file(&pid_file).await;

        let mut manager = OpenCodeManager::new(PathBuf::from("/tmp/test-project"));
        manager.child = Some(child);

        manager
            .graceful_stop()
            .await
            .expect("graceful stop should succeed");

        tokio::time::sleep(Duration::from_millis(100)).await;
        let grandchild_alive = process_exists(grandchild_pid);

        if grandchild_alive {
            kill_process(grandchild_pid);
        }

        let _ = fs::remove_file(&pid_file);

        assert!(
            !grandchild_alive,
            "graceful_stop should terminate descendant processes, but pid {} is still alive",
            grandchild_pid
        );
    }
}
